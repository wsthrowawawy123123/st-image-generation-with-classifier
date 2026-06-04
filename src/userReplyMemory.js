import { dedupeFacts } from './memory.js';

export const DEFAULT_USER_REPLY_MEMORY_SETTINGS = {
    userReplyMemoryEnabled: true,
    detectCorrectionsWithRegex: true,
    runLlmCorrectionExtractor: true,
    showUserCorrectionsInPrompt: true,
    maxUserAssertions: 20,
    maxTemporaryGuidance: 10,
};

const CORRECTION_REGEX = /\b(no|actually|remember|we are still|we're still|you forgot|not that|that didn't happen|i said|i'm still|she is still|he is still|we're in|we are in|i'm wearing|you're wearing|she's wearing|he's wearing)\b/i;

function parseCommaList(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'unknown' || text === 'none') {
        return [];
    }

    return text.split(',').map(item => item.trim()).filter(Boolean);
}

export function detectUserCorrection(message) {
    return CORRECTION_REGEX.test(String(message || ''));
}

export function buildUserReplyMemoryPrompt(message, currentState) {
    return `You are a user correction and steering extractor.

Extract facts from the latest user message that should update scene continuity.
User messages have high priority and may correct previous assistant mistakes.

Return exactly:
Correction:
State changes:
Location:
User state:
Character state:
Temporary guidance:
New facts:

Rules:
- Use lowercase only.
- Keep values short.
- Do not write prose.
- Do not invent details.
- If no correction exists, write none.
- If unknown, write unknown.
- User corrections override older assistant messages.
- Latest user message wins unless it is unclear.

Latest user message:
${message}

Current state:
${JSON.stringify(currentState || {})}`;
}

export function parseUserReplyMemoryOutput(output) {
    if (typeof output !== 'string') {
        return null;
    }

    const result = {};
    for (const line of output.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx === -1) {
            continue;
        }
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim().toLowerCase();
        result[key] = value || 'unknown';
    }

    return {
        correction: result.correction || 'unknown',
        state_changes: parseCommaList(result['state changes']),
        location: result.location || 'unknown',
        user_state: parseCommaList(result['user state']),
        character_state: parseCommaList(result['character state']),
        temporary_guidance: parseCommaList(result['temporary guidance']),
        new_facts: parseCommaList(result['new facts']),
    };
}

export function applyUserReplyMemoryToCurrentState(currentState, userReplyMemory, options = {}) {
    const state = structuredClone(currentState || {});
    const memory = userReplyMemory || {};
    const now = new Date().toISOString();
    const maxUserAssertions = options.maxUserAssertions || 20;
    const maxTemporaryGuidance = options.maxTemporaryGuidance || 10;

    state.user_assertions = Array.isArray(state.user_assertions) ? state.user_assertions : [];
    state.temporary_guidance = Array.isArray(state.temporary_guidance) ? state.temporary_guidance : [];
    state.corrections = Array.isArray(state.corrections) ? state.corrections : [];
    state.continuity_facts = Array.isArray(state.continuity_facts) ? state.continuity_facts : [];

    if (memory.location && memory.location !== 'unknown') {
        const oldValue = state.current_location || 'unknown';
        state.current_location = memory.location;
        state.user_assertions.push({
            fact: `scene is ${memory.correction === 'yes' ? 'still ' : 'in '}${memory.location}`.replace('in still', 'still in'),
            field: 'location',
            value: memory.location,
            priority: memory.correction === 'yes' ? 'high' : 'normal',
            source: 'user',
            created_at: now,
        });

        if (oldValue !== memory.location && oldValue !== 'unknown') {
            state.corrections.push({
                field: 'location',
                old_value: oldValue,
                new_value: memory.location,
                source: 'user',
                created_at: now,
            });
        }
    }

    if ((memory.user_state || []).length) {
        state.user_assertions.push({
            fact: memory.user_state.join(', '),
            field: 'user_state',
            value: memory.user_state.join(', '),
            priority: memory.correction === 'yes' ? 'high' : 'normal',
            source: 'user',
            created_at: now,
        });
    }

    state.temporary_guidance = dedupeFacts([
        ...(state.temporary_guidance || []),
        ...(memory.temporary_guidance || []),
        ...(memory.character_state || []),
    ]).slice(-maxTemporaryGuidance);

    state.user_assertions = state.user_assertions.slice(-maxUserAssertions);
    state.continuity_facts = dedupeFacts([
        ...(state.continuity_facts || []),
        ...(memory.new_facts || []),
    ]);
    state.updated_at = now;

    return state;
}
