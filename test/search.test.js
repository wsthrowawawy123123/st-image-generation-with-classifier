import test from 'node:test';
import assert from 'node:assert/strict';

import { filterBySafety, filterScenes, rawSearch, scoreMemory } from '../src/search.js';

const sampleScenes = [
    {
        scene_id: 'scene-1',
        source_text: 'They kissed in the closet.',
        normalized_tags: {
            content: 'explicit',
            action_group: 'sensual',
            action: 'kissing',
            pose: 'kneeling',
            location: 'closet',
        },
        safety_tags: {
            age: 'adult',
            consent: 'consensual',
            risk: 'none',
        },
        raw_extraction: {
            actions: ['kissing'],
            poses: ['kneeling'],
            body_contact: ['mouth'],
            location: 'closet',
            attire: ['shirt'],
            setting: 'home',
        },
        image_tags: ['kissing', 'kneeling', 'closet'],
    },
    {
        scene_id: 'scene-2',
        source_text: 'They talked over coffee in the kitchen.',
        normalized_tags: {
            content: 'sfw',
            action_group: 'sfw',
            action: 'conversation',
            pose: 'sitting',
            location: 'kitchen',
        },
        safety_tags: {
            age: 'adult',
            consent: 'unknown',
            risk: 'none',
        },
        raw_extraction: {
            actions: ['conversation'],
            poses: ['sitting'],
            location: 'kitchen table',
            attire: ['unknown'],
            setting: 'kitchen',
        },
        image_tags: ['conversation', 'sitting', 'kitchen'],
    },
];

test('filterScenes filters by normalized tags', () => {
    assert.deepEqual(
        filterScenes(sampleScenes, { content: 'explicit', action_group: 'sensual' }).map(scene => scene.scene_id),
        ['scene-1'],
    );
});

test('filterBySafety filters by safety tags', () => {
    assert.deepEqual(
        filterBySafety(sampleScenes, { consent: 'consensual' }).map(scene => scene.scene_id),
        ['scene-1'],
    );
});

test('rawSearch matches source text and image tags', () => {
    assert.deepEqual(
        rawSearch(sampleScenes, 'closet').map(scene => scene.scene_id),
        ['scene-1'],
    );

    assert.deepEqual(
        rawSearch(sampleScenes, 'coffee').map(scene => scene.scene_id),
        ['scene-2'],
    );
});

test('scoreMemory rewards keyword and location matches', () => {
    assert.equal(
        scoreMemory(
            {
                continuity_facts: ['scene is in closet', 'characters kissed'],
                current_location: 'closet',
                importance: 'high',
            },
            'I look around the closet before kissing again',
        ) > 0,
        true,
    );
});
