import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeCharacterOutput } from '../src/chatOutputSanitizer.js';

test('sanitizeCharacterOutput removes repeated adjacent sentences', () => {
    const result = sanitizeCharacterOutput('She smiles softly. She smiles softly. Then she steps back.');

    assert.equal(result.text, 'She smiles softly. Then she steps back.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('duplicate_sentences'));
});

test('sanitizeCharacterOutput removes repeated adjacent words', () => {
    const result = sanitizeCharacterOutput('She moves closer closer and smiles.');

    assert.equal(result.text, 'She moves closer and smiles.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('duplicate_words'));
});

test('sanitizeCharacterOutput trims obvious dangling trailing fragments after a complete sentence', () => {
    const result = sanitizeCharacterOutput('She sits beside you and lowers her voice. Her hand rests on');

    assert.equal(result.text, 'She sits beside you and lowers her voice.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('dangling_fragment'));
});

test('sanitizeCharacterOutput keeps normal unpunctuated replies intact', () => {
    const result = sanitizeCharacterOutput('She gives you a quiet nod');

    assert.equal(result.text, 'She gives you a quiet nod');
    assert.equal(result.changed, false);
});
