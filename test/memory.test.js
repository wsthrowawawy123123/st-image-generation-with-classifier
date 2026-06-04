import test from 'node:test';
import assert from 'node:assert/strict';

import { parseContinuityMemoryOutput } from '../src/parser.js';
import {
    applyContinuityMemoryToCurrentState,
    buildContinuityMemoryBlock,
    dedupeFacts,
    DEFAULT_CURRENT_STATE,
} from '../src/memory.js';

test('parseContinuityMemoryOutput parses continuity fields and lists', () => {
    assert.deepEqual(
        parseContinuityMemoryOutput(`Scene summary: intimate scene in closet
Location: closet
Setting: home
User state: kneeling, partial clothing
Character state: standing, shirt, removed
Last action: kissing
Continuity facts: scene is in closet, user is kneeling
Open threads: scene continues`),
        {
            scene_summary: 'intimate scene in closet',
            location: 'closet',
            setting: 'home',
            user_state: ['kneeling', 'partial clothing'],
            character_state: ['standing', 'shirt', 'removed'],
            last_action: 'kissing',
            continuity_facts: ['scene is in closet', 'user is kneeling'],
            open_threads: ['scene continues'],
        },
    );
});

test('applyContinuityMemoryToCurrentState updates current state without overwriting with unknown', () => {
    const currentState = {
        ...DEFAULT_CURRENT_STATE,
        chat_id: 'chat-1',
        current_location: 'closet',
        current_setting: 'home',
        characters: {
            user: { pose: 'standing', attire: 'clothed', clothing_state: 'normal', state: [] },
            character: { pose: 'unknown', attire: 'unknown', clothing_state: 'unknown', state: [] },
        },
        last_action: 'conversation',
    };

    const nextState = applyContinuityMemoryToCurrentState(
        currentState,
        {
            scene_summary: 'intimate scene in bedroom',
            location: 'bedroom',
            setting: 'home',
            user_state: ['kneeling', 'partial clothing', 'aroused'],
            character_state: ['standing', 'shirt', 'removed'],
            last_action: 'kissing',
            continuity_facts: ['scene is in bedroom', 'user is kneeling'],
            open_threads: ['scene continues'],
        },
        'scene-1',
        {
            action: 'kissing',
            clothing_state: 'partial',
        },
    );

    assert.equal(nextState.current_location, 'bedroom');
    assert.equal(nextState.characters.user.pose, 'kneeling');
    assert.equal(nextState.characters.user.attire, 'partial clothing');
    assert.equal(nextState.last_action, 'kissing');
    assert.equal(nextState.last_source_scene_id, 'scene-1');
    assert.deepEqual(nextState.open_threads, ['scene continues']);
});

test('dedupeFacts normalizes case and spacing', () => {
    assert.deepEqual(
        dedupeFacts([' Scene is in Closet ', 'scene   is in closet', 'unknown', 'User is kneeling']),
        ['scene is in closet', 'user is kneeling'],
    );
});

test('buildContinuityMemoryBlock creates a compact continuity block', () => {
    const block = buildContinuityMemoryBlock({
        chat_id: 'chat-1',
        current_location: 'closet',
        current_setting: 'home',
        current_scene: 'intimate scene in closet',
        characters: {
            user: { pose: 'kneeling', attire: 'partial clothing', clothing_state: 'disheveled', state: ['aroused'] },
            character: { pose: 'standing', attire: 'shirt', clothing_state: 'removed', state: [] },
        },
        last_action: 'kissing',
        recent_events: ['user knelt', 'characters kissed'],
        continuity_facts: ['scene is in closet', 'user is kneeling'],
        open_threads: ['scene continues'],
    }, {
        memoryEnabled: true,
        memoryMode: 'strong',
        maxMemoryChars: 1200,
        includeRecentEvents: true,
        includeOpenThreads: true,
    });

    assert.match(block, /\[continuity state\]/);
    assert.match(block, /Location: closet/);
    assert.match(block, /User: kneeling, partial clothing, clothing disheveled, aroused/);
    assert.match(block, /Open threads:/);
});
