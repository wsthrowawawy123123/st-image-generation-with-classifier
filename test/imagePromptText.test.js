import test from 'node:test';
import assert from 'node:assert/strict';

import {
    preprocessForImagePrompt,
    buildFallbackSceneTags,
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
