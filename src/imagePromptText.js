export function preprocessForImagePrompt(text) {
    let cleaned = (text || '').trim();
    cleaned = cleaned.replace(/"[^"]*"/g, ' ');
    cleaned = cleaned.replace(/“[^”]*”/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

export function preprocessForClassifierInput(text, options = {}) {
    const maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 6000;
    let cleaned = String(text || '');

    cleaned = cleaned.replace(/\[st-image-generation-with-classifier\][^\n]*/gi, ' ');
    cleaned = cleaned.replace(/\b(?:final SD prompt|invoking \/sd|\/sd completed|\/sd failed)\b[^\n]*/gi, ' ');
    cleaned = cleaned.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
    cleaned = cleaned.replace(/<img\b[^>]*>/gi, ' ');
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (cleaned.length > maxLength) {
        cleaned = cleaned.slice(-maxLength).replace(/^\S+\s+/, '').trim();
    }

    return cleaned;
}

function cleanPromptTag(tag) {
    return String(tag || '')
        .trim()
        .toLowerCase()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ');
}

function isBadPromptTag(tag) {
    const clean = cleanPromptTag(tag);

    if (!clean || clean === 'unknown' || clean === 'none') {
        return true;
    }

    if (/^(do not|don't|make sure|describe|write|return|output|include|exclude|avoid)\b/.test(clean)) {
        return true;
    }

    if (/^(the scene is|scene is|this is|there is|there are)\b/.test(clean)) {
        return true;
    }

    if (/[.!?;:()[\]{}]/.test(clean)) {
        return true;
    }

    return clean.split(/\s+/).length > 6;
}

export function sanitizeFinalImagePrompt(prompt, options = {}) {
    const maxTags = Number(options.maxTags) > 0 ? Number(options.maxTags) : 32;
    const tags = String(prompt || '')
        .split(',')
        .map(cleanPromptTag)
        .filter(tag => !isBadPromptTag(tag));

    const result = [];
    const seen = new Set();

    for (const tag of tags) {
        if (seen.has(tag)) {
            continue;
        }

        if (result.some(existing => existing.includes(tag))) {
            continue;
        }

        for (let index = result.length - 1; index >= 0; index -= 1) {
            if (tag.includes(result[index])) {
                seen.delete(result[index]);
                result.splice(index, 1);
            }
        }

        seen.add(tag);
        result.push(tag);

        if (result.length >= maxTags) {
            break;
        }
    }

    return result.join(', ');
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
