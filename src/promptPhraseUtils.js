export function createPromptPhraseId({
    now = Date.now(),
    random = Math.random(),
} = {}) {
    return `phrase_${now}_${random.toString(36).slice(2, 8)}`;
}

export function createPromptPhraseItem(text = '', options = {}) {
    return {
        id: createPromptPhraseId(options),
        enabled: true,
        text,
    };
}

export function normalizePromptPhrases(items, options = {}) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            id: typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : createPromptPhraseId(options),
            enabled: item.enabled !== false,
            text: typeof item.text === 'string' ? item.text : '',
        }));
}

export function buildPromptFromPhrases(phrases, sceneTags) {
    const orderedParts = normalizePromptPhrases(phrases)
        .filter(item => item.enabled)
        .map(item => item.text.trim())
        .filter(Boolean);

    const cleanedSceneTags = typeof sceneTags === 'string'
        ? sceneTags.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\n/g, ' ').trim()
        : '';

    if (cleanedSceneTags) {
        orderedParts.push(cleanedSceneTags);
    }

    return orderedParts.join(', ').replace(/\s+,/g, ',').trim();
}
