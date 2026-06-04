import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildImageTags,
    imageTagsToSceneTags,
    injectConsistencyAnchorTags,
    parseRawExtractionFields,
    normalizeSafetyTags,
    normalizeNormalizedTags,
    validateNormalizedTags,
    validateSafetyTags,
    safeParseJsonObject,
} from '../src/analysisPipeline.js';

test('safeParseJsonObject parses plain JSON objects', () => {
    assert.deepEqual(
        safeParseJsonObject('{"generate":true,"category":"ambient_scene","weight":0.7}'),
        { generate: true, category: 'ambient_scene', weight: 0.7 },
    );
});

test('safeParseJsonObject extracts JSON from fenced or noisy responses', () => {
    assert.deepEqual(
        safeParseJsonObject('```json\n{"location":"home","props":["ice cream"]}\n```'),
        { location: 'home', props: ['ice cream'] },
    );

    assert.deepEqual(
        safeParseJsonObject('Note\n{"location":"home","props":["ice cream"]}\nextra'),
        { location: 'home', props: ['ice cream'] },
    );
});

test('parseRawExtractionFields parses comma-separated array and string fields', () => {
    assert.deepEqual(
        parseRawExtractionFields(`Actions: sitting, reading
Poses: sitting
Objects: book, coffee
Characters: she
Mood: calm
Location: kitchen table
Attire: unknown
Setting: kitchen`, {
            actions: 'array',
            poses: 'array',
            objects: 'array',
            characters: 'array',
            mood: 'array',
            location: 'string',
            attire: 'array',
            setting: 'string',
        }),
        {
            actions: ['sitting', 'reading'],
            poses: ['sitting'],
            objects: ['book', 'coffee'],
            characters: ['she'],
            mood: ['calm'],
            location: 'kitchen table',
            attire: ['unknown'],
            setting: 'kitchen',
        },
    );
});

test('validateNormalizedTags accepts a spec-compliant normalized record', () => {
    assert.equal(
        validateNormalizedTags({
            content: 'explicit',
            'action group': 'sensual',
            action: 'kissing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            location: 'closet',
            attire: 'partial clothing',
            setting: 'closet',
        }),
        true,
    );
});

test('validateNormalizedTags accepts values after unsupported labels are coerced to unknown', () => {
    assert.equal(
        validateNormalizedTags({
            content: 'explicit',
            'action group': 'sensual',
            action: 'embracing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            location: 'closet',
            attire: 'partial clothing',
            setting: 'closet',
        }),
        true,
    );
});

test('normalizeNormalizedTags coerces invalid labels to unknown', () => {
    assert.deepEqual(
        normalizeNormalizedTags({
            content: 'explicit',
            'action group': 'not-real',
            action: 'kissing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            location: 'closet',
            attire: 'partial clothing',
            setting: 'closet',
        }),
        {
            content: 'explicit',
            action_group: 'unknown',
            action: 'kissing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            state: 'none',
            appearance_detail: 'none',
            fluid: 'none',
            fluid_location: 'none',
            location: 'closet',
            attire: 'partial clothing',
            clothing_state: 'normal',
            setting: 'closet',
        },
    );
});

test('buildImageTags builds spec-style image tags from normalized labels', () => {
    assert.equal(
        buildImageTags({
            content: 'explicit',
            'action group': 'sensual',
            action: 'kissing',
            pose: 'kneeling',
            exposure: 'chest',
            contact: 'mouth',
            location: 'closet',
            attire: 'partial clothing',
            setting: 'closet',
        }).join(', '),
        'kissing, kneeling, mouth contact, chest exposure, partial clothing, closet',
    );
});

test('imageTagsToSceneTags builds a compact tag string from image tags', () => {
    assert.equal(
        imageTagsToSceneTags([
            'kissing',
            'kneeling',
            'mouth contact',
            'chest exposure',
            'partial clothing',
            'closet',
        ]),
        'kissing, kneeling, mouth contact, chest exposure, partial clothing, closet',
    );
});

test('normalizeSafetyTags preserves valid safety labels', () => {
    assert.deepEqual(
        normalizeSafetyTags({
            age: 'adult',
            consent: 'consensual',
            risk: 'none',
            reason: 'adult consensual scene',
        }),
        {
            age: 'adult',
            consent: 'consensual',
            risk: 'none',
            reason: 'adult consensual scene',
        },
    );
});

test('validateSafetyTags accepts values after unsupported labels are coerced to unknown', () => {
    assert.equal(
        validateSafetyTags({
            age: 'adult',
            consent: 'questionable',
            risk: 'none',
            reason: 'unknown',
        }),
        true,
    );
});

test('injectConsistencyAnchorTags prepends stable clothing and pose when missing', () => {
    assert.equal(
        injectConsistencyAnchorTags(
            'soft smile, warm lighting, office desk',
            {
                characters: {
                    character: {
                        attire: 'white blouse',
                        clothing_state: 'open',
                        pose: 'sitting pose',
                        state: ['soft smile'],
                    },
                },
                current_location: 'office desk',
                current_setting: 'office',
            },
        ),
        'white blouse, open clothing, sitting pose, soft smile, warm lighting, office desk',
    );
});

test('injectConsistencyAnchorTags does not duplicate clothing or pose already present', () => {
    assert.equal(
        injectConsistencyAnchorTags(
            'white blouse, open clothing, sitting pose, soft smile',
            {
                characters: {
                    character: {
                        attire: 'white blouse',
                        clothing_state: 'open',
                        pose: 'sitting pose',
                    },
                },
            },
        ),
        'white blouse, open clothing, sitting pose, soft smile',
    );
});
