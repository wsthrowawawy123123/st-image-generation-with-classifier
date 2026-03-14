export const PENDING_IMAGE_MESSAGE_TTL_MS = 10 * 60 * 1000;

export function createImageGenerationState({
    pendingTtlMs = PENDING_IMAGE_MESSAGE_TTL_MS,
} = {}) {
    let lastImageGeneratedAtMessageIndex = -Infinity;
    let pendingGeneratedImageMessage = null;

    function getLastImageGeneratedAtMessageIndex() {
        return lastImageGeneratedAtMessageIndex;
    }

    function getPendingGeneratedImageMessage() {
        return pendingGeneratedImageMessage;
    }

    function getCooldownDecision({
        chatLength,
        cooldownMessages,
        random = Math.random,
    }) {
        const currentIndex = chatLength - 1;
        const minMessagesBetweenImages = Number(cooldownMessages) || 0;
        const distance = currentIndex - lastImageGeneratedAtMessageIndex;

        if (!Number.isFinite(minMessagesBetweenImages) || minMessagesBetweenImages <= 0) {
            return {
                skip: false,
                reason: 'disabled',
                distance,
                roll: null,
                threshold: null,
            };
        }

        if (distance >= minMessagesBetweenImages) {
            return {
                skip: false,
                reason: 'window_passed',
                distance,
                roll: null,
                threshold: null,
            };
        }

        if (distance <= 1) {
            return {
                skip: true,
                reason: 'hard_cooldown',
                distance,
                roll: null,
                threshold: 1,
            };
        }

        const remainingWindow = minMessagesBetweenImages - distance;
        const probabilisticSlots = Math.max(1, minMessagesBetweenImages - 2);
        const threshold = Math.min(0.95, remainingWindow / (probabilisticSlots + 1));
        const roll = random();

        return {
            skip: roll < threshold,
            reason: 'hybrid_cooldown',
            distance,
            roll,
            threshold,
        };
    }

    function isOnCooldown({ chatLength, cooldownMessages, random }) {
        return getCooldownDecision({ chatLength, cooldownMessages, random }).skip;
    }

    function markImageGenerated({ chatLength }) {
        lastImageGeneratedAtMessageIndex = chatLength - 1;
        return lastImageGeneratedAtMessageIndex;
    }

    function beginPendingGeneratedImageMessage({
        chatLength,
        sourceText = '',
        prompt = '',
        now = Date.now(),
    }) {
        pendingGeneratedImageMessage = {
            expectedIndex: chatLength,
            createdAt: now,
            sourceText: sourceText.trim(),
            prompt: prompt.trim(),
        };

        return pendingGeneratedImageMessage;
    }

    function clearPendingGeneratedImageMessage(now = Date.now()) {
        if (!pendingGeneratedImageMessage) {
            return null;
        }

        const cleared = {
            ...pendingGeneratedImageMessage,
            clearedAt: now,
            ageMs: now - pendingGeneratedImageMessage.createdAt,
        };

        pendingGeneratedImageMessage = null;
        return cleared;
    }

    function shouldIgnorePendingGeneratedImageMessage({
        chatLength,
        message,
        now = Date.now(),
    }) {
        if (!pendingGeneratedImageMessage) {
            return {
                ignore: false,
                reason: 'no_pending_message',
                ageMs: null,
                expectedIndex: null,
            };
        }

        const ageMs = now - pendingGeneratedImageMessage.createdAt;
        if (ageMs >= pendingTtlMs) {
            const expired = clearPendingGeneratedImageMessage(now);
            return {
                ignore: false,
                reason: 'expired',
                ageMs,
                expectedIndex: expired?.expectedIndex ?? null,
                expired,
            };
        }

        const currentIndex = chatLength - 1;
        const messageText = typeof message?.mes === 'string' ? message.mes.trim() : '';
        const hasImageMedia =
            !!message?.extra?.image ||
            !!message?.extra?.inline_image ||
            Array.isArray(message?.extra?.image_swipes);

        const matchedBy =
            currentIndex === pendingGeneratedImageMessage.expectedIndex
                ? 'expected_index'
                : hasImageMedia
                    ? 'has_image_media'
                    : !messageText
                        ? 'empty_text'
                        : messageText === pendingGeneratedImageMessage.prompt
                            ? 'prompt_text'
                            : messageText === pendingGeneratedImageMessage.sourceText
                                ? 'source_text'
                                : null;

        if (!matchedBy) {
            return {
                ignore: false,
                reason: 'no_match',
                ageMs,
                expectedIndex: pendingGeneratedImageMessage.expectedIndex,
                currentIndex,
                hasImageMedia,
                messageText,
            };
        }

        const cleared = clearPendingGeneratedImageMessage(now);
        return {
            ignore: true,
            reason: matchedBy,
            ageMs,
            expectedIndex: cleared?.expectedIndex ?? null,
            currentIndex,
            hasImageMedia,
            messageText,
            cleared,
        };
    }

    return {
        beginPendingGeneratedImageMessage,
        clearPendingGeneratedImageMessage,
        getCooldownDecision,
        getLastImageGeneratedAtMessageIndex,
        getPendingGeneratedImageMessage,
        isOnCooldown,
        markImageGenerated,
        shouldIgnorePendingGeneratedImageMessage,
    };
}
