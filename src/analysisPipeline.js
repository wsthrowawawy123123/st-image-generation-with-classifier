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

export function normalizedTagsToSceneTags(normalizedTags, continuitySource = null, rawExtraction = null) {
    return imageTagsToSceneTags(buildImageTags({ normalized_tags: normalizedTags }, rawExtraction), continuitySource);
}

export function createAnalysisPipeline({
    extensionName,
    getSettings,
    getImageAnalysisTextContext,
    callChat,
}) {
    function mapSceneRecordToSceneEval(sceneRecord) {
        const normalized = sceneRecord.normalized_tags;
        const safetyTags = sceneRecord.safety_tags;
        const unknownFields = [
            'content',
            'action',
            'pose',
            'exposure',
            'contact',
            'location',
            'attire',
            'setting',
        ].filter(field => ['unknown', '', null, undefined].includes(normalized?.[field]));
        const classifierQuality = {
            level: unknownFields.length >= 5 || normalized?.content === 'unknown' ? 'low' : unknownFields.length >= 3 ? 'medium' : 'high',
            unknownFields,
        };

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
            classifierQuality,
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
    return {
        classifyReplyForImage,
        buildMemoryEvent,
        applyContinuityMemoryToCurrentState,
    };
}
