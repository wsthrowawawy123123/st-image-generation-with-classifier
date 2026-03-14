export function createEmptySceneMemory() {
    return {
        location: '',
        environment: '',
        assistantPose: '',
        assistantClothing: '',
        assistantExpression: '',
        interaction: '',
        props: [],
        lighting: '',
        mood: '',
    };
}

export function mergeScenePatch(sceneMemory, patch) {
    if (!sceneMemory || !patch) {
        return sceneMemory;
    }

    const previousLocation = sceneMemory.location;

    if (patch.location && patch.location !== previousLocation) {
        sceneMemory.location = patch.location;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (key === 'location') {
            continue;
        }

        if (Array.isArray(value)) {
            if (value.length > 0) {
                sceneMemory[key] = value;
            }
            continue;
        }

        if (typeof value === 'string' && value.trim()) {
            sceneMemory[key] = value.trim();
        }
    }

    return sceneMemory;
}

export function buildSceneMemoryAnchorTags(sceneMemory) {
    if (!sceneMemory) {
        return '';
    }

    const anchorParts = [];

    if (sceneMemory.assistantClothing) {
        anchorParts.push(sceneMemory.assistantClothing);
    }

    if (sceneMemory.assistantPose) {
        anchorParts.push(sceneMemory.assistantPose);
    }

    if (sceneMemory.assistantExpression) {
        anchorParts.push(sceneMemory.assistantExpression);
    }

    if (sceneMemory.interaction) {
        anchorParts.push(sceneMemory.interaction);
    }

    if (sceneMemory.environment) {
        anchorParts.push(sceneMemory.environment);
    }

    if (sceneMemory.location) {
        anchorParts.push(sceneMemory.location);
    }

    if (sceneMemory.lighting) {
        anchorParts.push(sceneMemory.lighting);
    }

    if (Array.isArray(sceneMemory.props) && sceneMemory.props.length > 0) {
        anchorParts.push(...sceneMemory.props);
    }

    return anchorParts
        .join(', ')
        .replace(/\s+,/g, ',')
        .trim();
}
