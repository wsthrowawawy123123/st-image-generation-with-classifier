import { parseLabeledFields, parseListValue, parseRawExtractionFields } from './parser.js';
import {
    buildImageTags,
    buildMemoryEvent,
    imageTagsToSceneTags,
    injectConsistencyAnchorTags,
    runSceneTaggingPipeline,
} from './taggingPipeline.js';
import {
    applyContinuityMemoryToCurrentState,
    buildContinuityMemoryBlock,
} from './memory.js';
import {
    normalizeAllowed,
    normalizeNormalizedTags,
    normalizeRouterResult,
    normalizeSafetyTags,
    validateNormalizedTags,
    validateSafetyTags,
} from './validator.js';

export {
    applyContinuityMemoryToCurrentState,
    buildImageTags,
    buildContinuityMemoryBlock,
    imageTagsToSceneTags,
    injectConsistencyAnchorTags,
    normalizeAllowed,
    normalizeNormalizedTags,
    normalizeRouterResult,
    normalizeSafetyTags,
    parseLabeledFields,
    parseListValue,
    parseRawExtractionFields,
    validateNormalizedTags,
    validateSafetyTags,
};

export function safeParseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') {
        return null;
    }

    let trimmed = raw.trim();
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    try {
        return JSON.parse(trimmed);
    } catch { }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch { }
    }

    return null;
}

export function normalizedTagsToSceneTags(normalizedTags, sceneMemory = null, rawExtraction = null) {
    return imageTagsToSceneTags(buildImageTags({ normalized_tags: normalizedTags }, rawExtraction), sceneMemory);
}

export function createAnalysisPipeline({
    extensionName,
    getSettings,
    getImageAnalysisTextContext,
    normalizeScenePatch,
    callChat,
}) {
    function mapSceneRecordToSceneEval(sceneRecord) {
        const normalized = sceneRecord.normalized_tags;
        const safetyTags = sceneRecord.safety_tags;

        let category = 'dialogue_only';
        let weight = 0;
        let generate = false;

        if (normalized.content === 'explicit') {
            category = 'nsfw_action';
            weight = 0.95;
            generate = true;
        } else if (normalized.content === 'mixed') {
            category = 'nsfw_action';
            weight = 0.88;
            generate = true;
        } else if (normalized.content === 'suggestive') {
            category = normalized.action === 'posing' ? 'pose_change' : 'physical_interaction';
            weight = 0.72;
            generate = true;
        } else if (normalized.content === 'sfw') {
            if (normalized.pose !== 'unknown' || !['conversation', 'unknown'].includes(normalized.action)) {
                category = 'pose_change';
                weight = 0.6;
                generate = true;
            } else if (normalized.location !== 'unknown') {
                category = 'ambient_scene';
                weight = 0.55;
                generate = true;
            }
        }

        return {
            generate,
            category,
            weight,
            routerResult: sceneRecord.router_result,
            rawExtraction: sceneRecord.raw_extraction,
            normalized,
            imageTags: sceneRecord.image_tags,
            safetyTags,
            continuityMemory: sceneRecord.continuity_memory,
            requiresSafetyReview: (
                safetyTags?.age === 'minor' ||
                safetyTags?.age === 'age unclear' ||
                safetyTags?.consent === 'coercive' ||
                safetyTags?.consent === 'nonconsensual' ||
                safetyTags?.risk === 'illegal'
            ),
            sceneRecord,
        };
    }

    async function classifyReplyForImage(context, options = {}) {
        const settings = getSettings();
        const {
            assistantText,
            previousAssistantText: prevAssistantText,
            latestUserText,
        } = getImageAnalysisTextContext(context);

        const input = {
            chat_id: options.chatId || context.chatId || context.groupId || 'current-chat',
            character_id: options.characterId || context.characterId || context.name2 || 'current-character',
            message_start: Number.isFinite(options.messageStart) ? options.messageStart : Math.max(0, (context.chat || []).length - 2),
            message_end: Number.isFinite(options.messageEnd) ? options.messageEnd : Math.max(0, (context.chat || []).length - 1),
            source_text: options.sourceText || `Previous assistant context:
${prevAssistantText || '(none)'}

Latest user message:
${latestUserText || '(none)'}

Current assistant reply:
${assistantText}`,
            model: settings.classifierModel || settings.model || 'unknown',
        };

        const classifierOptions = {
            useClassifierBackend: settings.classifierUseSeparateBackend === true,
            max_tokens: settings.classifierMaxTokens ?? 80,
            temperature: settings.classifierTemperature ?? 0.1,
        };

        const sceneRecord = await runSceneTaggingPipeline({
            input,
            callChat,
            classifierOptions,
            currentState: options.currentState || null,
        });

        const sceneEval = mapSceneRecordToSceneEval(sceneRecord);

        console.log(`[${extensionName}] router classifier passes`, {
            sceneRecord,
            sceneEval,
        });

        return sceneEval;
    }

    async function extractScenePatch(context) {
        const settings = getSettings();
        const {
            assistantText,
            previousAssistantText: prevAssistantText,
        } = getImageAnalysisTextContext(context);

        const patchPrompt = `Extract the current visual scene state update from the CURRENT assistant reply.

        Return JSON only with this exact schema:
        {
        "location": "",
        "environment": "",
        "assistantPose": "",
        "assistantClothing": "",
        "assistantExpression": "",
        "interaction": "",
        "props": [],
        "lighting": "",
        "mood": ""
        }

        Rules:
        - Return only changed or newly introduced fields from the CURRENT assistant reply.
        - Do not restate, rephrase, summarize, or paraphrase details that are already part of the ongoing scene unless the CURRENT assistant reply clearly changes them.
        - Only include fields that are explicitly stated or strongly implied by the CURRENT assistant reply.
        - If a field did not clearly change or is unclear, leave it as an empty string, or [] for props.
        - Treat assistantClothing, location, environment, and lighting as sticky fields that should change only with clear explicit evidence in the CURRENT assistant reply.
        - Do not convert the same scene detail into new wording just because it was described differently.
        - Do not invent details.
        - Use Previous assistant context only to resolve ambiguity.
        - Respond with JSON only.
        - Do not include markdown fences.
        - Do not include explanation text.

        Previous assistant context:
        ${prevAssistantText || '(none)'}

        Current assistant reply:
        ${assistantText}`;

        const result = await callChat(
            [
                {
                    role: 'system',
                    content: 'You extract visual scene state updates. Return only valid JSON.',
                },
                {
                    role: 'user',
                    content: patchPrompt,
                },
            ],
            {
                useClassifierBackend: settings.classifierUseSeparateBackend === true,
                max_tokens: settings.classifierMaxTokens ?? 80,
                temperature: settings.classifierTemperature ?? 0.1,
            },
        );

        console.log(`[${extensionName}] extracted scene patch raw`, result);

        const parsed = safeParseJsonObject(result);

        if (!parsed) {
            console.warn(`[${extensionName}] failed to parse scene patch JSON`, result);
            return null;
        }

        console.log(`[${extensionName}] extracted scene patch parsed`, parsed);

        return normalizeScenePatch(parsed);
    }

    return {
        classifyReplyForImage,
        extractScenePatch,
        buildMemoryEvent,
        applyContinuityMemoryToCurrentState,
    };
}
