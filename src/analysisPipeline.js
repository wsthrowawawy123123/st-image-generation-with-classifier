import { buildSceneMemoryAnchorTags } from './sceneMemory.js';

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

export function cleanSanitizedTagOutput(raw) {
    if (typeof raw !== 'string') {
        return '';
    }

    let cleaned = raw.trim().replace(/^["']|["']$/g, '');
    cleaned = cleaned.split(/\n\s*\n/)[0];
    cleaned = cleaned.split(/\n/)[0];
    cleaned = cleaned.replace(/\s*Note:.*$/i, '').trim();
    cleaned = cleaned.replace(/^\*(.+)\*$/s, '$1').trim();
    cleaned = cleaned.replace(/^\((.+)\)$/s, '$1').trim();

    return cleaned;
}

export function createAnalysisPipeline({
    extensionName,
    getSettings,
    getSceneMemory,
    getImageAnalysisTextContext,
    normalizeScenePatch,
    callChat,
}) {
    function buildSceneMemoryBlock() {
        const settings = getSettings();
        const sceneMemory = getSceneMemory();

        if (!settings.sceneMemory?.enabled) {
            return 'Current scene memory: (disabled)';
        }

        return `Current scene memory:
            - location: ${sceneMemory.location || '(unknown)'}
            - environment: ${sceneMemory.environment || '(unknown)'}
            - assistant pose: ${sceneMemory.assistantPose || '(unknown)'}
            - assistant clothing: ${sceneMemory.assistantClothing || '(unknown)'}
            - assistant expression: ${sceneMemory.assistantExpression || '(unknown)'}
            - interaction: ${sceneMemory.interaction || '(unknown)'}
            - props: ${sceneMemory.props?.length ? sceneMemory.props.join(', ') : '(none)'}
            - lighting: ${sceneMemory.lighting || '(unknown)'}
            - mood: ${sceneMemory.mood || '(unknown)'}`;
        }

    async function classifyReplyForImage(context) {
        const settings = getSettings();
        const {
            assistantText,
            previousAssistantText: prevAssistantText,
        } = getImageAnalysisTextContext(context);

        const evaluatorPrompt = `Evaluate the CURRENT assistant reply for image generation.

        Return JSON only with this exact schema:
        {"generate":true,"category":"nsfw_action","weight":0.95}

        Valid categories:
        - "nsfw_action"
        - "selfie_request"
        - "location_change"
        - "food_or_object_focus"
        - "physical_interaction"
        - "pose_change"
        - "ambient_scene"
        - "dialogue_only"

        Rules:
        - Base the judgment primarily on the CURRENT assistant reply.
        - Use Previous assistant context only to resolve ambiguity.
        - Evaluate the currently visible moment, not the broader relationship arc or what may have happened immediately before.
        - Be willing to generate for visually descriptive, emotionally charged, or compositionally clear moments even when the action is subtle.
        - "generate" should be false only when the reply is mostly non-visual dialogue or offers almost no concrete imageable detail.
        - "weight" must be a number between 0.0 and 1.0.
        - Use "nsfw_action" only when the CURRENT assistant reply describes explicit ongoing sexual activity, explicit sexual contact, or clearly visible nudity/exposure in the present moment.
        - Do not use "nsfw_action" for aftermath, lingering attraction, romantic tension, affectionate hand-holding, kissing that is not explicit, or scene transitions after intimacy. Those should usually be "physical_interaction", "pose_change", or "ambient_scene".
        - Do not use "nsfw_action" for flirtation, suggestive atmosphere, partial undressing, teasing behavior, knowing looks, or seductive setup unless explicit sexual contact or explicit exposure is already happening in the current visible moment.
        - If explicit sexual content is mentioned only as past context, aftermath, explanation, memory, or emotional carryover, do not use "nsfw_action".
        - If the present-moment frame is mainly entering a room, walking together, looking around, removing shoes, adjusting clothing, holding hands, smiling, or observing the environment, prefer "physical_interaction", "pose_change", or "ambient_scene".
        - Sexual or intimate physical action that is explicit in the current moment should usually be high weight.
        - Rich visual description, clear staging, notable pose changes, strong atmosphere, or emotionally intimate framing should usually lean toward generate=true with moderate-to-high weight.
        - Clear requests for photos/selfies should usually be weight 1.0.
        - Major scene/location changes should usually be high weight.
        - Pure dialogue with no visible narration should be generate=false and weight=0.0.
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
                    content: 'You evaluate visual importance for image generation. Return only valid JSON.',
                },
                {
                    role: 'user',
                    content: evaluatorPrompt,
                },
            ],
            {
                useClassifierBackend: settings.classifierUseSeparateBackend === true,
                max_tokens: settings.classifierMaxTokens ?? 80,
                temperature: settings.classifierTemperature ?? 0.1,
            },
        );

        const parsed = safeParseJsonObject(result);

        if (!parsed) {
            console.warn(`[${extensionName}] failed to parse scene weighting JSON`, result);
            return {
                generate: false,
                category: 'dialogue_only',
                weight: 0,
            };
        }

        return {
            generate: parsed?.generate === true,
            category: typeof parsed?.category === 'string' ? parsed.category : 'dialogue_only',
            weight: Math.max(0, Math.min(1, Number(parsed?.weight) || 0)),
        };
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
                max_tokens: Math.max(settings.classifierMaxTokens ?? 80, 160),
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

    async function generateImageTagFromReply(context) {
        const settings = getSettings();
        const sceneMemory = getSceneMemory();
        const {
            assistantText,
            previousAssistantText: prevAssistantText,
        } = getImageAnalysisTextContext(context);
        const memoryBlock = buildSceneMemoryBlock();

        console.log(`[${extensionName}] scene continuity context for prompt generation`, {
            sceneMemoryEnabled: settings.sceneMemory?.enabled === true,
            sceneMemory: structuredClone(sceneMemory),
            previousAssistantPreview: prevAssistantText.slice(0, 160),
            latestAssistantPreview: assistantText.slice(0, 160),
        });

        const promptBuilderRequest = `Select the single most visually representative moment from the CURRENT assistant reply.

        Convert that moment into concise visual tags for image generation.

        Base the tags primarily on the CURRENT assistant reply.
        Use Previous assistant context only to resolve ambiguity or maintain scene continuity.
        Use Current scene memory to preserve stable details unless the CURRENT assistant reply clearly changes them.

        Rules:
        - comma separated
        - 1 to 4 words per tag
        - 12 to 20 tags total
        - no sentences
        - no explanations
        - no markup
        - only visible elements
        - do not invent details not clearly visible
        - preserve continuity with scene memory unless explicitly changed
        - include stable clothing, pose, environment, props, and lighting details from scene memory when they are still visually relevant

        Perspective rule:
        If the narration addresses "you" or is written from the assistant's point of view,
        include the tag: first person perspective.
        Otherwise use third person perspective if the scene is externally observed.

        Prefer body position tags like: kneeling pose, sitting pose, leaning pose, straddling pose.

        Tag priority order:
        1. camera or perspective
        2. body position or pose
        3. facial expression or gaze
        4. clothing state or exposure
        5. physical contact or interaction
        6. environment or furniture
        7. lighting or atmosphere

        Prefer static visual states over motion verbs.

        Example output:
        first person perspective, kneeling pose, looking up, open blouse, office desk, warm lighting

        ${memoryBlock}

        Previous assistant context:
        ${prevAssistantText || '(none)'}

        Current assistant reply:
        ${assistantText}`;

        const sceneTags = await callChat(
            [
                {
                    role: 'system',
                    content: 'You convert scene narration into concise visual tags for image generation.',
                },
                {
                    role: 'user',
                    content: promptBuilderRequest,
                },
            ],
            {
                max_tokens: settings.promptMaxTokens ?? 120,
                temperature: settings.promptTemperature ?? 0.4,
            },
        );

        return sceneTags.trim().replace(/^["']|["']$/g, '');
    }

    async function sanitizeImagePrompt(rawSceneTags, context) {
        const settings = getSettings();
        if (!settings.promptSanitizer?.enabled) {
            return rawSceneTags;
        }

        const sceneMemory = getSceneMemory();
        const { assistantText } = getImageAnalysisTextContext(context);
        const sanitizedInput = typeof rawSceneTags === 'string' ? rawSceneTags.trim() : '';
        const memoryAnchorTags = settings.sceneMemory?.enabled
            ? buildSceneMemoryAnchorTags(sceneMemory)
            : '';

        if (!sanitizedInput) {
            return '';
        }

        const sanitizePrompt = `Rewrite these image tags for stable diffusion.

    Rules:
    - output comma-separated tags only
    - 1-4 words per tag
    - 12-20 tags max
    - remove duplicates and near-duplicates
    - keep character identity traits if present
    - keep pose, clothing, interaction, environment, and lighting only if visually clear
    - preserve stable pose, clothing, expression, interaction, environment, prop, and lighting details from Scene memory unless the CURRENT assistant reply clearly changes them
    - remove glamorized, glossy, or beauty-editorial wording unless explicitly required by the source
    - prefer natural photographic wording when lighting is ambiguous
    - prefer concrete visible nouns, poses, expressions, framing, clothing, props, and lighting
    - keep interaction tags only if they describe something directly visible, like holding hands or touching shoulder
    - drop inferred action, backstory, sequence, or transition language
    - drop abstract emotion labels like happy mood, affectionate mood, playful energy, romantic tension
    - drop non-visual bodily sensations or internal states like shaky legs, nervousness, arousal, anticipation
    - rewrite vague expression tags into visible facial cues when possible, like smiling, parted lips, looking away
    - do not add new details
    - output exactly one line of comma-separated tags
    - do not include notes, explanations, reasoning, labels, or any extra text before or after the tags
    - if you add anything other than comma-separated tags, the output is invalid
    - do not write sentences
    - do not use quotes
    - respond with tags only

    Current assistant reply:
    ${assistantText || '(none)'}

    Scene memory:
    ${memoryAnchorTags || '(none)'}

    Input tags:
    ${sanitizedInput}`;

        const result = await callChat(
            [
                {
                    role: 'system',
                    content: 'You sanitize image-generation tags. Return only concise comma-separated tags.',
                },
                {
                    role: 'user',
                    content: sanitizePrompt,
                },
            ],
            {
                max_tokens: Math.max(200, Math.min(settings.promptMaxTokens ?? 400, 400)),
                temperature: Math.min(settings.promptTemperature ?? 0.4, 0.2),
            },
        );

        return cleanSanitizedTagOutput(result);
    }

    return {
        classifyReplyForImage,
        extractScenePatch,
        generateImageTagFromReply,
        sanitizeImagePrompt,
    };
}
