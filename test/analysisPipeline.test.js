import test from 'node:test';
import assert from 'node:assert/strict';

import {
    cleanSanitizedTagOutput,
    injectConsistencyAnchorTags,
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

test('cleanSanitizedTagOutput keeps only the first tag line and strips notes', () => {
    assert.equal(
        cleanSanitizedTagOutput('holding hands, city lights\n\nNote: removed extras'),
        'holding hands, city lights',
    );

    assert.equal(
        cleanSanitizedTagOutput('"holding hands, city lights\nsecond line"'),
        'holding hands, city lights',
    );
});

test('cleanSanitizedTagOutput strips outer emphasis and parenthesis wrappers from tag lists', () => {
    assert.equal(
        cleanSanitizedTagOutput('*moaning around cock, watery eyes, pulled back, licking lips*'),
        'moaning around cock, watery eyes, pulled back, licking lips',
    );

    assert.equal(
        cleanSanitizedTagOutput('(moaning around cock, watery eyes, pulled back, licking lips)'),
        'moaning around cock, watery eyes, pulled back, licking lips',
    );
});

test('cleanSanitizedTagOutput returns empty string for non-string input', () => {
    assert.equal(cleanSanitizedTagOutput(null), '');
    assert.equal(cleanSanitizedTagOutput(undefined), '');
});

test('injectConsistencyAnchorTags prepends stable clothing and pose when missing', () => {
    assert.equal(
        injectConsistencyAnchorTags(
            'soft smile, warm lighting, office desk',
            {
                assistantClothing: 'white blouse, blue jeans',
                assistantPose: 'sitting pose',
            },
        ),
        'white blouse, blue jeans, sitting pose, soft smile, warm lighting, office desk',
    );
});

test('injectConsistencyAnchorTags does not duplicate clothing or pose already present', () => {
    assert.equal(
        injectConsistencyAnchorTags(
            'white blouse, blue jeans, sitting pose, soft smile',
            {
                assistantClothing: 'white blouse, blue jeans',
                assistantPose: 'sitting pose',
            },
        ),
        'white blouse, blue jeans, sitting pose, soft smile',
    );
});
