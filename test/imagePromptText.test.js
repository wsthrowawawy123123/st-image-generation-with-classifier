import test from 'node:test';
import assert from 'node:assert/strict';

import {
    preprocessForImagePrompt,
    buildFallbackSceneTags,
    preprocessForClassifierInput,
    sanitizeFinalImagePrompt,
} from '../src/imagePromptText.js';

test('preprocessForImagePrompt removes straight-quoted dialogue and collapses whitespace', () => {
    assert.equal(
        preprocessForImagePrompt('  She smiles. "Hello there."  warm lighting  '),
        'She smiles. warm lighting',
    );
});

test('preprocessForImagePrompt removes curly-quoted dialogue', () => {
    assert.equal(
        preprocessForImagePrompt('She smiles. “Hello there.” warm lighting'),
        'She smiles. warm lighting',
    );
});

test('buildFallbackSceneTags converts reply prose into a compact prompt-like string', () => {
    assert.equal(
        buildFallbackSceneTags('She leans against the doorway. "Come here." Warm sunset light spills across the room.'),
        'She leans against the doorway, Warm sunset light spills across the room',
    );
});

test('preprocessForClassifierInput removes image and extension artifacts', () => {
    assert.equal(
        preprocessForClassifierInput('Assistant: hello ![image](foo.png) final SD prompt: bad\n```noise```'),
        'Assistant: hello',
    );
});

test('preprocessForClassifierInput removes leaked memory scaffolding', () => {
    assert.equal(
        preprocessForClassifierInput(`Assistant: hello
[canon]
Character: angi
[/canon]
[continuity state]
Location: office
[/continuity state]`),
        'Assistant: hello',
    );
});

test('sanitizeFinalImagePrompt caps tags and removes instructions or sentence-like tags', () => {
    assert.equal(
        sanitizeFinalImagePrompt(
            'kneeling, kneeling, do not censor, scene is in bedroom, tight white blouse, white blouse, mouth contact, this tag has way too many words inside it',
            { maxTags: 4 },
        ),
        'kneeling, tight white blouse, mouth contact',
    );
});

test('sanitizeFinalImagePrompt preserves protected tokens and existing weights', () => {
    assert.equal(
        sanitizeFinalImagePrompt('<lora:FooBar:0.8>, (masterpiece:1.2), embedding:easynegative, kneeling'),
        '<lora:FooBar:0.8>, (masterpiece:1.2), embedding:easynegative, kneeling',
    );
});

test('sanitizeFinalImagePrompt adds randomized weight to explicit action tags', () => {
    assert.equal(
        sanitizeFinalImagePrompt('blowjob, riding, anal sex, kneeling', { rng: () => 0.99 }),
        '(blowjob:1.3), (riding:1.3), (anal sex:1.3), kneeling',
    );
});

test('sanitizeFinalImagePrompt can leave explicit action tags unweighted', () => {
    assert.equal(
        sanitizeFinalImagePrompt('blowjob, kneeling', { weightExplicitActions: false }),
        'blowjob, kneeling',
    );
});
