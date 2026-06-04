import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonMemoryBlock, parseCanonSnapshotOutput } from '../src/canonSnapshot.js';
import {
    applyUserReplyMemoryToCurrentState,
    detectUserCorrection,
    parseUserReplyMemoryOutput,
} from '../src/userReplyMemory.js';
import { DEFAULT_CURRENT_STATE } from '../src/memory.js';

test('parseCanonSnapshotOutput parses canon fields and lists', () => {
    assert.deepEqual(
        parseCanonSnapshotOutput(`Character name: alice
User persona: roommate
Scenario: modern apartment roleplay
Relationship: roommates
Baseline demeanor: confident
Baseline personality: playful, direct
Speaking style: casual teasing
Default outfit: black dress
Default appearance: long hair
Default location: apartment
World facts: alice lives with user, scene begins in apartment
Canon facts: alice is confident, alice usually wears black dress`),
        {
            character_name: 'alice',
            user_persona: 'roommate',
            scenario: 'modern apartment roleplay',
            relationship: 'roommates',
            baseline_demeanor: 'confident',
            baseline_personality: ['playful', 'direct'],
            speaking_style: 'casual teasing',
            default_outfit: 'black dress',
            default_appearance: ['long hair'],
            default_location: 'apartment',
            world_facts: ['alice lives with user', 'scene begins in apartment'],
            canon_facts: ['alice is confident', 'alice usually wears black dress'],
        },
    );
});

test('buildCanonMemoryBlock produces compact canon prompt block', () => {
    const block = buildCanonMemoryBlock({
        character_name: 'alice',
        baseline_demeanor: 'confident',
        baseline_personality: ['playful', 'direct'],
        scenario: 'modern apartment roommates',
        default_outfit: 'black dress',
        relationship: 'roommates',
    }, {
        canonEnabled: true,
        includeCanonInMemoryBlock: true,
        maxCanonChars: 600,
    });

    assert.match(block, /\[canon\]/);
    assert.match(block, /Character: alice/);
    assert.match(block, /Default outfit: black dress/);
});

test('detectUserCorrection catches common correction phrasing', () => {
    assert.equal(detectUserCorrection(`No, we're still in the closet.`), true);
    assert.equal(detectUserCorrection(`I smile at her.`), false);
});

test('parseUserReplyMemoryOutput parses correction fields', () => {
    assert.deepEqual(
        parseUserReplyMemoryOutput(`Correction: yes
State changes: user kneeling, character shy
Location: closet
User state: kneeling
Character state: shy
Temporary guidance: character should be shy
New facts: scene is still in closet, user is still kneeling`),
        {
            correction: 'yes',
            state_changes: ['user kneeling', 'character shy'],
            location: 'closet',
            user_state: ['kneeling'],
            character_state: ['shy'],
            temporary_guidance: ['character should be shy'],
            new_facts: ['scene is still in closet', 'user is still kneeling'],
        },
    );
});

test('applyUserReplyMemoryToCurrentState prioritizes user corrections', () => {
    const currentState = {
        ...DEFAULT_CURRENT_STATE,
        chat_id: 'chat-1',
        current_location: 'bedroom',
        continuity_facts: ['scene is in bedroom'],
    };

    const nextState = applyUserReplyMemoryToCurrentState(currentState, {
        correction: 'yes',
        location: 'closet',
        user_state: ['kneeling'],
        character_state: ['shy'],
        temporary_guidance: ['character should be shy'],
        new_facts: ['scene is still in closet', 'user is still kneeling'],
    }, {
        maxUserAssertions: 20,
        maxTemporaryGuidance: 10,
    });

    assert.equal(nextState.current_location, 'closet');
    assert.equal(nextState.user_assertions.at(-1).priority, 'high');
    assert.match(nextState.corrections.at(-1).old_value, /bedroom/);
    assert.deepEqual(nextState.temporary_guidance, ['character should be shy', 'shy']);
});
