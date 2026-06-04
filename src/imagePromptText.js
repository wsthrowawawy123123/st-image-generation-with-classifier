export function preprocessForImagePrompt(text) {
    let cleaned = (text || '').trim();
    cleaned = cleaned.replace(/"[^"]*"/g, ' ');
    cleaned = cleaned.replace(/“[^”]*”/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

export function buildFallbackSceneTags(text, options = {}) {
    const maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 280;

    let cleaned = preprocessForImagePrompt(text);
    cleaned = cleaned.replace(/[*_~`>#-]+/g, ' ');
    cleaned = cleaned.replace(/\s*[\r\n]+\s*/g, ', ');
    cleaned = cleaned.replace(/\s*[.?!;:]+\s*/g, ', ');
    cleaned = cleaned.replace(/\s*,\s*/g, ', ');
    cleaned = cleaned.replace(/(?:,\s*){2,}/g, ', ');
    cleaned = cleaned.replace(/^,\s*|,\s*$/g, '').trim();

    if (cleaned.length > maxLength) {
        cleaned = cleaned.slice(0, maxLength).replace(/,\s*[^,]*$/, '').trim();
    }

    return cleaned.replace(/^,\s*|,\s*$/g, '').trim();
}
