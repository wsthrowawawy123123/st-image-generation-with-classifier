import { buildImageTags } from './taggingPipeline.js';
import { normalizeNormalizedTags, normalizeSafetyTags } from './validator.js';
import { dedupeFacts } from './memory.js';
import { ATTIRE_LABELS, CLOTHING_STATE_LABELS, POSE_LABELS } from './labels.js';

const POSE_SET = new Set(POSE_LABELS.filter(value => value !== 'unknown'));
const CLOTHING_STATE_SET = new Set(CLOTHING_STATE_LABELS.filter(value => value !== 'unknown'));
const ATTIRE_SET = new Set(ATTIRE_LABELS.filter(value => value !== 'unknown'));

function cleanString(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function cleanList(values, limit = Infinity) {
    return dedupeFacts(Array.isArray(values) ? values.map(cleanString) : []).slice(-limit);
}

function removeContradictoryStateValues(values, character) {
    const pose = cleanString(character.pose);
    const attire = cleanString(character.attire);
    const clothingState = cleanString(character.clothing_state);

    return values.filter(value => {
        if (POSE_SET.has(value) && pose && pose !== 'unknown' && value !== pose) {
            return false;
        }

        if (ATTIRE_SET.has(value) && attire && attire !== 'unknown' && value !== attire) {
            return false;
        }

        if (CLOTHING_STATE_SET.has(value) && clothingState && clothingState !== 'unknown' && value !== clothingState) {
            return false;
        }

        if (value === 'clothing normal' && clothingState && clothingState !== 'unknown' && clothingState !== 'normal') {
            return false;
        }

        return true;
    });
}

function cleanCharacterState(character = {}) {
    const cleaned = {
        ...character,
        pose: cleanString(character.pose) || 'unknown',
        attire: cleanString(character.attire) || 'unknown',
        clothing_state: cleanString(character.clothing_state) || 'unknown',
        prompt_details: cleanList(character.prompt_details, 8),
    };

    cleaned.state = removeContradictoryStateValues(cleanList(character.state, 8), cleaned);

    return {
        ...cleaned,
    };
}

export function repairCurrentState(currentState) {
    if (!currentState || typeof currentState !== 'object') {
        return currentState;
    }

    return {
        ...currentState,
        location: cleanString(currentState.location || currentState.current_location) || 'unknown',
        setting: cleanString(currentState.setting || currentState.current_setting) || 'unknown',
        current_location: cleanString(currentState.current_location || currentState.location) || 'unknown',
        current_setting: cleanString(currentState.current_setting || currentState.setting) || 'unknown',
        current_scene: cleanString(currentState.current_scene) || 'unknown',
        characters: {
            user: cleanCharacterState(currentState.characters?.user),
            character: cleanCharacterState(currentState.characters?.character),
        },
        last_action: cleanString(currentState.last_action) || 'unknown',
        recent_events: cleanList(currentState.recent_events, 5),
        continuity_facts: cleanList(currentState.continuity_facts, 30),
        temporary_guidance: cleanList(currentState.temporary_guidance, 10),
        open_threads: cleanList(currentState.open_threads, 10),
        user_assertions: Array.isArray(currentState.user_assertions)
            ? currentState.user_assertions.slice(-20)
            : [],
        corrections: Array.isArray(currentState.corrections)
            ? currentState.corrections.slice(-20)
            : [],
        updated_at: currentState.updated_at || new Date().toISOString(),
    };
}

export function repairSceneRecord(scene) {
    if (!scene || typeof scene !== 'object') {
        return scene;
    }

    const normalized_tags = normalizeNormalizedTags(scene.normalized_tags || {});
    const safety_tags = normalizeSafetyTags(scene.safety_tags || {});
    const continuity_memory = scene.continuity_memory
        ? {
            ...scene.continuity_memory,
            continuity_facts: cleanList(scene.continuity_memory.continuity_facts, 30),
            open_threads: cleanList(scene.continuity_memory.open_threads, 10),
        }
        : scene.continuity_memory;

    return {
        ...scene,
        normalized_tags,
        safety_tags,
        image_tags: buildImageTags({ normalized_tags }, scene.raw_extraction),
        continuity_memory,
        updated_at: scene.updated_at || new Date().toISOString(),
    };
}

export function repairMemoryEvent(memoryEvent) {
    if (!memoryEvent || typeof memoryEvent !== 'object') {
        return memoryEvent;
    }

    return {
        ...memoryEvent,
        scene_summary: cleanString(memoryEvent.scene_summary) || 'unknown',
        current_location: cleanString(memoryEvent.current_location) || 'unknown',
        continuity_facts: cleanList(memoryEvent.continuity_facts, 30),
        open_threads: cleanList(memoryEvent.open_threads, 10),
        updated_at: memoryEvent.updated_at || new Date().toISOString(),
    };
}
