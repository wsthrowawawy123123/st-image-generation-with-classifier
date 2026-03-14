export function createChatCaller({ extensionName, getSettings }) {
    async function callRunpodBackend(endpoint, apiKey, model, messages, options = {}) {
        const settings = getSettings();
        const max_tokens = options.max_tokens ?? settings.promptMaxTokens ?? 120;
        const temperature = options.temperature ?? settings.promptTemperature ?? 0.4;

        const requestBody = {
            input: {
                model,
                messages,
                max_tokens,
                temperature,
            },
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Runpod chat error ${response.status}: ${text}`);
        }

        let data = await response.json();
        console.log(`[${extensionName}] Runpod raw response`, data);

        if (data?.status && data.status !== 'COMPLETED') {
            const jobId = data?.id;
            if (!jobId) {
                throw new Error('Runpod returned queued job without id');
            }

            const baseUrl = endpoint.replace(/\/runsync$/, '').replace(/\/run$/, '');
            const statusUrl = `${baseUrl}/status/${jobId}`;

            let retries = 0;
            const maxRetries = 30;

            while (retries < maxRetries) {
                await new Promise(r => setTimeout(r, 1000));

                const statusResp = await fetch(statusUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    },
                });

                if (!statusResp.ok) {
                    const text = await statusResp.text();
                    throw new Error(`Runpod status error ${statusResp.status}: ${text}`);
                }

                data = await statusResp.json();
                console.log(`[${extensionName}] Runpod status response`, data);

                if (data?.status === 'COMPLETED') {
                    break;
                }

                if (
                    data?.status === 'FAILED' ||
                    data?.status === 'CANCELLED' ||
                    data?.status === 'TIMED_OUT'
                ) {
                    throw new Error(`Runpod job ended with status: ${data.status}`);
                }

                retries++;
            }

            if (data?.status !== 'COMPLETED') {
                throw new Error('Runpod job did not complete in time');
            }
        }

        const tokens = data?.output?.[0]?.choices?.[0]?.tokens;
        if (Array.isArray(tokens)) {
            return tokens.join('').trim();
        }

        const content = data?.output?.[0]?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }

        const text = data?.output?.[0]?.choices?.[0]?.text;
        if (typeof text === 'string') {
            return text.trim();
        }

        console.warn(`[${extensionName}] Runpod completed without parseable output`, data);
        return '';
    }

    async function callOpenAICompatibleBackend(endpoint, apiKey, model, messages, options = {}) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                ...(model ? { model } : {}),
                messages,
                max_tokens: options.max_tokens ?? 80,
                temperature: options.temperature ?? 0.1,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI-compatible chat error ${response.status}: ${text}`);
        }

        const data = await response.json();

        return (
            data?.choices?.[0]?.message?.content ??
            data?.choices?.[0]?.text ??
            ''
        ).trim();
    }

    async function callKoboldBackend(endpoint, apiKey, model, messages, options = {}) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                ...(model ? { model } : {}),
                messages,
                max_tokens: options.max_tokens ?? 8,
                temperature: options.temperature ?? 0.1,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Kobold chat error ${response.status}: ${text}`);
        }

        const data = await response.json();

        return (
            data?.choices?.[0]?.message?.content ??
            data?.choices?.[0]?.text ??
            ''
        ).trim();
    }

    return async function callChat(messages, options = {}) {
        const settings = getSettings();
        const useClassifierBackend = options.useClassifierBackend === true;

        const backend = useClassifierBackend
            ? (settings.classifierBackend || 'kobold')
            : 'runpod';

        const endpoint = useClassifierBackend
            ? (settings.classifierEndpoint || settings.endpoint)
            : settings.endpoint;

        const apiKey = useClassifierBackend
            ? (settings.classifierApiKey || settings.apiKey)
            : settings.apiKey;

        const model = useClassifierBackend
            ? (settings.classifierModel || settings.model)
            : settings.model;

        if (!endpoint) {
            throw new Error(`Missing endpoint for backend: ${backend}`);
        }

        if (backend === 'runpod') {
            return await callRunpodBackend(endpoint, apiKey, model, messages, options);
        }

        if (backend === 'kobold') {
            return await callKoboldBackend(endpoint, apiKey, model, messages, options);
        }

        if (backend === 'openai') {
            return await callOpenAICompatibleBackend(endpoint, apiKey, model, messages, options);
        }

        throw new Error(`Unsupported backend: ${backend}`);
    };
}
