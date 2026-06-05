import { buildContinuityMemoryPrompt, buildNsfwExtractorPrompt, buildNormalizerPrompt, buildRouterPrompt, buildSafetyPrompt, buildSfwExtractorPrompt } from './prompts.js';
import { parseContinuityMemoryOutput, parseLabeledFields, parseRawExtractionFields } from './parser.js';
import { PROMPT_VERSION } from './labels.js';
import { normalizeNormalizedTags, normalizeRouterResult, normalizeSafetyTags, validateNormalizedTags, validateSafetyTags } from './validator.js';
import {
    ATTIRE_LABELS,
    CLOTHING_STATE_LABELS,
    POSE_LABELS,
    NSFW_STATE_LABELS,
} from './labels.js';

function cleanPromptTag(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^-\s*/, '')
        .replace(/\s+/g, ' ')
        .replace(/^assistant wearing\s+/, '')
        .replace(/^character wearing\s+/, '')
        .replace(/^wearing\s+/, '');
}

function isBadPromptTag(value) {
    const clean = cleanPromptTag(value);

    if (!clean || clean === 'unknown' || clean === 'none') {
        return true;
    }

    if (/^(and|or|with|plus|matching)\b/.test(clean)) {
        return true;
    }

    if (/\b(and|or|with|plus)$/.test(clean)) {
        return true;
    }

    if ([
        'wearing',
        'clothes',
        'clothing',
        'outfit',
        'partial clothing',
        'normal',
        'clothing normal',
        'black',
        'tight',
        'nuzz',
        'nuzzling',
        'nuzzling nose',
        'flirting',
        'hand on',
        'wiggling eyebrows',
        'running fingers along jawline',
    ].includes(clean)) {
        return true;
    }

    return false;
}

function cleanPromptTags(values) {
    const seen = new Set();
    const result = [];

    for (const value of values || []) {
        const clean = cleanPromptTag(value);

        if (isBadPromptTag(clean)) {
            continue;
        }

        if (seen.has(clean)) {
            continue;
        }

        seen.add(clean);
        result.push(clean);
    }

    return result;
}

function getSpecificContinuityDetails(continuitySource) {
    return cleanPromptTags([
        ...(continuitySource?.characters?.character?.prompt_details || []),
        ...(continuitySource?.continuity_facts || []),
    ]);
}

function replaceGenericTagsWithContinuityDetails(tags, continuitySource) {
    const details = getSpecificContinuityDetails(continuitySource);

    if (!details.length) {
        return cleanPromptTags(tags);
    }

    const genericAttire = new Set(ATTIRE_LABELS);
    const genericClothingTags = new Set(
        CLOTHING_STATE_LABELS
            .filter(v => v !== 'unknown' && v !== 'normal')
            .map(v => `${v} clothing`)
    );

    const filtered = cleanPromptTags(tags).filter(tag => {
        const lower = cleanPromptTag(tag);
        if (genericAttire.has(lower)) return false;
        if (genericClothingTags.has(lower)) return false;
        return true;
    });

    // Important: router/image tags stay first; continuity only fills in stable details after.
    return cleanPromptTags([...filtered, ...details]);
}

function extractContinuityAnchorValues(continuitySource) {
    if (!continuitySource || typeof continuitySource !== 'object') {
        return [];
    }

    if (continuitySource.characters && typeof continuitySource.characters === 'object') {
        const character = continuitySource.characters.character || {};

        const promptDetails = Array.isArray(character.prompt_details)
            ? character.prompt_details
            : [];

        const continuityFacts = Array.isArray(continuitySource.continuity_facts)
            ? continuitySource.continuity_facts
            : [];

        const specificClothingDetails = [...promptDetails, ...continuityFacts]
            .map(value => String(value || '').trim())
            .filter(Boolean)
            .filter(value => value !== 'unknown' && value !== 'none');

        const hasSpecificClothingDetails = specificClothingDetails.length > 0;

        const characterAttire =
            typeof character.attire === 'string'
                ? character.attire.trim()
                : '';

        const characterClothingState =
            typeof character.clothing_state === 'string'
                ? character.clothing_state.trim()
                : '';

        const parts = [
            ...specificClothingDetails,

            !hasSpecificClothingDetails ? characterAttire : '',

            !hasSpecificClothingDetails &&
                characterClothingState &&
                characterClothingState !== 'unknown' &&
                characterClothingState !== 'normal'
                ? `${characterClothingState} clothing`
                : '',

            typeof character.pose === 'string' ? character.pose.trim() : '',
            ...(Array.isArray(character.state) ? character.state : []),

            typeof continuitySource.current_location === 'string'
                ? continuitySource.current_location.trim()
                : '',
            typeof continuitySource.current_setting === 'string'
                ? continuitySource.current_setting.trim()
                : '',
        ];

        return parts.filter(Boolean).filter(value => value !== 'unknown');
    }

    return [
        ...(Array.isArray(continuitySource.continuity_facts) ? continuitySource.continuity_facts : []),
        typeof continuitySource.assistantClothing === 'string' ? continuitySource.assistantClothing.trim() : '',
        typeof continuitySource.assistantPose === 'string' ? continuitySource.assistantPose.trim() : '',
        typeof continuitySource.assistantExpression === 'string' ? continuitySource.assistantExpression.trim() : '',
        typeof continuitySource.interaction === 'string' ? continuitySource.interaction.trim() : '',
        typeof continuitySource.environment === 'string' ? continuitySource.environment.trim() : '',
        typeof continuitySource.location === 'string' ? continuitySource.location.trim() : '',
        typeof continuitySource.lighting === 'string' ? continuitySource.lighting.trim() : '',
        ...(Array.isArray(continuitySource.props) ? continuitySource.props : []),
    ].filter(Boolean).filter(value => value !== 'unknown');
}

export function injectConsistencyAnchorTags(rawTags, continuitySource) {
    const cleanedTags = typeof rawTags === 'string'
        ? rawTags.trim().replace(/^["']|["']$/g, '')
        : '';

    const parts = cleanedTags
        ? cleanedTags.split(',').map(tag => tag.trim()).filter(Boolean)
        : [];

    const seen = new Set(parts.map(tag => tag.toLowerCase()));
    const normalizedWholeString = cleanedTags.toLowerCase();
    const consistencyAnchors = extractContinuityAnchorValues(continuitySource);

    for (const anchor of consistencyAnchors.reverse()) {
        const normalized = anchor.toLowerCase();
        if (!seen.has(normalized) && !normalizedWholeString.includes(normalized)) {
            parts.push(anchor);
            seen.add(normalized);
        }
    }

    return parts.join(', ').replace(/\s+,/g, ',').trim();
}

export function buildImageTags(sceneOrNormalized, rawExtraction = null) {
    const normalized = sceneOrNormalized?.normalized_tags || sceneOrNormalized;
    if (!normalized || typeof normalized !== 'object') {
        return [];
    }

    const tags = [];

    if (normalized.action && normalized.action !== 'unknown') {
        tags.push(normalized.action);
    }

    if (normalized.pose && normalized.pose !== 'unknown') {
        tags.push(normalized.pose);
    }

    if (normalized.contact && normalized.contact !== 'none' && normalized.contact !== 'unknown') {
        tags.push(`${normalized.contact} contact`);
    }

    if (normalized.exposure && normalized.exposure !== 'none' && normalized.exposure !== 'unknown') {
        tags.push(`${normalized.exposure} exposure`);
    }

    if (normalized.state && normalized.state !== 'none' && normalized.state !== 'unknown') {
        tags.push(normalized.state);
    }

    if (normalized.appearance_detail && normalized.appearance_detail !== 'none' && normalized.appearance_detail !== 'unknown') {
        tags.push(normalized.appearance_detail);
    }

    if (normalized.fluid && normalized.fluid !== 'none' && normalized.fluid !== 'unknown') {
        tags.push(normalized.fluid);
    }

    if (normalized.fluid_location && normalized.fluid_location !== 'none' && normalized.fluid_location !== 'unknown') {
        tags.push(`${normalized.fluid_location} fluid`);
    }

    if (normalized.attire && normalized.attire !== 'unknown') {
        tags.push(normalized.attire);
    }

    if (normalized.clothing_state && normalized.clothing_state !== 'normal' && normalized.clothing_state !== 'unknown') {
        tags.push(`${normalized.clothing_state} clothing`);
    }

    if (normalized.location && normalized.location !== 'unknown') {
        tags.push(normalized.location);
    }

    if (Array.isArray(rawExtraction?.actions)) {
        for (const action of rawExtraction.actions) {
            const clean = typeof action === 'string' ? action.trim().toLowerCase() : '';
            if (clean && clean !== 'unknown' && clean === normalized.action && !tags.includes(clean)) {
                tags.push(clean);
            }
        }
    }

    return [...new Set(tags)];
}

export function imageTagsToSceneTags(imageTags, continuitySource = null) {
    if (!Array.isArray(imageTags)) {
        return '';
    }

    let deduped = [...new Set(
        imageTags
            .filter(value => typeof value === 'string')
            .map(value => value.trim().toLowerCase())
            .filter(value => value && value !== 'unknown' && value !== 'none')
    )];

    deduped = replaceGenericTagsWithContinuityDetails(deduped, continuitySource);

    return injectConsistencyAnchorTags(deduped.join(', '), continuitySource);
}

export function buildMemoryEvent(scene, currentState = null) {
    const normalized = scene.normalized_tags || {};
    const continuity = scene.continuity_memory || {};
    const now = new Date().toISOString();

    return {
        memory_id: crypto.randomUUID(),
        scene_id: scene.scene_id,
        chat_id: scene.chat_id,
        message_start: scene.message_start,
        message_end: scene.message_end,
        scene_summary: continuity.scene_summary || `${normalized.action || 'unknown'} in ${normalized.location || normalized.setting || 'unknown'}`,
        current_location: continuity.location || normalized.location || 'unknown',
        character_states: currentState?.characters || {},
        continuity_facts: continuity.continuity_facts?.length
            ? continuity.continuity_facts
            : [
                normalized.location && normalized.location !== 'unknown' ? `scene is in ${normalized.location}` : '',
                normalized.pose && normalized.pose !== 'unknown' ? `current pose is ${normalized.pose}` : '',
                normalized.clothing_state && normalized.clothing_state !== 'normal' && normalized.clothing_state !== 'unknown'
                    ? `clothing state is ${normalized.clothing_state}`
                    : '',
            ].filter(Boolean),
        open_threads: continuity.open_threads?.length
            ? continuity.open_threads
            : (normalized.content === 'explicit' || normalized.content === 'suggestive'
                ? ['scene continues']
                : []),
        importance: normalized.content === 'explicit' ? 'high' : 'medium',
        recency_score: 1.0,
        created_at: now,
        updated_at: now,
    };
}

export function mergeCurrentState(currentState, scene, memoryEvent) {
    const normalized = scene.normalized_tags || {};

    return {
        chat_id: scene.chat_id,
        location: normalized.location || currentState?.location || 'unknown',
        setting: normalized.setting || currentState?.setting || 'unknown',
        last_action: normalized.action || currentState?.last_action || 'unknown',
        content: normalized.content || currentState?.content || 'unknown',
        characters: currentState?.characters || {},
        recent_events: [
            ...(currentState?.recent_events || []).slice(-4),
            memoryEvent.scene_summary,
        ].filter(Boolean),
        open_threads: [...new Set([
            ...(currentState?.open_threads || []),
            ...(memoryEvent.open_threads || []),
        ])],
        last_scene_id: scene.scene_id,
        updated_at: new Date().toISOString(),
    };
}

export function buildContinuityInjectionBlock(currentState, recentEvents = [], relevantFacts = [], conflictAware = false) {
    if (!currentState) {
        return '';
    }

    const header = conflictAware ? '[continuity override]' : '[continuity state]';
    const intro = conflictAware
        ? 'Use these facts as current canon. These facts supersede older chat history or summaries if there is a conflict.'
        : 'Use these facts as the current scene state. If older chat history or summaries conflict, these facts win unless the latest user message changes them.';

    const lines = [
        header,
        intro,
        '',
        'Current scene:',
        `- location: ${currentState.location || 'unknown'}`,
        `- setting: ${currentState.setting || 'unknown'}`,
        `- last action: ${currentState.last_action || 'unknown'}`,
    ];

    for (const event of (recentEvents || []).slice(-5)) {
        lines.push(`- recent event: ${event}`);
    }

    for (const fact of (relevantFacts || []).slice(0, 8)) {
        lines.push(`- ${fact}`);
    }

    lines.push(conflictAware ? '[/continuity override]' : '[/continuity state]');
    return lines.join('\n');
}

export async function runSceneTaggingPipeline({
    input,
    callChat,
    classifierOptions,
    currentState = null,
}) {
    const chatLog = input.source_text;
    const routerOutput = await callChat([
        { role: 'system', content: 'You route scene content. Return only the requested labeled fields.' },
        { role: 'user', content: buildRouterPrompt(chatLog) },
    ], classifierOptions);

    const routerResult = normalizeRouterResult(parseLabeledFields(routerOutput, ['content', 'route', 'reason']));
    if (!routerResult) {
        throw new Error('Failed to parse router output.');
    }

    const extractorPrompt = routerResult.route === 'sfw'
        ? buildSfwExtractorPrompt(chatLog)
        : buildNsfwExtractorPrompt(chatLog);

    const rawOutput = await callChat([
        { role: 'system', content: routerResult.route === 'sfw' ? 'You extract direct sfw scene details. Return only the requested labeled fields.' : 'You extract direct nsfw scene details. Return only the requested labeled fields.' },
        { role: 'user', content: extractorPrompt },
    ], classifierOptions);

    const rawExtraction = routerResult.route === 'sfw'
        ? parseRawExtractionFields(rawOutput, {
            actions: 'array',
            poses: 'array',
            location: 'string',
            attire: 'array',
            setting: 'string',
        })
        : parseRawExtractionFields(rawOutput, {
            actions: 'array',
            poses: 'array',
            'body contact': 'array',
            exposure: 'array',
            location: 'string',
            attire: 'array',
            setting: 'string',
        });

    const normalizerOutput = await callChat([
        { role: 'system', content: 'You normalize scene details into strict labels. Return only the requested labeled fields.' },
        { role: 'user', content: buildNormalizerPrompt(routerResult, rawOutput) },
    ], classifierOptions);

    const normalizedTags = normalizeNormalizedTags(parseLabeledFields(normalizerOutput, [
        'content',
        'action group',
        'action',
        'pose',
        'exposure',
        'contact',
        'state',
        'appearance detail',
        'fluid',
        'fluid location',
        'location',
        'attire',
        'clothing state',
        'setting',
    ]));

    if (!normalizedTags || !validateNormalizedTags(normalizedTags)) {
        throw new Error('Normalizer output failed validation.');
    }

    const safetyOutput = await callChat([
        { role: 'system', content: 'You classify safety metadata. Return only the requested labeled fields.' },
        { role: 'user', content: buildSafetyPrompt(chatLog, normalizedTags) },
    ], classifierOptions);

    const safetyTags = normalizeSafetyTags(parseLabeledFields(safetyOutput, ['age', 'consent', 'risk', 'reason']));
    if (!safetyTags || !validateSafetyTags(safetyTags)) {
        throw new Error('Safety output failed validation.');
    }

    const imageTags = buildImageTags({ normalized_tags: normalizedTags }, rawExtraction);

    const continuityOutput = await callChat([
        { role: 'system', content: 'You extract continuity memory facts. Return only the requested labeled fields.' },
        { role: 'user', content: buildContinuityMemoryPrompt(chatLog, currentState, normalizedTags) },
    ], classifierOptions);

    const continuityFields = parseContinuityMemoryOutput(continuityOutput) || {
        scene_summary: 'unknown',
        location: normalizedTags.location,
        setting: normalizedTags.setting,
        user_state: [],
        character_state: [],
        last_action: normalizedTags.action,
        continuity_facts: [],
        open_threads: [],
    };

    const scene = {
        scene_id: crypto.randomUUID(),
        chat_id: input.chat_id,
        character_id: input.character_id,
        source: 'sillytavern',
        message_start: input.message_start,
        message_end: input.message_end,
        scene_index: input.message_end,
        source_text: chatLog,
        router_result: routerResult,
        raw_extraction: rawExtraction,
        normalized_tags: normalizedTags,
        image_tags: imageTags,
        safety_tags: safetyTags,
        continuity_memory: {
            scene_summary: continuityFields.scene_summary || 'unknown',
            location: continuityFields.location || normalizedTags.location,
            setting: continuityFields.setting || normalizedTags.setting,
            user_state: continuityFields.user_state || [],
            character_state: continuityFields.character_state || [],
            last_action: continuityFields.last_action || normalizedTags.action,
            continuity_facts: continuityFields.continuity_facts || [],
            open_threads: continuityFields.open_threads || [],
        },
        extractor_version: 'router-split-v2',
        archived: false,
        model: input.model,
        prompt_version: PROMPT_VERSION,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    return scene;
}
