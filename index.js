import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
} from '../../../../script.js';
import { appendMediaToMessage } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { createImageGenerationState } from './src/imageGenerationState.js';
import {
    buildPromptFromPhrases as buildPromptFromPhraseItems,
    createPromptPhraseItem,
    normalizePromptPhrases,
} from './src/promptPhraseUtils.js';
import {
    createEmptySceneMemory,
    mergeScenePatch,
} from './src/sceneMemory.js';
import { createChatCaller } from './src/chatBackends.js';
import { createAnalysisPipeline } from './src/analysisPipeline.js';

const extensionName = 'st-image-generation-with-classifier';
const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;
const NEW_MESSAGE_INSERT_DELAY_MS = 1000;

const INSERT_TYPE = {
    DISABLED: 'disabled',
    INLINE: 'inline',
    NEW_MESSAGE: 'new',
};

const PHOTO_REQUEST_REGEX =
    /((send|show|lemme\s*see|let\s*me\s*see|i\s*wanna\s*see|i\s*want\s*to\s*see|can\s*i\s*see|got\s*a?|any)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie|image|shot)s?)|((take|snap|shoot)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie))/i;

let isImageAnalysisCall = false;
const imageGenerationState = createImageGenerationState();
let sceneMemory = createEmptySceneMemory();
const getLlmSettings = () => extension_settings[extensionName]?.llmAnalysis || {};

function movePromptPhraseItem(index, direction) {
    const phrases = extension_settings[extensionName]?.promptPhrases;
    if (!Array.isArray(phrases)) {
        return;
    }

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= phrases.length) {
        return;
    }

    [phrases[index], phrases[targetIndex]] = [phrases[targetIndex], phrases[index]];
}

function escapeHtml(value) {
    return $('<div>').text(value ?? '').html();
}

function renderPromptPhraseItems() {
    const container = $('#prompt_items_container');
    if (!container.length) return;

    const phrases = extension_settings[extensionName]?.promptPhrases || [];

    if (!phrases.length) {
        container.html('<div class="text-muted">No prompt phrases yet.</div>');
        return;
    }

    const html = phrases.map((item, index) => `
        <div
            class="prompt_phrase_row flex-container flexnowrap flexGap10 marginTop5"
            data-index="${index}"
            data-id="${escapeHtml(item.id)}"
        >
            <div class="prompt_phrase_toggle">
                <input
                    type="checkbox"
                    id="prompt_phrase_enabled_${index}"
                    class="checkbox prompt_phrase_enabled"
                    autocomplete="off"
                    ${item.enabled ? 'checked' : ''}
                >
                <label for="prompt_phrase_enabled_${index}" class="sr-only">
                    Enable prompt phrase ${index + 1}
                </label>
            </div>

            <label for="prompt_phrase_text_${index}" class="sr-only">
                Prompt phrase ${index + 1}
            </label>

            <input
                type="text"
                id="prompt_phrase_text_${index}"
                class="text_pole flex1 prompt_phrase_text"
                value="${escapeHtml(item.text)}"
                placeholder="Enter prompt phrase"
                autocomplete="off"
            >

            <button type="button" class="menu_button prompt_phrase_move_up" ${index === 0 ? 'disabled' : ''}>Up</button>
            <button type="button" class="menu_button prompt_phrase_move_down" ${index === phrases.length - 1 ? 'disabled' : ''}>Down</button>
            <button type="button" class="menu_button prompt_phrase_delete">Remove</button>
        </div>
    `).join('');

    container.html(html);
}

function readPromptPhraseItemsFromDom() {
    return $('#prompt_items_container .prompt_phrase_row').map(function () {
        const row = $(this);
        return {
            id: String(row.data('id') || ''),
            enabled: row.find('.prompt_phrase_enabled').prop('checked'),
            text: String(row.find('.prompt_phrase_text').val() || ''),
        };
    }).get();
}

function savePromptPhraseItemsFromDom() {
    extension_settings[extensionName].promptPhrases = normalizePromptPhrases(
        readPromptPhraseItemsFromDom(),
    );
    saveSettingsDebounced();
}

function buildPromptFromPhrases(sceneTags) {
    return buildPromptFromPhraseItems(
        extension_settings[extensionName]?.promptPhrases,
        sceneTags,
    );
}

const defaultSettings = {
    insertType: INSERT_TYPE.DISABLED,
    promptPhrases: [],
    llmAnalysis: {
        enabled: true,
        endpoint: '',
        apiKey: '',
        model: 'thedrummer/cydonia-24b-v4.3',
        promptMaxTokens: 120,
        promptTemperature: 0.4,
        promptSanitizer: {
            enabled: true,
        },

        classifierUseSeparateBackend: false,
        classifierBackend: 'kobold',
        classifierEndpoint: 'http://localhost:5001/v1/chat/completions',
        classifierApiKey: '',
        classifierModel: '',
        classifierMaxTokens: 80,
        classifierTemperature: 0.1,

        includeLastUserMessage: true,
        includePreviousAssistantMessage: false,

        cooldown: {
            enabled: true,
            messages: 2,
        },
        sceneMemory: {
            enabled: true,
        },
    },
};

function updateUI() {
    $('#auto_generation').toggleClass(
        'selected',
        extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED,
    );

    if ($('#image_generation_insert_type').length) {
        $('#image_generation_insert_type').val(
            extension_settings[extensionName].insertType,
        );

        $('#llm_analysis_enabled').prop(
            'checked',
            extension_settings[extensionName].llmAnalysis.enabled,
        );
        $('#llm_analysis_endpoint').val(
            extension_settings[extensionName].llmAnalysis.endpoint,
        );
        $('#llm_analysis_api_key').val(
            extension_settings[extensionName].llmAnalysis.apiKey,
        );
        $('#llm_analysis_model').val(
            extension_settings[extensionName].llmAnalysis.model,
        );

        $('#llm_analysis_prompt_max_tokens').val(
            extension_settings[extensionName].llmAnalysis.promptMaxTokens,
        );
        $('#llm_analysis_prompt_temperature').val(
            extension_settings[extensionName].llmAnalysis.promptTemperature,
        );
        $('#llm_analysis_prompt_sanitizer_enabled').prop(
            'checked',
            extension_settings[extensionName].llmAnalysis.promptSanitizer?.enabled === true,
        );

        $('#llm_analysis_classifier_separate').prop(
            'checked',
            extension_settings[extensionName].llmAnalysis.classifierUseSeparateBackend,
        );
        $('#llm_analysis_classifier_backend').val(
            extension_settings[extensionName].llmAnalysis.classifierBackend,
        );
        $('#llm_analysis_classifier_endpoint').val(
            extension_settings[extensionName].llmAnalysis.classifierEndpoint,
        );
        $('#llm_analysis_classifier_api_key').val(
            extension_settings[extensionName].llmAnalysis.classifierApiKey,
        );
        $('#llm_analysis_classifier_model').val(
            extension_settings[extensionName].llmAnalysis.classifierModel,
        );
        $('#llm_analysis_classifier_max_tokens').val(
            extension_settings[extensionName].llmAnalysis.classifierMaxTokens,
        );
        $('#llm_analysis_classifier_temperature').val(
            extension_settings[extensionName].llmAnalysis.classifierTemperature,
        );
    }
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    if (Object.keys(extension_settings[extensionName]).length === 0) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    } else {
        if (!extension_settings[extensionName].llmAnalysis) {
            extension_settings[extensionName].llmAnalysis = structuredClone(defaultSettings.llmAnalysis);
        } else {
            const llm = extension_settings[extensionName].llmAnalysis;
            const defaults = defaultSettings.llmAnalysis;

            for (const key in defaults) {
                if (llm[key] === undefined) {
                    llm[key] = structuredClone(defaults[key]);
                    continue;
                }

                if (
                    defaults[key] &&
                    typeof defaults[key] === 'object' &&
                    !Array.isArray(defaults[key]) &&
                    llm[key] &&
                    typeof llm[key] === 'object' &&
                    !Array.isArray(llm[key])
                ) {
                    for (const subKey in defaults[key]) {
                        if (llm[key][subKey] === undefined) {
                            llm[key][subKey] = structuredClone(defaults[key][subKey]);
                        }
                    }
                }
            }
        }

        if (extension_settings[extensionName].insertType === undefined) {
            extension_settings[extensionName].insertType = defaultSettings.insertType;
        }

        if (extension_settings[extensionName].insertType === 'replace') {
            extension_settings[extensionName].insertType = INSERT_TYPE.INLINE;
        }

        extension_settings[extensionName].promptPhrases = normalizePromptPhrases(
            extension_settings[extensionName].promptPhrases,
        );
    }

    updateUI();
    renderPromptPhraseItems();
}

async function createSettings(settingsHtml) {
    if (!$('#image_auto_generation_container').length) {
        $('#extensions_settings2').append(
            '<div id="image_auto_generation_container" class="extension_container"></div>',
        );
    }

    $('#image_auto_generation_container').empty().append(settingsHtml);

    $('#image_generation_insert_type').on('change', function () {
        extension_settings[extensionName].insertType = $(this).val();
        updateUI();
        saveSettingsDebounced();
    });

    $('#llm_analysis_enabled').on('change', function () {
        extension_settings[extensionName].llmAnalysis.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#llm_analysis_endpoint').on('input', function () {
        extension_settings[extensionName].llmAnalysis.endpoint = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_api_key').on('input', function () {
        extension_settings[extensionName].llmAnalysis.apiKey = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_model').on('input', function () {
        extension_settings[extensionName].llmAnalysis.model = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_prompt_max_tokens').on('input', function () {
        extension_settings[extensionName].llmAnalysis.promptMaxTokens = Number($(this).val());
        saveSettingsDebounced();
    });

    $('#llm_analysis_prompt_temperature').on('input', function () {
        extension_settings[extensionName].llmAnalysis.promptTemperature = Number($(this).val());
        saveSettingsDebounced();
    });

    $('#llm_analysis_prompt_sanitizer_enabled').on('change', function () {
        extension_settings[extensionName].llmAnalysis.promptSanitizer.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#prompt_item_add').off('click.stImageAutoGeneration').on('click.stImageAutoGeneration', function () {
        savePromptPhraseItemsFromDom();
        extension_settings[extensionName].promptPhrases.push(createPromptPhraseItem(''));
        renderPromptPhraseItems();
        saveSettingsDebounced();
    });

    $('#prompt_items_save').off('click.stImageAutoGeneration').on('click.stImageAutoGeneration', function () {
        savePromptPhraseItemsFromDom();
        toastr.success('Prompt phrases saved');
    });

    $('#prompt_items_container').on('change', '.prompt_phrase_enabled', function () {
        savePromptPhraseItemsFromDom();
    });

    $('#prompt_items_container').on('click', '.prompt_phrase_move_up', function () {
        savePromptPhraseItemsFromDom();
        const index = Number($(this).closest('.prompt_phrase_row').data('index'));
        movePromptPhraseItem(index, -1);
        renderPromptPhraseItems();
        saveSettingsDebounced();
    });

    $('#prompt_items_container').on('click', '.prompt_phrase_move_down', function () {
        savePromptPhraseItemsFromDom();
        const index = Number($(this).closest('.prompt_phrase_row').data('index'));
        movePromptPhraseItem(index, 1);
        renderPromptPhraseItems();
        saveSettingsDebounced();
    });

    $('#prompt_items_container').on('click', '.prompt_phrase_delete', function () {
        savePromptPhraseItemsFromDom();
        const index = Number($(this).closest('.prompt_phrase_row').data('index'));
        extension_settings[extensionName].promptPhrases.splice(index, 1);
        renderPromptPhraseItems();
        saveSettingsDebounced();
    });

    $('#prompt_items_container').on('input', '.prompt_phrase_text', function () {
        const index = Number($(this).closest('.prompt_phrase_row').data('index'));
        const phrases = extension_settings[extensionName]?.promptPhrases || [];
        if (phrases[index]) {
            phrases[index].text = String($(this).val() || '');
        }
    });

    $('#llm_analysis_classifier_separate').on('change', function () {
        extension_settings[extensionName].llmAnalysis.classifierUseSeparateBackend = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_backend').on('change', function () {
        extension_settings[extensionName].llmAnalysis.classifierBackend = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_endpoint').on('input', function () {
        extension_settings[extensionName].llmAnalysis.classifierEndpoint = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_api_key').on('input', function () {
        extension_settings[extensionName].llmAnalysis.classifierApiKey = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_model').on('input', function () {
        extension_settings[extensionName].llmAnalysis.classifierModel = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_max_tokens').on('input', function () {
        extension_settings[extensionName].llmAnalysis.classifierMaxTokens = Number($(this).val());
        saveSettingsDebounced();
    });

    $('#llm_analysis_classifier_temperature').on('input', function () {
        extension_settings[extensionName].llmAnalysis.classifierTemperature = Number($(this).val());
        saveSettingsDebounced();
    });

    updateUI();
    renderPromptPhraseItems();
}

function onExtensionButtonClick() {
    const extensionsDrawer = $('#extensions-settings-button .drawer-toggle');

    if ($('#rm_extensions_block').hasClass('closedDrawer')) {
        extensionsDrawer.trigger('click');
    }

    setTimeout(() => {
        const container = $('#image_auto_generation_container');
        if (container.length) {
            $('#rm_extensions_block').animate(
                {
                    scrollTop:
                        container.offset().top -
                        $('#rm_extensions_block').offset().top +
                        $('#rm_extensions_block').scrollTop(),
                },
                500,
            );

            const drawerContent = container.find('.inline-drawer-content');
            const drawerHeader = container.find('.inline-drawer-header');

            if (drawerContent.is(':hidden') && drawerHeader.length) {
                drawerHeader.trigger('click');
            }
        }
    }, 500);
}

$(function () {
    (async function () {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

        $('#extensionsMenu').append(`<div id="auto_generation" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-robot"></div>
            <span data-i18n="Image Auto Generation">Image Auto Generation</span>
        </div>`);

        $('#auto_generation').off('click').on('click', onExtensionButtonClick);

        await loadSettings();
        await createSettings(settingsHtml);

        $('#extensions-settings-button').off('click.stImageAutoGeneration').on('click.stImageAutoGeneration', function () {
            setTimeout(() => {
                updateUI();
            }, 200);
        });
    })();
});

function preprocessForImagePrompt(text) {
    let cleaned = (text || '').trim();
    cleaned = cleaned.replace(/"[^"]*"/g, ' ');
    cleaned = cleaned.replace(/“[^”]*”/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

function getImageAnalysisTextContext(context) {
    const { latestAssistant, latestUser, previousAssistant } =
        getRecentContextForImageAnalysis(context);

    return {
        latestAssistant,
        latestUser,
        previousAssistant,
        assistantText: preprocessForImagePrompt(latestAssistant),
        latestUserText: preprocessForImagePrompt(latestUser),
        previousAssistantText: preprocessForImagePrompt(previousAssistant),
    };
}

function normalizeScenePatch(parsed) {
    return {
        location: typeof parsed?.location === 'string' ? parsed.location.trim() : '',
        environment: typeof parsed?.environment === 'string' ? parsed.environment.trim() : '',
        assistantPose: typeof parsed?.assistantPose === 'string' ? parsed.assistantPose.trim() : '',
        assistantClothing: typeof parsed?.assistantClothing === 'string' ? parsed.assistantClothing.trim() : '',
        assistantExpression: typeof parsed?.assistantExpression === 'string' ? parsed.assistantExpression.trim() : '',
        interaction: typeof parsed?.interaction === 'string' ? parsed.interaction.trim() : '',
        props: Array.isArray(parsed?.props)
            ? parsed.props.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean)
            : [],
        lighting: typeof parsed?.lighting === 'string' ? parsed.lighting.trim() : '',
        mood: typeof parsed?.mood === 'string' ? parsed.mood.trim() : '',
    };
}

const callChat = createChatCaller({
    extensionName,
    getSettings: getLlmSettings,
});

const {
    classifyReplyForImage,
    extractScenePatch,
    generateImageTagFromReply,
    sanitizeImagePrompt,
} = createAnalysisPipeline({
    extensionName,
    getSettings: getLlmSettings,
    getSceneMemory: () => sceneMemory,
    getImageAnalysisTextContext,
    normalizeScenePatch,
    callChat,
});

eventSource.on(event_types.MESSAGE_RECEIVED, handleIncomingMessage);

function getRecentContextForImageAnalysis(context) {
    const settings = extension_settings[extensionName]?.llmAnalysis || {};
    const chat = context.chat || [];
    const currentIndex = chat.length - 1;

    const latestAssistant = chat[currentIndex]?.mes || '';
    const latestUser =
        settings.includeLastUserMessage && currentIndex >= 1
            ? chat[currentIndex - 1]?.mes || ''
            : '';

    const previousAssistant =
        settings.includePreviousAssistantMessage && currentIndex >= 2
            ? chat[currentIndex - 2]?.mes || ''
            : '';

    return {
        latestAssistant,
        latestUser,
        previousAssistant,
    };
}

function isOnImageCooldown(context) {
    const llmSettings = extension_settings[extensionName]?.llmAnalysis || {};
    const cooldown = llmSettings.cooldown || {};

    if (!cooldown.enabled) {
        return { skip: false, reason: 'disabled' };
    }

    return imageGenerationState.getCooldownDecision({
        chatLength: (context.chat || []).length,
        cooldownMessages: cooldown.messages,
    });
}

function markImageGenerated(context) {
    return imageGenerationState.markImageGenerated({
        chatLength: (context.chat || []).length,
    });
}

function beginPendingGeneratedImageMessage(context, sourceMessage, prompt) {
    const pendingGeneratedImageMessage = imageGenerationState.beginPendingGeneratedImageMessage({
        chatLength: (context.chat || []).length,
        sourceText: typeof sourceMessage?.mes === 'string' ? sourceMessage.mes.trim() : '',
        prompt: typeof prompt === 'string' ? prompt.trim() : '',
        now: Date.now(),
    });

    console.log(`[${extensionName}] tracking pending generated image message`, {
        expectedIndex: pendingGeneratedImageMessage.expectedIndex,
        sourcePreview: pendingGeneratedImageMessage.sourceText.slice(0, 120),
        promptPreview: pendingGeneratedImageMessage.prompt.slice(0, 120),
    });
}

function clearPendingGeneratedImageMessage() {
    const pendingGeneratedImageMessage = imageGenerationState.getPendingGeneratedImageMessage();
    if (pendingGeneratedImageMessage) {
        console.log(`[${extensionName}] cleared pending generated image message`, {
            expectedIndex: pendingGeneratedImageMessage.expectedIndex,
            ageMs: Date.now() - pendingGeneratedImageMessage.createdAt,
        });
    }

    imageGenerationState.clearPendingGeneratedImageMessage(Date.now());
}

function shouldIgnorePendingGeneratedImageMessage(context, message) {
    const pendingGeneratedImageMessage = imageGenerationState.getPendingGeneratedImageMessage();
    if (!pendingGeneratedImageMessage) {
        return false;
    }

    const decision = imageGenerationState.shouldIgnorePendingGeneratedImageMessage({
        chatLength: (context.chat || []).length,
        message,
        now: Date.now(),
    });

    if (decision.reason === 'expired') {
        console.warn(`[${extensionName}] pending generated image message expired`, {
            expectedIndex: pendingGeneratedImageMessage.expectedIndex,
            ageMs: decision.ageMs,
        });
        return false;
    }

    if (decision.ignore) {
        console.log(`[${extensionName}] ignored self-generated image message`, {
            currentIndex: decision.currentIndex,
            expectedIndex: decision.expectedIndex,
            ageMs: decision.ageMs,
            hasImageMedia: decision.hasImageMedia,
            reason: decision.reason,
            messageTextEmpty: !decision.messageText,
            matchedPromptText: decision.reason === 'prompt_text',
            matchedSourceText: decision.reason === 'source_text',
            messagePreview: decision.messageText.slice(0, 120),
        });
        return true;
    }

    console.log(`[${extensionName}] pending generated image message did not match latest assistant message`, {
        currentIndex: decision.currentIndex,
        expectedIndex: decision.expectedIndex,
        ageMs: decision.ageMs,
        hasImageMedia: decision.hasImageMedia,
        messagePreview: decision.messageText.slice(0, 120),
    });
    return false;
}

async function refreshLatestMessageSnapshot(delayMs = 150) {
    if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const refreshedContext = getContext();
    const refreshedChat = refreshedContext.chat || [];

    return {
        context: refreshedContext,
        chat: refreshedChat,
        message: refreshedChat[refreshedChat.length - 1],
    };
}

async function waitForNewMessageInsertionWindow() {
    await new Promise(resolve => setTimeout(resolve, NEW_MESSAGE_INSERT_DELAY_MS));
}

function safeParseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') {
        return null;
    }

    let trimmed = raw.trim();
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    try {
        return JSON.parse(trimmed);
    } catch { }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch { }
    }

    return null;
}

async function handleIncomingMessage() {
    if (isImageAnalysisCall) {
        console.log(`[${extensionName}] skipped MESSAGE_RECEIVED because analysis call is already in progress`);
        return;
    }

    if (
        !extension_settings[extensionName] ||
        extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED
    ) {
        console.log(`[${extensionName}] skipped MESSAGE_RECEIVED because extension is disabled`);
        return;
    }

    let { context, message } = await refreshLatestMessageSnapshot();
    const currentIndex = (context.chat || []).length - 1;
    const pendingGeneratedImageMessage = imageGenerationState.getPendingGeneratedImageMessage();

    console.log(`[${extensionName}] MESSAGE_RECEIVED`, {
        currentIndex,
        isUser: !!message?.is_user,
        hasExtra: !!message?.extra,
        hasImage: !!message?.extra?.image,
        inlineImage: !!message?.extra?.inline_image,
        hasImageSwipes: Array.isArray(message?.extra?.image_swipes),
        alreadyProcessed: !!message?.extra?.imageAutoGenerationProcessed,
        pendingExpectedIndex: pendingGeneratedImageMessage?.expectedIndex ?? null,
        pendingAgeMs: pendingGeneratedImageMessage
            ? Date.now() - pendingGeneratedImageMessage.createdAt
            : null,
        messagePreview: typeof message?.mes === 'string' ? message.mes.trim().slice(0, 160) : '',
    });

    if (!message || message.is_user) {
        console.log(`[${extensionName}] skipped latest message because it is missing or authored by user`, {
            currentIndex,
            hasMessage: !!message,
        });
        return;
    }

    if (shouldIgnorePendingGeneratedImageMessage(context, message)) {
        if (!message.extra) {
            message.extra = {};
        }
        message.extra.imageAutoGenerationProcessed = true;
        return;
    }

    const messageText = typeof message.mes === 'string' ? message.mes.trim() : '';
    if (!messageText) {
        console.log(`[${extensionName}] skipped latest assistant message because it has no text`, {
            currentIndex,
        });
        return;
    }

    if (
        message.extra?.image ||
        message.extra?.inline_image ||
        Array.isArray(message.extra?.image_swipes)
    ) {
        console.log(`[${extensionName}] skipped latest assistant message because image media is already attached`, {
            currentIndex,
        });
        return;
    }

    if (message.extra?.imageAutoGenerationProcessed) {
        console.log(`[${extensionName}] skipped latest assistant message because it is already marked processed`, {
            currentIndex,
        });
        return;
    }

    if (!message.extra) {
        message.extra = {};
    }

    message.extra.imageAutoGenerationProcessed = true;
    console.log(`[${extensionName}] marked assistant message as processed before analysis`, {
        currentIndex,
    });

    if (!extension_settings[extensionName]?.llmAnalysis?.enabled) {
        console.log(`[${extensionName}] LLM analysis disabled, stopping after processed marker`, {
            currentIndex,
        });
        return;
    }

    const { latestUserText: userText } = getImageAnalysisTextContext(context);

    let sceneEval = {
        generate: false,
        category: 'dialogue_only',
        weight: 0,
    };

    try {
        isImageAnalysisCall = true;

        if (extension_settings[extensionName]?.llmAnalysis?.sceneMemory?.enabled) {
            const patch = await extractScenePatch(context);
            console.log(`[${extensionName}] scene memory before merge`, structuredClone(sceneMemory));
            console.log(`[${extensionName}] scene patch before merge`, structuredClone(patch));
            mergeScenePatch(sceneMemory, patch);
            console.log(`[${extensionName}] scene memory after merge`, structuredClone(sceneMemory));
        }

        sceneEval = await classifyReplyForImage(context);

        if (PHOTO_REQUEST_REGEX.test(userText)) {
            sceneEval.generate = true;
            sceneEval.weight = 1.0;
            sceneEval.category = 'explicit_request';
        }

        if (sceneEval.category === 'nsfw_action') {
            sceneEval.weight = Math.max(sceneEval.weight, 0.9);
        }

        if (sceneEval.category === 'physical_interaction') {
            sceneEval.weight = Math.min(sceneEval.weight, 0.82);
        }

        console.log(`[${extensionName}] scene eval`, {
            sceneEval,
            preview: message.mes.slice(0, 200),
        });
    } catch (error) {
        console.error(`[${extensionName}] scene analysis failed`, error);
        return;
    } finally {
        isImageAnalysisCall = false;
    }

    if (!sceneEval.generate) {
        console.log(`[${extensionName}] classifier decided not to generate an image`, {
            currentIndex,
            sceneEval,
        });
        return;
    }

    const cooldownDecision = isOnImageCooldown(context);
    if (sceneEval.category !== 'nsfw_action' && cooldownDecision.skip) {
        console.log(`[${extensionName}] skipped due to cooldown`, {
            currentIndex,
            lastImageGeneratedAtMessageIndex:
                imageGenerationState.getLastImageGeneratedAtMessageIndex(),
            cooldownMessages: extension_settings[extensionName]?.llmAnalysis?.cooldown?.messages,
            cooldownDecision,
        });
        return;
    }

    if (sceneEval.category === 'nsfw_action' && cooldownDecision.skip) {
        console.log(`[${extensionName}] bypassed cooldown for nsfw_action`, {
            currentIndex,
            cooldownDecision,
            sceneEval,
        });
    }

    const sceneWeightRoll = Math.random();
    console.log(`[${extensionName}] scene weight decision`, {
        currentIndex,
        category: sceneEval.category,
        generate: sceneEval.generate,
        weight: sceneEval.weight,
        roll: sceneWeightRoll,
        sceneMemoryEnabled: extension_settings[extensionName]?.llmAnalysis?.sceneMemory?.enabled === true,
        sceneMemory: structuredClone(sceneMemory),
    });

    if (sceneWeightRoll > sceneEval.weight) {
        console.log(`[${extensionName}] skipped due to scene weight roll`, {
            currentIndex,
            sceneEval,
            roll: sceneWeightRoll,
        });
        return;
    }

    let sceneTags = '';

    try {
        isImageAnalysisCall = true;
        sceneTags = await generateImageTagFromReply(context);
        console.log(`[${extensionName}] scene builder raw output`, sceneTags);

        if (extension_settings[extensionName]?.llmAnalysis?.promptSanitizer?.enabled) {
            const sanitizedSceneTags = await sanitizeImagePrompt(sceneTags, context);
            console.log(`[${extensionName}] scene builder sanitized output`, {
                rawSceneTags: sceneTags,
                sanitizedSceneTags,
            });
            sceneTags = sanitizedSceneTags || sceneTags;
        }
    } catch (error) {
        console.error(`[${extensionName}] scene builder failed`, error);
        return;
    } finally {
        isImageAnalysisCall = false;
    }

    if (!sceneTags || !sceneTags.trim()) {
        console.warn(`[${extensionName}] empty scene tags`);
        return;
    }

    const prompt = buildPromptFromPhrases(sceneTags);

    console.log(`[${extensionName}] final SD prompt`, {
        prompt,
        promptPhrases: structuredClone(extension_settings[extensionName]?.promptPhrases || []),
        sceneTags,
    });

    const insertType = extension_settings[extensionName].insertType;
    const sdStartAt = Date.now();

    try {
        toastr.info('Generating image...');
        console.log(`[${extensionName}] invoking /sd`, {
            currentIndex,
            insertType,
            quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
            promptPreview: prompt.slice(0, 160),
        });

        if (insertType === INSERT_TYPE.NEW_MESSAGE) {
            await waitForNewMessageInsertionWindow();
            beginPendingGeneratedImageMessage(context, message, prompt);
        }

        const result = await SlashCommandParser.commands.sd.callback(
            {
                quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true',
            },
            prompt,
        );

        console.log(`[${extensionName}] /sd completed`, {
            currentIndex,
            insertType,
            elapsedMs: Date.now() - sdStartAt,
            hasResult: !!result,
        });

        if (!result) {
            if (insertType === INSERT_TYPE.NEW_MESSAGE) {
                clearPendingGeneratedImageMessage();
            }
            console.warn(`[${extensionName}] SD returned no image`);
            return;
        }

        if (insertType === INSERT_TYPE.INLINE) {
            if (!message.extra) {
                message.extra = {};
            }

            if (!Array.isArray(message.extra.image_swipes)) {
                message.extra.image_swipes = [];
            }

            message.extra.image_swipes.push(result);
            message.extra.image = result;
            message.extra.title = prompt;
            message.extra.inline_image = true;

            const messageElement = $(`.mes[mesid="${context.chat.length - 1}"]`);
            appendMediaToMessage(message, messageElement);
            await context.saveChat();
        }

        if (insertType === INSERT_TYPE.NEW_MESSAGE) {
            const refreshed = await refreshLatestMessageSnapshot(0);
            const pendingMessageAfterSd = imageGenerationState.getPendingGeneratedImageMessage();
            const generatedMessage = refreshed.chat[pendingMessageAfterSd?.expectedIndex];

            console.log(`[${extensionName}] post-/sd refresh for new-message mode`, {
                expectedIndex: pendingMessageAfterSd?.expectedIndex ?? null,
                refreshedChatLength: refreshed.chat.length,
                foundGeneratedMessage: !!generatedMessage,
                generatedPreview: typeof generatedMessage?.mes === 'string'
                    ? generatedMessage.mes.trim().slice(0, 160)
                    : '',
                generatedHasImage: !!generatedMessage?.extra?.image,
                generatedInlineImage: !!generatedMessage?.extra?.inline_image,
                generatedHasSwipes: Array.isArray(generatedMessage?.extra?.image_swipes),
            });

            if (generatedMessage) {
                if (!generatedMessage.extra) {
                    generatedMessage.extra = {};
                }

                generatedMessage.extra.imageAutoGenerationProcessed = true;
            }

            markImageGenerated(refreshed.context);
            clearPendingGeneratedImageMessage();
        } else {
            markImageGenerated(context);
        }
        toastr.success('Image generated');
    } catch (error) {
        if (insertType === INSERT_TYPE.NEW_MESSAGE) {
            clearPendingGeneratedImageMessage();
        }
        console.error(`[${extensionName}] /sd failed`, {
            currentIndex,
            insertType,
            elapsedMs: Date.now() - sdStartAt,
            error,
        });
        toastr.error(`Image generation error: ${error}`);
        console.error(`[${extensionName}] SD generation failed`, error);
    }
}
