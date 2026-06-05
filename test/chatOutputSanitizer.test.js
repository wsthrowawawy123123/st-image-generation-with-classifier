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

test('sanitizeCharacterOutput removes leaked continuity blocks from visible replies', () => {
    const result = sanitizeCharacterOutput(`She turns back toward you and lowers her voice.
Continuity State: [canon]
Character: angi li
[/canon]
[continuity state]
Use these facts as the current scene state.
Location: office
Last action`);

    assert.equal(result.text, 'She turns back toward you and lowers her voice.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('prompt_scaffold_leak'));
});

test('sanitizeCharacterOutput removes closed canon and continuity blocks without dropping prose', () => {
    const result = sanitizeCharacterOutput(`She nods.
[canon]
Character: angi li
[/canon]
Then she smiles.
[continuity state]
Location: office
[/continuity state]`);

    assert.equal(result.text, 'She nods. Then she smiles.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('prompt_scaffold_leak'));
});

test('sanitizeCharacterOutput removes broader prompt scaffold labels', () => {
    const result = sanitizeCharacterOutput(`She smiles.
System: stay in character
Relevant facts: location office`);

    assert.equal(result.text, 'She smiles.');
    assert.equal(result.changed, true);
    assert.ok(result.reasons.includes('prompt_scaffold_leak'));
});
