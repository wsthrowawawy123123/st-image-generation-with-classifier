import {
    ATTIRE_LABELS,
    CLOTHING_STATE_LABELS,
    NSFW_STATE_LABELS,
    POSE_LABELS,
} from './labels.js';

export const DEFAULT_CURRENT_STATE = {
    chat_id: '',
    current_location: 'unknown',
    current_setting: 'unknown',
    current_scene: 'unknown',
    characters: {
        user: {
            pose: 'unknown',
            attire: 'unknown',
            clothing_state: 'unknown',
            state: [],
        },
        character: {
            pose: 'unknown',
            attire: 'unknown',
            clothing_state: 'unknown',
            state: [],
        },
    },
    last_action: 'unknown',
    recent_events: [],
    continuity_facts: [],
    open_threads: [],
    last_source_scene_id: 'unknown',
    updated_at: '',
};

export const DEFAULT_MEMORY_SETTINGS = {
    memoryEnabled: true,
    memoryMode: 'light',
    maxMemoryChars: 1200,
    includeRecentEvents: true,
    includeOpenThreads: true,
    injectPosition: 'before_latest_message',
    debugShowMemoryBlock: false,
};

export function normalizeFact(fact) {
    return String(fact || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function dedupeFacts(facts) {
    const seen = new Set();
    const result = [];

    for (const fact of facts || []) {
        const key = normalizeFact(fact);
        if (!key || key === 'unknown') {
            continue;
        }
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(key);
    }

    return result;
}

function firstMatching(values, allowed) {
    const allowedSet = new Set(allowed);
    for (const value of values || []) {
        const clean = normalizeFact(value);
        if (allowedSet.has(clean)) {
            return clean;
        }
    }
    return 'unknown';
}

function matchingStates(values) {
    const allowedSet = new Set(NSFW_STATE_LABELS);
    return dedupeFacts((values || []).filter(value => allowedSet.has(normalizeFact(value))));
}

function parseCharacterState(values = []) {
    return {
        pose: firstMatching(values, POSE_LABELS),
        attire: firstMatching(values, ATTIRE_LABELS),
        clothing_state: firstMatching(values, CLOTHING_STATE_LABELS),
        state: matchingStates(values),
    };
}

function mergeCharacterState(current, incoming) {
    return {
        pose: incoming.pose !== 'unknown' ? incoming.pose : (current?.pose || 'unknown'),
        attire: incoming.attire !== 'unknown' ? incoming.attire : (current?.attire || 'unknown'),
        clothing_state: incoming.clothing_state !== 'unknown' ? incoming.clothing_state : (current?.clothing_state || 'unknown'),
        state: dedupeFacts([...(current?.state || []), ...(incoming.state || [])]),
    };
}

export function applyContinuityMemoryToCurrentState(currentState, memoryOutput, sourceSceneId, normalizedTags = null) {
    const base = structuredClone(currentState || DEFAULT_CURRENT_STATE);
    const memory = memoryOutput || {};
    const normalized = normalizedTags || {};

    const userState = mergeCharacterState(base.characters?.user, parseCharacterState(memory.user_state));
    const characterState = mergeCharacterState(base.characters?.character, parseCharacterState(memory.character_state));

    if (normalized.pose && normalized.pose !== 'unknown' && userState.pose === 'unknown') {
        userState.pose = normalized.pose;
    }
    if (normalized.attire && normalized.attire !== 'unknown' && userState.attire === 'unknown') {
        userState.attire = normalized.attire;
    }
    if (normalized.clothing_state && normalized.clothing_state !== 'unknown' && userState.clothing_state === 'unknown') {
        userState.clothing_state = normalized.clothing_state;
    }

    return {
        ...base,
        chat_id: base.chat_id || '',
        current_location: memory.location && memory.location !== 'unknown'
            ? memory.location
            : (normalized.location && normalized.location !== 'unknown' ? normalized.location : base.current_location),
        current_setting: memory.setting && memory.setting !== 'unknown'
            ? memory.setting
            : (normalized.setting && normalized.setting !== 'unknown' ? normalized.setting : base.current_setting),
        current_scene: memory.scene_summary && memory.scene_summary !== 'unknown'
            ? memory.scene_summary
            : base.current_scene,
        characters: {
            user: userState,
            character: characterState,
        },
        last_action: memory.last_action && memory.last_action !== 'unknown'
            ? memory.last_action
            : (normalized.action && normalized.action !== 'unknown' ? normalized.action : base.last_action),
        recent_events: dedupeFacts([
            ...(base.recent_events || []),
            memory.scene_summary,
            ...(memory.continuity_facts || []),
        ]).slice(-5),
        continuity_facts: dedupeFacts([
            ...(base.continuity_facts || []),
            ...(memory.continuity_facts || []),
        ]).slice(-30),
        open_threads: dedupeFacts([
            ...(base.open_threads || []),
            ...(memory.open_threads || []),
        ]).slice(-10),
        last_source_scene_id: sourceSceneId || base.last_source_scene_id || 'unknown',
        updated_at: new Date().toISOString(),
    };
}

function trimBlockToChars(block, maxChars) {
    if (!maxChars || block.length <= maxChars) {
        return block;
    }

    return `${block.slice(0, Math.max(0, maxChars - 4)).trim()}\n...]`;
}

function formatCharacterLine(label, characterState) {
    const parts = [
        characterState?.pose,
        characterState?.attire,
        characterState?.clothing_state && characterState.clothing_state !== 'unknown' ? `clothing ${characterState.clothing_state}` : '',
        ...(characterState?.state || []),
    ].filter(Boolean).filter(part => part !== 'unknown');

    return parts.length ? `${label}: ${parts.join(', ')}` : '';
}

export function buildContinuityMemoryBlock(currentState, options = {}) {
    const settings = { ...DEFAULT_MEMORY_SETTINGS, ...options };

    if (!settings.memoryEnabled || settings.memoryMode === 'off' || !currentState) {
        return '';
    }

    if (!currentState.current_location && !currentState.current_scene) {
        return '';
    }

    const lines = [
        '[continuity state]',
        'Use these facts as the current scene state. If older chat history or summaries conflict, follow these facts unless the latest user message changes them.',
        '',
    ];

    if (currentState.current_location && currentState.current_location !== 'unknown') {
        lines.push(`Location: ${currentState.current_location}`);
    }

    if (currentState.current_setting && currentState.current_setting !== 'unknown') {
        lines.push(`Setting: ${currentState.current_setting}`);
    }

    if (currentState.current_scene && currentState.current_scene !== 'unknown' && settings.memoryMode === 'strong') {
        lines.push(`Scene: ${currentState.current_scene}`);
    }

    const userLine = formatCharacterLine('User', currentState.characters?.user);
    const characterLine = formatCharacterLine('Character', currentState.characters?.character);

    if (userLine) {
        lines.push(userLine);
    }

    if (characterLine) {
        lines.push(characterLine);
    }

    if (currentState.last_action && currentState.last_action !== 'unknown') {
        lines.push(`Last action: ${currentState.last_action}`);
    }

    if (settings.memoryMode === 'strong' && settings.includeRecentEvents && (currentState.recent_events || []).length) {
        lines.push('Recent events:');
        for (const event of (currentState.recent_events || []).slice(-5)) {
            lines.push(`- ${event}`);
        }
    }

    if ((currentState.continuity_facts || []).length) {
        const factLimit = settings.memoryMode === 'strong' ? 8 : 4;
        lines.push('Continuity facts:');
        for (const fact of (currentState.continuity_facts || []).slice(0, factLimit)) {
            lines.push(`- ${fact}`);
        }
    }

    if (settings.memoryMode === 'strong' && settings.includeOpenThreads && (currentState.open_threads || []).length) {
        lines.push('Open threads:');
        for (const thread of (currentState.open_threads || []).slice(0, 5)) {
            lines.push(`- ${thread}`);
        }
    }

    lines.push('[/continuity state]');

    return trimBlockToChars(lines.join('\n'), settings.maxMemoryChars);
}
