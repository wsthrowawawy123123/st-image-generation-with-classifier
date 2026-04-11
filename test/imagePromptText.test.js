import test from 'node:test';
import assert from 'node:assert/strict';

import { preprocessForImagePrompt } from '../src/imagePromptText.js';

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
