import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPromptFromPhrases,
    createPromptPhraseId,
    createPromptPhraseItem,
    normalizePromptPhrases,
} from '../src/promptPhraseUtils.js';

test('createPromptPhraseId builds a stable prefixed id from provided inputs', () => {
    const id = createPromptPhraseId({
        now: 1234,
        random: 0.123456,
    });

    assert.match(id, /^phrase_1234_/);
});

test('createPromptPhraseItem creates an enabled phrase item', () => {
    const item = createPromptPhraseItem('soft natural lighting', {
        now: 100,
        random: 0.5,
    });

    assert.equal(item.enabled, true);
    assert.equal(item.text, 'soft natural lighting');
    assert.match(item.id, /^phrase_100_/);
});

test('normalizePromptPhrases returns an empty array for invalid input', () => {
    assert.deepEqual(normalizePromptPhrases(null), []);
    assert.deepEqual(normalizePromptPhrases(undefined), []);
    assert.deepEqual(normalizePromptPhrases('nope'), []);
});

test('normalizePromptPhrases filters invalid entries and repairs missing ids', () => {
    const phrases = normalizePromptPhrases(
        [
            null,
            { id: '  keep_me  ', enabled: true, text: ' matte skin ' },
            { enabled: false, text: ' glossy skin ' },
            { id: '', text: 42 },
        ],
        {
            now: 200,
            random: 0.25,
        },
    );

    assert.equal(phrases.length, 3);
    assert.equal(phrases[0].id, 'keep_me');
    assert.equal(phrases[0].enabled, true);
    assert.equal(phrases[0].text, ' matte skin ');

    assert.match(phrases[1].id, /^phrase_200_/);
    assert.equal(phrases[1].enabled, false);
    assert.equal(phrases[1].text, ' glossy skin ');

    assert.match(phrases[2].id, /^phrase_200_/);
    assert.equal(phrases[2].enabled, true);
    assert.equal(phrases[2].text, '');
});

test('buildPromptFromPhrases preserves enabled order and appends cleaned scene tags', () => {
    const prompt = buildPromptFromPhrases(
        [
            { id: 'a', enabled: true, text: 'soft natural lighting' },
            { id: 'b', enabled: false, text: 'glossy skin' },
            { id: 'c', enabled: true, text: 'matte skin' },
            { id: 'd', enabled: true, text: '   ' },
        ],
        ' "kneeling pose,\nlooking up" ',
    );

    assert.equal(
        prompt,
        'soft natural lighting, matte skin, kneeling pose, looking up',
    );
});

test('buildPromptFromPhrases returns only cleaned scene tags when no phrases are enabled', () => {
    const prompt = buildPromptFromPhrases(
        [
            { id: 'a', enabled: false, text: 'soft natural lighting' },
        ],
        '\nopen blouse, warm lighting\n',
    );

    assert.equal(prompt, 'open blouse, warm lighting');
});

test('buildPromptFromPhrases omits empty scene tags and empty phrase text', () => {
    const prompt = buildPromptFromPhrases(
        [
            { id: 'a', enabled: true, text: '  diffused ambient light  ' },
            { id: 'b', enabled: true, text: '' },
        ],
        '',
    );

    assert.equal(prompt, 'diffused ambient light');
});
