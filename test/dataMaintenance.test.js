import test from 'node:test';
import assert from 'node:assert/strict';

import {
    repairCurrentState,
    repairMemoryEvent,
    repairSceneRecord,
} from '../src/dataMaintenance.js';

test('repairCurrentState normalizes lists and preserves compact character details', () => {
    const repaired = repairCurrentState({
        chat_id: 'chat-1',
        current_location: ' Closet ',
        current_setting: ' Home ',
        characters: {
            character: {
                pose: ' Standing ',
                attire: ' Black Dress ',
                clothing_state: ' Disheveled ',
                state: [' shy ', 'Shy'],
                prompt_details: [' Tight White Blouse ', 'tight white blouse'],
            },
        },
        continuity_facts: [' Scene is in closet ', 'scene is in closet'],
        recent_events: [' Kissed ', 'kissed'],
    });

    assert.equal(repaired.current_location, 'closet');
    assert.equal(repaired.current_setting, 'home');
    assert.equal(repaired.characters.character.pose, 'standing');
    assert.deepEqual(repaired.characters.character.state, ['shy']);
    assert.deepEqual(repaired.characters.character.prompt_details, ['tight white blouse']);
    assert.deepEqual(repaired.continuity_facts, ['scene is in closet']);
});

test('repairCurrentState removes stale contradictory pose and clothing state values', () => {
    const repaired = repairCurrentState({
        chat_id: 'chat-1',
        location: ' Office ',
        setting: ' Office ',
        characters: {
            character: {
                pose: ' Standing ',
                attire: ' Shirt ',
                clothing_state: ' Open ',
                state: ['lying', 'standing', 'clothing normal', 'open', 'focused'],
            },
        },
    });

    assert.equal(repaired.location, 'office');
    assert.equal(repaired.current_location, 'office');
    assert.deepEqual(repaired.characters.character.state, ['standing', 'open', 'focused']);
});

test('repairSceneRecord normalizes tags and rebuilds image tags', () => {
    const repaired = repairSceneRecord({
        scene_id: 'scene-1',
        normalized_tags: {
            content: 'explicit',
            'action group': 'sensual',
            action: 'kissing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            location: 'closet',
            attire: 'partial clothing',
            setting: 'closet',
        },
        safety_tags: {
            age: 'adult',
            consent: 'consensual',
            risk: 'none',
            reason: 'adult scene',
        },
        image_tags: ['old'],
        continuity_memory: {
            continuity_facts: [' assistant wearing blouse ', 'assistant wearing blouse'],
            open_threads: [' scene continues ', 'scene continues'],
        },
    });

    assert.deepEqual(
        repaired.image_tags,
        ['kissing', 'kneeling', 'mouth contact', 'chest exposure', 'partial clothing', 'closet'],
    );
    assert.deepEqual(repaired.continuity_memory.continuity_facts, ['assistant wearing blouse']);
    assert.deepEqual(repaired.continuity_memory.open_threads, ['scene continues']);
});

test('repairMemoryEvent cleans compact memory fields', () => {
    const repaired = repairMemoryEvent({
        memory_id: 'memory-1',
        scene_summary: ' Kissing in Closet ',
        current_location: ' Closet ',
        continuity_facts: [' User is kneeling ', 'user is kneeling'],
        open_threads: [' Scene continues ', 'scene continues'],
    });

    assert.equal(repaired.scene_summary, 'kissing in closet');
    assert.equal(repaired.current_location, 'closet');
    assert.deepEqual(repaired.continuity_facts, ['user is kneeling']);
    assert.deepEqual(repaired.open_threads, ['scene continues']);
});
