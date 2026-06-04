let memoryBlockBuilder = null;

export function registerPromptInjection(builder) {
    memoryBlockBuilder = builder;
}

export function unregisterPromptInjection() {
    memoryBlockBuilder = null;
}

export function injectContinuityMemory(chat, memoryBlock, position = 'before_latest_message') {
    if (!Array.isArray(chat) || !memoryBlock?.trim()) {
        return false;
    }

    const note = structuredClone({
        is_user: false,
        name: 'Continuity State',
        send_date: Date.now(),
        mes: memoryBlock.trim(),
        extra: {
            continuityMemoryInjected: true,
        },
    });

    let insertIndex = chat.length;

    if (position === 'before_latest_message') {
        const latestUserIndex = [...chat].map((message, index) => ({ message, index }))
            .reverse()
            .find(entry => entry.message?.is_user === true)?.index;

        if (Number.isInteger(latestUserIndex)) {
            insertIndex = latestUserIndex;
        }
    }

    chat.splice(insertIndex, 0, note);
    return true;
}

export async function runPromptInjection(chat, contextSize, abort, type) {
    if (typeof memoryBlockBuilder !== 'function') {
        return;
    }

    if (type === 'quiet') {
        return;
    }

    try {
        const result = await memoryBlockBuilder({ chat, contextSize, abort, type });
        if (!result?.memoryBlock) {
            return;
        }

        injectContinuityMemory(chat, result.memoryBlock, result.position);
    } catch (error) {
        console.error('[st-image-generation-with-classifier] continuity prompt injection failed', error);
    }
}
