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
    cleaned = cleaned.replace(/\[canon\][\s\S]*?\[\/canon\]/gi, ' ');
    cleaned = cleaned.replace(/\[continuity\s+(?:state|override)\][\s\S]*?\[\/continuity\s+(?:state|override)\]/gi, ' ');
    cleaned = cleaned.replace(/\bcontinuity\s+state\s*:[\s\S]*$/i, ' ');
    cleaned = cleaned.replace(/\b(?:system|instruction|memory|current scene|relevant facts)\s*:[^\n]*/gi, ' ');
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

const EXPLICIT_ACTION_TAGS = new Set([
    'anal',
    'anal sex',
    'anal penetration',
    'blowjob',
    'cunnilingus',
    'fellatio',
    'fingering',
    'grinding',
    'handjob',
    'intercourse',
    'masturbation',
    'mutual masturbation',
    'oral sex',
    'riding',
    'vaginal sex',
]);

function cleanPromptTag(tag) {
    return String(tag || '')
        .trim()
        .toLowerCase()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ');
}

function isProtectedPromptToken(tag) {
    const clean = String(tag || '').trim();

    return Boolean(
        /^<[^<>]+>$/.test(clean) ||
        /^\([^()]+:[0-9]+(?:\.[0-9]+)?\)$/.test(clean) ||
        /^\[[^\[\]]+:[0-9]+(?:\.[0-9]+)?\]$/.test(clean) ||
        /^(?:embedding|lora|lyco|hypernet):[^\s,]+/i.test(clean)
    );
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

function choosePromptWeight(rng = Math.random) {
    const value = typeof rng === 'function' ? Number(rng()) : Math.random();
    const bucket = Math.max(0, Math.min(2, Math.floor((Number.isFinite(value) ? value : Math.random()) * 3)));
    return (1.1 + (bucket * 0.1)).toFixed(1);
}

function maybeWeightExplicitActionTag(tag, options = {}) {
    if (options.weightExplicitActions === false || isProtectedPromptToken(tag)) {
        return tag;
    }

    const clean = cleanPromptTag(tag);
    if (!EXPLICIT_ACTION_TAGS.has(clean)) {
        return tag;
    }

    return `(${clean}:${choosePromptWeight(options.rng)})`;
}

export function sanitizeFinalImagePrompt(prompt, options = {}) {
    const maxTags = Number(options.maxTags) > 0 ? Number(options.maxTags) : 32;
    const tags = String(prompt || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

    const result = [];
    const seen = new Set();

    for (const tag of tags) {
        const clean = isProtectedPromptToken(tag) ? tag : cleanPromptTag(tag);

        if (!isProtectedPromptToken(clean) && isBadPromptTag(clean)) {
            continue;
        }

        const seenKey = cleanPromptTag(clean);
        if (seen.has(seenKey)) {
            continue;
        }

        if (!isProtectedPromptToken(clean) && result.some(existing => cleanPromptTag(existing).includes(seenKey))) {
            continue;
        }

        if (!isProtectedPromptToken(clean)) {
            for (let index = result.length - 1; index >= 0; index -= 1) {
                const existing = cleanPromptTag(result[index]);
                if (!isProtectedPromptToken(result[index]) && seenKey.includes(existing)) {
                    seen.delete(existing);
                    result.splice(index, 1);
                }
            }
        }

        const weighted = maybeWeightExplicitActionTag(clean, options);
        seen.add(seenKey);
        result.push(weighted);

        if (result.length >= maxTags) {
            break;
        }
    }

    return result.join(', ');
}

export function sanitizeGeneratedImageTags(tags, options = {}) {
    const maxTags = Number(options.maxTags) > 0 ? Number(options.maxTags) : 32;
    const result = [];
    const seen = new Set();

    for (const rawTag of tags || []) {
        const tag = cleanPromptTag(rawTag);
        if (isBadPromptTag(tag)) {
            continue;
        }

        if (seen.has(tag)) {
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

    return result;
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
