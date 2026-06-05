const TERMINAL_PUNCTUATION_REGEX = /[.!?…)"'\]]$/;
const TRAILING_CONNECTOR_REGEX = /\b(and|or|with|while|then|as|to|of|in|on|at|for|from|into|onto|by|but|because|that|which|who|wearing|holding|touching|running|moving|stepping)$/i;
const LEAKED_BLOCK_MARKER_REGEX = /(?:^|\n)\s*(?:continuity\s+state\s*:|\[canon\]|\[continuity\s+(?:state|override)\]|use these facts as (?:the )?(?:current scene state|current canon))/i;
const CLOSED_LEAKED_BLOCK_REGEXES = [
    /\s*\[canon\][\s\S]*?\[\/canon\]\s*/gi,
    /\s*\[continuity\s+state\][\s\S]*?\[\/continuity\s+state\]\s*/gi,
    /\s*\[continuity\s+override\][\s\S]*?\[\/continuity\s+override\]\s*/gi,
];

function normalizeForRepeat(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ');
}

function splitSentencesWithDelimiters(text) {
    const matches = String(text || '').match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g);
    return matches || [];
}

function removeAdjacentDuplicateSentences(text) {
    const sentences = splitSentencesWithDelimiters(text);
    if (sentences.length <= 1) {
        return text;
    }

    const result = [];
    let previous = '';

    for (const sentence of sentences) {
        const normalized = normalizeForRepeat(sentence).replace(/[.!?…]+["')\]]*$/, '');
        if (normalized && normalized === previous) {
            continue;
        }

        result.push(sentence);
        previous = normalized;
    }

    return result.join('').replace(/\s{2,}/g, ' ').trim();
}

function removeAdjacentDuplicateLines(text) {
    const lines = String(text || '').split(/\n+/);
    const result = [];
    let previous = '';

    for (const line of lines) {
        const normalized = normalizeForRepeat(line);
        if (normalized && normalized === previous) {
            continue;
        }

        result.push(line);
        previous = normalized;
    }

    return result.join('\n').trim();
}

function trimDanglingFragment(text) {
    const clean = String(text || '').trim();
    if (!clean || TERMINAL_PUNCTUATION_REGEX.test(clean)) {
        return clean;
    }

    const lastTerminal = Math.max(
        clean.lastIndexOf('.'),
        clean.lastIndexOf('!'),
        clean.lastIndexOf('?'),
        clean.lastIndexOf('…'),
    );

    if (lastTerminal === -1) {
        return clean;
    }

    const fragment = clean.slice(lastTerminal + 1).trim();
    const fragmentWords = fragment.split(/\s+/).filter(Boolean);

    if (!fragment || fragmentWords.length > 14) {
        return clean;
    }

    if (
        TRAILING_CONNECTOR_REGEX.test(fragment) ||
        /^[,;:]/.test(fragment) ||
        /["'([{]$/.test(fragment)
    ) {
        return clean.slice(0, lastTerminal + 1).trim();
    }

    return clean;
}

function removeLeakedPromptBlocks(text) {
    let next = String(text || '');

    for (const regex of CLOSED_LEAKED_BLOCK_REGEXES) {
        next = next.replace(regex, '\n');
    }

    const leakedMarker = next.search(LEAKED_BLOCK_MARKER_REGEX);
    if (leakedMarker !== -1) {
        next = next.slice(0, leakedMarker);
    }

    return next
        .replace(/[ \t]*\n+[ \t]*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function sanitizeCharacterOutput(text) {
    if (typeof text !== 'string' || !text.trim()) {
        return {
            text: typeof text === 'string' ? text : '',
            changed: false,
            reasons: [],
        };
    }

    const reasons = [];
    let next = text.trim();

    const leakedPromptCleaned = removeLeakedPromptBlocks(next);
    if (leakedPromptCleaned !== next) {
        reasons.push('prompt_scaffold_leak');
        next = leakedPromptCleaned;
    }

    const repeatedWordsCleaned = next.replace(/\b([A-Za-z][\w'-]*)(\s+\1\b){1,}/gi, '$1');
    if (repeatedWordsCleaned !== next) {
        reasons.push('duplicate_words');
        next = repeatedWordsCleaned;
    }

    const duplicateLinesCleaned = removeAdjacentDuplicateLines(next);
    if (duplicateLinesCleaned !== next) {
        reasons.push('duplicate_lines');
        next = duplicateLinesCleaned;
    }

    const duplicateSentencesCleaned = removeAdjacentDuplicateSentences(next);
    if (duplicateSentencesCleaned !== next) {
        reasons.push('duplicate_sentences');
        next = duplicateSentencesCleaned;
    }

    const danglingTrimmed = trimDanglingFragment(next);
    if (danglingTrimmed !== next) {
        reasons.push('dangling_fragment');
        next = danglingTrimmed;
    }

    return {
        text: next,
        changed: next !== text.trim(),
        reasons,
    };
}
