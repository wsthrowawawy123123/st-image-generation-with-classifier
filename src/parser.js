export function parseFieldOutput(output) {
    if (typeof output !== 'string') {
        return null;
    }

    const result = {};
    const lines = output.split(/\r?\n/);

    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1) {
            continue;
        }

        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim().toLowerCase();

        if (!key) {
            continue;
        }

        result[key] = value || 'unknown';
    }

    return result;
}

export function parseListValue(value) {
    if (!value || typeof value !== 'string' || value.trim().toLowerCase() === 'unknown') {
        return [];
    }

    return value
        .split(',')
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

export function parseLabeledFields(raw, fieldNames) {
    if (typeof raw !== 'string' || !Array.isArray(fieldNames)) {
        return null;
    }

    const parsed = parseFieldOutput(raw);
    if (!parsed) {
        return null;
    }

    const result = Object.fromEntries(fieldNames.map(name => [name, 'unknown']));

    for (const fieldName of fieldNames) {
        const normalizedFieldName = fieldName.toLowerCase();
        if (parsed[normalizedFieldName] !== undefined) {
            result[normalizedFieldName] = parsed[normalizedFieldName];
        }
    }

    return result;
}

export function parseRawExtractionFields(raw, schema) {
    if (typeof raw !== 'string' || !schema || typeof schema !== 'object') {
        return null;
    }

    const parsed = parseFieldOutput(raw);
    if (!parsed) {
        return null;
    }

    const result = {};

    for (const [field, kind] of Object.entries(schema)) {
        const value = parsed[field.toLowerCase()] ?? 'unknown';
        result[field] = kind === 'array'
            ? (value === 'unknown' ? ['unknown'] : parseListValue(value))
            : value;
    }

    return result;
}

export function parseContinuityMemoryOutput(output) {
    const parsed = parseFieldOutput(output);
    if (!parsed) {
        return null;
    }

    return {
        scene_summary: parsed['scene summary'] || 'unknown',
        location: parsed.location || 'unknown',
        setting: parsed.setting || 'unknown',
        user_state: parseListValue(parsed['user state']),
        character_state: parseListValue(parsed['character state']),
        last_action: parsed['last action'] || 'unknown',
        continuity_facts: parseListValue(parsed['continuity facts']),
        open_threads: parseListValue(parsed['open threads']),
    };
}
