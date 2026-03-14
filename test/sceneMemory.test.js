import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildSceneMemoryAnchorTags,
    createEmptySceneMemory,
    mergeScenePatch,
} from '../src/sceneMemory.js';

test('mergeScenePatch preserves prior details when location changes without replacements', () => {
    const sceneMemory = createEmptySceneMemory();

    sceneMemory.location = 'car';
    sceneMemory.environment = 'luxury sedan interior';
    sceneMemory.assistantClothing = 'white blouse, blue jeans';
    sceneMemory.lighting = 'soft dashboard glow';
    sceneMemory.props = ['seatbelt'];

    mergeScenePatch(sceneMemory, {
        location: 'modern house entryway',
        environment: '',
        assistantPose: '',
        assistantClothing: '',
        assistantExpression: '',
        interaction: '',
        props: [],
        lighting: '',
        mood: '',
    });

    assert.equal(sceneMemory.location, 'modern house entryway');
    assert.equal(sceneMemory.environment, 'luxury sedan interior');
    assert.equal(sceneMemory.assistantClothing, 'white blouse, blue jeans');
    assert.equal(sceneMemory.lighting, 'soft dashboard glow');
    assert.deepEqual(sceneMemory.props, ['seatbelt']);
});

test('mergeScenePatch applies non-empty replacements on top of existing memory', () => {
    const sceneMemory = createEmptySceneMemory();

    sceneMemory.location = 'living room';
    sceneMemory.assistantClothing = 'white blouse, blue jeans';
    sceneMemory.assistantExpression = 'small smile';

    mergeScenePatch(sceneMemory, {
        location: 'living room',
        assistantClothing: 'open white blouse, blue jeans',
        assistantExpression: 'playful smile',
        props: ['ice cream', 'spoon'],
    });

    assert.equal(sceneMemory.location, 'living room');
    assert.equal(sceneMemory.assistantClothing, 'open white blouse, blue jeans');
    assert.equal(sceneMemory.assistantExpression, 'playful smile');
    assert.deepEqual(sceneMemory.props, ['ice cream', 'spoon']);
});

test('buildSceneMemoryAnchorTags emits stable visual anchors in priority order', () => {
    const sceneMemory = {
        ...createEmptySceneMemory(),
        assistantClothing: 'white blouse, blue jeans',
        assistantPose: 'sitting on barstool',
        assistantExpression: 'soft smile',
        interaction: 'holding hands',
        environment: 'modern kitchen island',
        location: 'city apartment',
        lighting: 'warm ambient lighting',
        props: ['ice cream', 'water glass'],
    };

    assert.equal(
        buildSceneMemoryAnchorTags(sceneMemory),
        'white blouse, blue jeans, sitting on barstool, soft smile, holding hands, modern kitchen island, city apartment, warm ambient lighting, ice cream, water glass',
    );
});

test('createEmptySceneMemory returns the expected blank shape', () => {
    assert.deepEqual(createEmptySceneMemory(), {
        location: '',
        environment: '',
        assistantPose: '',
        assistantClothing: '',
        assistantExpression: '',
        interaction: '',
        props: [],
        lighting: '',
        mood: '',
    });
});

test('mergeScenePatch ignores null patches and empty updates', () => {
    const sceneMemory = {
        ...createEmptySceneMemory(),
        location: 'city apartment',
        assistantClothing: 'white blouse, blue jeans',
        props: ['water glass'],
        lighting: 'warm ambient lighting',
    };

    mergeScenePatch(sceneMemory, null);
    mergeScenePatch(sceneMemory, {
        location: '',
        assistantClothing: '   ',
        props: [],
        lighting: '',
    });

    assert.deepEqual(sceneMemory, {
        ...createEmptySceneMemory(),
        location: 'city apartment',
        assistantClothing: 'white blouse, blue jeans',
        props: ['water glass'],
        lighting: 'warm ambient lighting',
    });
});

test('buildSceneMemoryAnchorTags omits empty fields and trims comma spacing', () => {
    const sceneMemory = {
        ...createEmptySceneMemory(),
        assistantClothing: 'white blouse, blue jeans',
        environment: '',
        location: 'city apartment',
        props: [],
        lighting: 'warm ambient lighting',
    };

    assert.equal(
        buildSceneMemoryAnchorTags(sceneMemory),
        'white blouse, blue jeans, city apartment, warm ambient lighting',
    );
});
