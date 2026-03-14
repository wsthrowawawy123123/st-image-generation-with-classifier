import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createImageGenerationState,
    PENDING_IMAGE_MESSAGE_TTL_MS,
} from '../src/imageGenerationState.js';

test('tracks and ignores the expected next generated message index', () => {
    const state = createImageGenerationState();
    const now = 1_000;

    state.beginPendingGeneratedImageMessage({
        chatLength: 4,
        sourceText: 'assistant reply',
        prompt: 'prompt tags',
        now,
    });

    const result = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 5,
        message: { mes: 'some generated caption', extra: {} },
        now: now + 250,
    });

    assert.equal(result.ignore, true);
    assert.equal(result.reason, 'expected_index');
    assert.equal(state.getPendingGeneratedImageMessage(), null);
});

test('ignores a pending generated message when image media is already attached', () => {
    const state = createImageGenerationState();

    state.beginPendingGeneratedImageMessage({
        chatLength: 2,
        sourceText: 'assistant reply',
        prompt: 'prompt tags',
        now: 1_000,
    });

    const result = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 2,
        message: { mes: 'image wrapper', extra: { image: 'file.png' } },
        now: 1_500,
    });

    assert.equal(result.ignore, true);
    assert.equal(result.reason, 'has_image_media');
});

test('does not ignore unrelated assistant messages while pending generation is in flight', () => {
    const state = createImageGenerationState();

    state.beginPendingGeneratedImageMessage({
        chatLength: 3,
        sourceText: 'assistant reply',
        prompt: 'prompt tags',
        now: 2_000,
    });

    const result = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 3,
        message: { mes: 'new unrelated assistant message', extra: {} },
        now: 2_500,
    });

    assert.equal(result.ignore, false);
    assert.equal(result.reason, 'no_match');
    assert.notEqual(state.getPendingGeneratedImageMessage(), null);
});

test('expires stale pending generated message tracking after TTL', () => {
    const state = createImageGenerationState();

    state.beginPendingGeneratedImageMessage({
        chatLength: 6,
        sourceText: 'assistant reply',
        prompt: 'prompt tags',
        now: 5_000,
    });

    const result = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 6,
        message: { mes: 'late unrelated assistant message', extra: {} },
        now: 5_000 + PENDING_IMAGE_MESSAGE_TTL_MS + 1,
    });

    assert.equal(result.ignore, false);
    assert.equal(result.reason, 'expired');
    assert.equal(state.getPendingGeneratedImageMessage(), null);
});

test('cooldown compares against the last generated message index', () => {
    const state = createImageGenerationState();

    assert.equal(
        state.isOnCooldown({ chatLength: 5, cooldownMessages: 2 }),
        false,
    );

    state.markImageGenerated({ chatLength: 5 });

    assert.equal(
        state.isOnCooldown({ chatLength: 5, cooldownMessages: 2 }),
        true,
    );
    assert.equal(
        state.isOnCooldown({ chatLength: 6, cooldownMessages: 2 }),
        true,
    );
    assert.equal(
        state.isOnCooldown({ chatLength: 7, cooldownMessages: 2 }),
        false,
    );
});

test('hybrid cooldown hard-skips the first follow-up message, then becomes probabilistic', () => {
    const state = createImageGenerationState();

    state.markImageGenerated({ chatLength: 5 });

    const hardCooldown = state.getCooldownDecision({
        chatLength: 6,
        cooldownMessages: 4,
        random: () => 0.99,
    });
    assert.equal(hardCooldown.skip, true);
    assert.equal(hardCooldown.reason, 'hard_cooldown');

    const probabilisticSkip = state.getCooldownDecision({
        chatLength: 7,
        cooldownMessages: 4,
        random: () => 0.2,
    });
    assert.equal(probabilisticSkip.skip, true);
    assert.equal(probabilisticSkip.reason, 'hybrid_cooldown');

    const probabilisticPass = state.getCooldownDecision({
        chatLength: 7,
        cooldownMessages: 4,
        random: () => 0.8,
    });
    assert.equal(probabilisticPass.skip, false);
    assert.equal(probabilisticPass.reason, 'hybrid_cooldown');
});

test('can ignore based on prompt or source text matches when indexes do not line up', () => {
    const state = createImageGenerationState();

    state.beginPendingGeneratedImageMessage({
        chatLength: 10,
        sourceText: 'assistant reply body',
        prompt: 'prompt tags here',
        now: 8_000,
    });

    const byPrompt = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 10,
        message: { mes: 'prompt tags here', extra: {} },
        now: 8_100,
    });

    assert.equal(byPrompt.ignore, true);
    assert.equal(byPrompt.reason, 'prompt_text');

    state.beginPendingGeneratedImageMessage({
        chatLength: 10,
        sourceText: 'assistant reply body',
        prompt: 'prompt tags here',
        now: 9_000,
    });

    const bySource = state.shouldIgnorePendingGeneratedImageMessage({
        chatLength: 10,
        message: { mes: 'assistant reply body', extra: {} },
        now: 9_100,
    });

    assert.equal(bySource.ignore, true);
    assert.equal(bySource.reason, 'source_text');
});
