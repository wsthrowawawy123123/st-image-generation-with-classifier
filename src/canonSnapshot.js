export const DEFAULT_CANON_SNAPSHOT = {
    chat_id: '',
    character_id: '',
    character_name: 'unknown',
    user_persona: 'unknown',
    scenario: 'unknown',
    relationship: 'unknown',
    baseline_demeanor: 'unknown',
    baseline_personality: [],
    speaking_style: 'unknown',
    default_outfit: 'unknown',
    default_appearance: [],
    default_location: 'unknown',
    world_facts: [],
    canon_facts: [],
    source_fields: {
        character_description: false,
        personality: false,
        scenario: false,
        first_message: false,
        example_messages: false,
        persona: false,
        lorebook: false,
        authors_note: false,
        outfit_prompt: false,
    },
    created_at: '',
    updated_at: '',
};

function parseCommaList(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'unknown') {
        return [];
    }

    return text.split(',').map(item => item.trim()).filter(Boolean);
}

export function parseCanonSnapshotOutput(output) {
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
        character_name: result['character name'] || 'unknown',
        user_persona: result['user persona'] || 'unknown',
        scenario: result.scenario || 'unknown',
        relationship: result.relationship || 'unknown',
        baseline_demeanor: result['baseline demeanor'] || 'unknown',
        baseline_personality: parseCommaList(result['baseline personality']),
        speaking_style: result['speaking style'] || 'unknown',
        default_outfit: result['default outfit'] || 'unknown',
        default_appearance: parseCommaList(result['default appearance']),
        default_location: result['default location'] || 'unknown',
        world_facts: parseCommaList(result['world facts']),
        canon_facts: parseCommaList(result['canon facts']),
    };
}

export function buildCanonSnapshotPrompt(setUpFields) {
    return `You are a canon snapshot extractor.

Extract baseline character, persona, scenario, outfit, demeanor, and worldbuilding facts.
These facts describe what is normally true at the start of the chat.
Do not include temporary scene changes unless they are part of the starting scenario.

Return exactly:
Character name:
User persona:
Scenario:
Relationship:
Baseline demeanor:
Baseline personality:
Speaking style:
Default outfit:
Default appearance:
Default location:
World facts:
Canon facts:

Rules:
- Use lowercase only.
- Keep values short.
- Use comma-separated values for lists.
- Do not write prose.
- Do not invent details.
- If unknown, write unknown.
- Canon is baseline setup, not current scene state.

SillyTavern setup fields:
${JSON.stringify(setUpFields)}`;
}

export function buildCanonSnapshotFromContext(context) {
    const name = context.name2 || context.characterName || 'unknown';
    const character = Array.isArray(context.characters) && Number.isInteger(context.characterId)
        ? context.characters[context.characterId]
        : null;

    return {
        ...DEFAULT_CANON_SNAPSHOT,
        chat_id: String(context.chatId || context.groupId || context.characterId || 'current-chat'),
        character_id: String(context.characterId || context.name2 || 'current-character'),
        character_name: String(name || 'unknown').trim().toLowerCase(),
        user_persona: String(context.name1 || context.userName || 'unknown').trim().toLowerCase(),
        scenario: String(character?.scenario || context.scenario || 'unknown').trim().toLowerCase(),
        relationship: 'unknown',
        baseline_demeanor: 'unknown',
        baseline_personality: [],
        speaking_style: 'unknown',
        default_outfit: 'unknown',
        default_appearance: [],
        default_location: 'unknown',
        world_facts: [],
        canon_facts: [],
        source_fields: {
            character_description: Boolean(character?.description),
            personality: Boolean(character?.personality),
            scenario: Boolean(character?.scenario || context.scenario),
            first_message: Boolean(character?.first_mes),
            example_messages: Boolean(character?.mes_example),
            persona: Boolean(context.name1 || context.userName),
            lorebook: false,
            authors_note: false,
            outfit_prompt: false,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

export function buildCanonMemoryBlock(canonSnapshot, options = {}) {
    if (!canonSnapshot || options.includeCanonInMemoryBlock === false || options.canonEnabled === false) {
        return '';
    }

    const lines = ['[canon]'];

    if (canonSnapshot.character_name && canonSnapshot.character_name !== 'unknown') {
        lines.push(`Character: ${canonSnapshot.character_name}`);
    }

    const baseline = [
        canonSnapshot.baseline_demeanor,
        ...(canonSnapshot.baseline_personality || []),
    ].filter(Boolean).filter(value => value !== 'unknown');
    if (baseline.length) {
        lines.push(`Baseline: ${baseline.join(', ')}`);
    }

    if (canonSnapshot.scenario && canonSnapshot.scenario !== 'unknown') {
        lines.push(`Scenario: ${canonSnapshot.scenario}`);
    }

    if (canonSnapshot.default_outfit && canonSnapshot.default_outfit !== 'unknown') {
        lines.push(`Default outfit: ${canonSnapshot.default_outfit}`);
    }

    if (canonSnapshot.relationship && canonSnapshot.relationship !== 'unknown') {
        lines.push(`Relationship: ${canonSnapshot.relationship}`);
    }

    lines.push('[/canon]');
    const block = lines.join('\n');
    const maxCanonChars = options.maxCanonChars || 600;
    return block.length <= maxCanonChars ? block : `${block.slice(0, Math.max(0, maxCanonChars - 4)).trim()}\n...]`;
}
