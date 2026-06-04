import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatCaller } from '../src/chatBackends.js';

test('createChatCaller uses the primary kobold backend for scene analysis calls', async () => {
    const calls = [];
    const originalFetch = global.fetch;

    global.fetch = async (url, init = {}) => {
        calls.push({
            url,
            body: JSON.parse(init.body),
        });

        return {
            ok: true,
            async json() {
                return {
                    choices: [
                        {
                            message: {
                                content: 'ok',
                            },
                        },
                    ],
                };
            },
        };
    };

    try {
        const callChat = createChatCaller({
            extensionName: 'test-extension',
            getSettings: () => ({
                backend: 'kobold',
                endpoint: 'http://127.0.0.1:5001/v1/chat/completions',
                apiKey: '',
                model: '',
                promptMaxTokens: 120,
                promptTemperature: 0.4,
                classifierUseSeparateBackend: false,
            }),
        });

        const result = await callChat(
            [{ role: 'user', content: 'hello' }],
            { max_tokens: 120, temperature: 0.4 },
        );

        assert.equal(result, 'ok');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://127.0.0.1:5001/v1/chat/completions');
        assert.deepEqual(calls[0].body, {
            messages: [{ role: 'user', content: 'hello' }],
            max_tokens: 120,
            temperature: 0.4,
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('createChatCaller uses the separate classifier backend when enabled', async () => {
    const calls = [];
    const originalFetch = global.fetch;

    global.fetch = async (url, init = {}) => {
        calls.push({
            url,
            body: JSON.parse(init.body),
        });

        return {
            ok: true,
            async json() {
                return {
                    choices: [
                        {
                            message: {
                                content: 'classifier-ok',
                            },
                        },
                    ],
                };
            },
        };
    };

    try {
        const callChat = createChatCaller({
            extensionName: 'test-extension',
            getSettings: () => ({
                backend: 'kobold',
                endpoint: 'http://127.0.0.1:5001/v1/chat/completions',
                apiKey: '',
                model: '',
                promptMaxTokens: 120,
                promptTemperature: 0.4,
                classifierUseSeparateBackend: true,
                classifierBackend: 'openai',
                classifierEndpoint: 'http://127.0.0.1:1234/v1/chat/completions',
                classifierApiKey: 'secret',
                classifierModel: 'local-model',
            }),
        });

        const result = await callChat(
            [{ role: 'user', content: 'classify' }],
            { useClassifierBackend: true, max_tokens: 42, temperature: 0.25 },
        );

        assert.equal(result, 'classifier-ok');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions');
        assert.deepEqual(calls[0].body, {
            model: 'local-model',
            messages: [{ role: 'user', content: 'classify' }],
            max_tokens: 42,
            temperature: 0.25,
        });
    } finally {
        global.fetch = originalFetch;
    }
});
