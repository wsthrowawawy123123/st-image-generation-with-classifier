export function filterScenes(scenes, filters) {
    return (scenes || []).filter(scene => {
        for (const [key, value] of Object.entries(filters || {})) {
            if (!value) {
                continue;
            }

            if ((scene.normalized_tags || {})[key] !== value) {
                return false;
            }
        }

        return true;
    });
}

export function filterBySafety(scenes, filters) {
    return (scenes || []).filter(scene => {
        for (const [key, value] of Object.entries(filters || {})) {
            if (!value) {
                continue;
            }

            if ((scene.safety_tags || {})[key] !== value) {
                return false;
            }
        }

        return true;
    });
}

export function rawSearch(scenes, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
        return scenes || [];
    }

    return (scenes || []).filter(scene => {
        const raw = scene.raw_extraction || {};
        const searchable = [
            scene.source_text,
            ...(raw.actions || []),
            ...(raw.poses || []),
            ...(raw.body_contact || []),
            ...(raw.exposure || []),
            raw.location,
            ...(raw.attire || []),
            raw.setting,
            ...(scene.image_tags || []),
            ...(scene.continuity_memory?.continuity_facts || []),
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return searchable.includes(q);
    });
}

export function scoreMemory(memory, latestText) {
    const q = String(latestText || '').toLowerCase();
    let score = 0;

    for (const fact of memory?.continuity_facts || []) {
        for (const word of q.split(/\s+/)) {
            if (word.length > 3 && fact.includes(word)) {
                score += 1;
            }
        }
    }

    if (memory?.current_location && q.includes(memory.current_location)) {
        score += 3;
    }

    if (memory?.importance === 'high') {
        score += 2;
    }

    if (memory?.importance === 'medium') {
        score += 1;
    }

    return score;
}
