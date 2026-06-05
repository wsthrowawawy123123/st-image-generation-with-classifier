import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
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
    preprocessForImagePrompt,
    preprocessForClassifierInput,
    buildFallbackSceneTags,
    sanitizeFinalImagePrompt,
} from './src/imagePromptText.js';
import { sanitizeCharacterOutput } from './src/chatOutputSanitizer.js';
import {
    repairCurrentState,
    repairMemoryEvent,
    repairSceneRecord,
} from './src/dataMaintenance.js';
import { createChatCaller } from './src/chatBackends.js';
import {
    applyContinuityMemoryToCurrentState,
    buildContinuityMemoryBlock,
    createAnalysisPipeline,
    imageTagsToSceneTags,
} from './src/analysisPipeline.js';
import { DEFAULT_CURRENT_STATE, DEFAULT_MEMORY_SETTINGS } from './src/memory.js';
import { registerPromptInjection, runPromptInjection } from './src/memoryInjectionAdapter.js';
import {
    DEFAULT_CANON_SNAPSHOT,
    buildCanonMemoryBlock,
    buildCanonSnapshotFromContext,
    buildCanonSnapshotPrompt,
    parseCanonSnapshotOutput,
} from './src/canonSnapshot.js';
import {
    archiveOldScenes,
    cleanupArchivedSourceText,
    clearCanonSnapshot,
    clearScenes,
    clearAllCurrentStates,
    clearCurrentState,
    compactChatScenes,
    deleteScene,
    exportScenes,
    getAllScenes,
    getCanonSnapshot,
    getCurrentState,
    getMemoryContextForChat,
    getStorageUsage,
    importScenes,
    initDb,
    repairChatData,
    saveCanonSnapshot,
    requestPersistentStorage,
    saveCurrentState,
    saveMemoryEvent,
    saveScene,
} from './src/storage.js';
import { filterBySafety, filterScenes, rawSearch } from './src/search.js';
import { createSceneTaggerUi } from './src/ui.js';
import {
    DEFAULT_USER_REPLY_MEMORY_SETTINGS,
    applyUserReplyMemoryToCurrentState,
    buildUserReplyMemoryPrompt,
    detectUserCorrection,
    parseUserReplyMemoryOutput,
} from './src/userReplyMemory.js';

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
let isDataMaintenanceRunning = false;
const imageGenerationState = createImageGenerationState();
let sceneTaggerUi = null;
const sceneTaggerState = {
    scenes: [],
    filteredScenes: [],
    selectedSceneId: '',
    status: 'Ready',
    memorySettings: structuredClone(DEFAULT_MEMORY_SETTINGS),
    canonSettings: {
        canonEnabled: true,
        refreshCanonOnChatLoad: true,
        includeCanonInMemoryBlock: true,
        maxCanonChars: 600,
    },
    userReplySettings: structuredClone(DEFAULT_USER_REPLY_MEMORY_SETTINGS),
    memoryDebug: {
        currentState: null,
        canonSnapshot: null,
        lastInjectedMemoryBlock: '',
        lastUpdatedTimestamp: '',
        lastSourceSceneId: '',
        lastParserWarning: '',
        storageUsage: null,
    },
    filters: {
        content: '',
        action_group: '',
        action: '',
        pose: '',
        exposure: '',
        contact: '',
        attire: '',
        setting: '',
        age: '',
        consent: '',
        risk: '',
        search: '',
    },
};
const getLlmSettings = () => extension_settings[extensionName]?.llmAnalysis || {};
const getMemorySettings = () => extension_settings[extensionName]?.continuityMemory || {};
const BUILT_IN_PREFIX_PATHS = [
    ['sd', 'common_prefix'],
    ['sd', 'prompt_prefix'],
    ['sd', 'positive_prefix'],
    ['sd', 'prompts', 'common_prefix'],
    ['sd', 'prompts', 'prompt_prefix'],
    ['image_generation', 'common_prefix'],
    ['image_generation', 'prompt_prefix'],
    ['imageGeneration', 'common_prefix'],
    ['imageGeneration', 'prompt_prefix'],
    ['comfy', 'common_prefix'],
    ['comfy', 'prompt_prefix'],
];

function getNestedStringValue(root, path) {
    let current = root;

    for (const segment of path) {
        if (!current || typeof current !== 'object') {
            return '';
        }
        current = current[segment];
    }

    return typeof current === 'string' ? current.trim() : '';
}

function resolveCommonPromptPrefix() {
    for (const path of BUILT_IN_PREFIX_PATHS) {
        const value = getNestedStringValue(extension_settings, path);
        if (value) {
            return {
                value,
                source: `built_in:${path.join('.')}`,
            };
        }
    }

    const localValue = typeof extension_settings[extensionName]?.commonPromptPrefix === 'string'
        ? extension_settings[extensionName].commonPromptPrefix.trim()
        : '';

    return {
        value: localValue,
        source: localValue ? 'local_override' : 'none',
    };
}

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
    const commonPromptPrefix = resolveCommonPromptPrefix();

    return buildPromptFromPhraseItems(
        extension_settings[extensionName]?.promptPhrases,
        sceneTags,
        commonPromptPrefix.value,
    );
}

function getChatIdentity(context) {
    return {
        chatId: String(
            context.chatId ||
            context.groupId ||
            context.characterId ||
            context.name2 ||
            'current-chat',
        ),
        characterId: String(
            context.characterId ||
            context.name2 ||
            context.groupId ||
            'current-character',
        ),
    };
}

function formatMessageForSceneTagging(message) {
    const role = message?.is_user ? 'User' : 'Assistant';
    const text = preprocessForClassifierInput(preprocessForImagePrompt(message?.mes || ''));
    return `${role}: ${text}`;
}

function buildSourceTextFromRange(chat, startIndex, endIndex) {
    return (chat || [])
        .slice(startIndex, endIndex + 1)
        .map(formatMessageForSceneTagging)
        .filter(Boolean)
        .join('\n\n');
}

function getSelectedMessageRange() {
    const selectedIds = $('.mes.selected').map(function () {
        const raw = $(this).attr('mesid');
        return Number(raw);
    }).get().filter(Number.isFinite);

    if (!selectedIds.length) {
        return null;
    }

    return {
        start: Math.min(...selectedIds),
        end: Math.max(...selectedIds),
    };
}

function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function deriveSceneFiltersForSearch() {
    return {
        content: sceneTaggerState.filters.content,
        action_group: sceneTaggerState.filters.action_group,
        action: sceneTaggerState.filters.action,
        pose: sceneTaggerState.filters.pose,
        exposure: sceneTaggerState.filters.exposure,
        contact: sceneTaggerState.filters.contact,
        attire: sceneTaggerState.filters.attire,
        setting: sceneTaggerState.filters.setting,
    };
}

function deriveSafetyFiltersForSearch() {
    return {
        age: sceneTaggerState.filters.age,
        consent: sceneTaggerState.filters.consent,
        risk: sceneTaggerState.filters.risk,
    };
}

async function refreshSceneTaggerRecords() {
    const scenes = await getAllScenes();
    let filteredScenes = filterScenes(scenes, deriveSceneFiltersForSearch());
    filteredScenes = filterBySafety(filteredScenes, deriveSafetyFiltersForSearch());
    filteredScenes = rawSearch(filteredScenes, sceneTaggerState.filters.search);
    filteredScenes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    sceneTaggerState.scenes = scenes;
    sceneTaggerState.filteredScenes = filteredScenes;

    if (sceneTaggerUi) {
        sceneTaggerUi.refresh(sceneTaggerState);
    }

    await refreshMemoryDebugState().catch(() => { });
}

function setSceneTaggerStatus(status) {
    sceneTaggerState.status = status;
    if (sceneTaggerUi) {
        sceneTaggerUi.refresh(sceneTaggerState);
    }
}

function syncSceneTaggerUiSettings() {
    sceneTaggerState.sceneTaggerSettings = structuredClone(extension_settings[extensionName]?.sceneTagger || defaultSettings.sceneTagger);
    sceneTaggerState.memorySettings = structuredClone(extension_settings[extensionName]?.continuityMemory || defaultSettings.continuityMemory);
    sceneTaggerState.canonSettings = structuredClone(extension_settings[extensionName]?.canon || defaultSettings.canon);
    sceneTaggerState.userReplySettings = structuredClone(extension_settings[extensionName]?.userReplyMemory || defaultSettings.userReplyMemory);
}

async function refreshMemoryDebugState(context = getContext()) {
    try {
        const { chatId } = getChatIdentity(context);
        sceneTaggerState.memoryDebug.currentState = await getCurrentState(chatId);
        sceneTaggerState.memoryDebug.canonSnapshot = await getCanonSnapshot(chatId);
        sceneTaggerState.memoryDebug.storageUsage = await getStorageUsage().catch(() => null);
        sceneTaggerState.memoryDebug.lastUpdatedTimestamp = sceneTaggerState.memoryDebug.currentState?.updated_at || '';
        sceneTaggerState.memoryDebug.lastSourceSceneId = sceneTaggerState.memoryDebug.currentState?.last_source_scene_id || '';
    } catch (error) {
        sceneTaggerState.memoryDebug.lastParserWarning = String(error?.message || error || 'memory refresh failed');
    }

    if (sceneTaggerUi) {
        sceneTaggerUi.refresh(sceneTaggerState);
    }
}

async function refreshCanonSnapshotForCurrentChat(context = getContext(), force = false) {
    const { chatId, characterId } = getChatIdentity(context);
    const canonSettings = extension_settings[extensionName]?.canon || defaultSettings.canon;

    if (!canonSettings.canonEnabled) {
        return null;
    }

    const existing = await getCanonSnapshot(chatId);
    if (existing && !force && canonSettings.refreshCanonOnChatLoad !== true) {
        return existing;
    }

    const baseline = buildCanonSnapshotFromContext(context);
    const setupFields = {
        character_name: baseline.character_name,
        user_persona: baseline.user_persona,
        scenario: baseline.scenario,
        character: Array.isArray(context.characters) && Number.isInteger(context.characterId)
            ? context.characters[context.characterId]
            : null,
    };

    let parsed = null;
    try {
        const result = await callChat(
            [
                {
                    role: 'system',
                    content: 'You extract compact canon snapshots. Return only the requested labeled fields.',
                },
                {
                    role: 'user',
                    content: buildCanonSnapshotPrompt(setupFields),
                },
            ],
            {
                max_tokens: 180,
                temperature: 0.1,
            },
        );

        parsed = parseCanonSnapshotOutput(result);
    } catch (error) {
        console.warn(`[${extensionName}] canon snapshot extraction failed, using baseline context fallback`, error);
    }

    const snapshot = {
        ...DEFAULT_CANON_SNAPSHOT,
        ...baseline,
        ...(existing || {}),
        ...(parsed || {}),
        chat_id: chatId,
        character_id: characterId,
        updated_at: new Date().toISOString(),
        created_at: existing?.created_at || baseline.created_at || new Date().toISOString(),
    };

    await saveCanonSnapshot(chatId, snapshot);
    sceneTaggerState.memoryDebug.canonSnapshot = snapshot;
    await refreshMemoryDebugState(context).catch(() => { });
    return snapshot;
}

async function buildInjectedMemoryBlockForCurrentChat(trigger = 'normal') {
    const context = getContext();
    const memorySettings = getMemorySettings();
    const canonSettings = extension_settings[extensionName]?.canon || defaultSettings.canon;
    const { chatId } = getChatIdentity(context);

    if (!memorySettings.memoryEnabled || memorySettings.memoryMode === 'off') {
        sceneTaggerState.memoryDebug.lastInjectedMemoryBlock = '';
        return '';
    }

    const latestUserMessage = [...(context.chat || [])].reverse().find(message => message?.is_user)?.mes || '';
    const memoryContext = await getMemoryContextForChat(chatId, latestUserMessage, {
        recentSceneLimit: 5,
        relevantSceneLimit: 3,
        summaryLimit: 1,
    });

    const currentState = memoryContext.currentState;
    const canonSnapshot = await getCanonSnapshot(chatId);
    if (!currentState || !currentState.chat_id) {
        sceneTaggerState.memoryDebug.lastParserWarning = 'No valid current_state available for injection.';
        sceneTaggerState.memoryDebug.lastInjectedMemoryBlock = '';
        return '';
    }

    const canonBlock = buildCanonMemoryBlock(canonSnapshot, {
        ...canonSettings,
        maxCanonChars: canonSettings.maxCanonChars,
    });

    const memoryBlock = buildContinuityMemoryBlock(currentState, {
        memoryEnabled: memorySettings.memoryEnabled,
        memoryMode: memorySettings.memoryMode,
        maxMemoryChars: memorySettings.maxMemoryChars,
        includeRecentEvents: memorySettings.includeRecentEvents,
        includeOpenThreads: memorySettings.includeOpenThreads,
        showUserCorrectionsInPrompt: extension_settings[extensionName]?.userReplyMemory?.showUserCorrectionsInPrompt !== false,
    });

    const combinedBlock = [canonBlock, memoryBlock].filter(Boolean).join('\n\n');

    sceneTaggerState.memoryDebug.currentState = currentState;
    sceneTaggerState.memoryDebug.canonSnapshot = canonSnapshot;
    sceneTaggerState.memoryDebug.lastInjectedMemoryBlock = combinedBlock;
    sceneTaggerState.memoryDebug.lastUpdatedTimestamp = currentState.updated_at || '';
    sceneTaggerState.memoryDebug.lastSourceSceneId = currentState.last_source_scene_id || '';
    sceneTaggerState.memoryDebug.lastParserWarning = combinedBlock ? '' : 'Memory injection skipped because the built block was empty.';

    console.log(`[${extensionName}] continuity memory block built`, {
        trigger,
        chatId,
        memoryMode: memorySettings.memoryMode,
        canonBlock,
        memoryBlock,
        combinedBlock,
    });

    return combinedBlock;
}

async function persistSceneRecord(sceneRecord, currentState = null) {
    await saveScene(sceneRecord);

    const memoryEvent = sceneRecord.continuity_memory
        ? {
            memory_id: crypto.randomUUID(),
            scene_id: sceneRecord.scene_id,
            chat_id: sceneRecord.chat_id,
            message_start: sceneRecord.message_start,
            message_end: sceneRecord.message_end,
            scene_summary: sceneRecord.continuity_memory.scene_summary || 'unknown',
            current_location: sceneRecord.continuity_memory.location || 'unknown',
            continuity_facts: sceneRecord.continuity_memory.continuity_facts || [],
            open_threads: sceneRecord.continuity_memory.open_threads || [],
            importance: sceneRecord.normalized_tags?.content === 'explicit' ? 'high' : 'medium',
            recency_score: 1.0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }
        : null;

    if (memoryEvent) {
        await saveMemoryEvent(memoryEvent);
    }

    const nextCurrentState = applyContinuityMemoryToCurrentState(
        currentState || DEFAULT_CURRENT_STATE,
        sceneRecord.continuity_memory,
        sceneRecord.scene_id,
        sceneRecord.normalized_tags,
    );
    nextCurrentState.chat_id = sceneRecord.chat_id;
    await saveCurrentState(sceneRecord.chat_id, nextCurrentState);

    await compactChatScenes(sceneRecord.chat_id, extension_settings[extensionName]?.retention || {});
    await archiveOldScenes(sceneRecord.chat_id, extension_settings[extensionName]?.retention || {});

    const storageUsage = await getStorageUsage().catch(() => null);
    sceneTaggerState.memoryDebug.storageUsage = storageUsage;
    sceneTaggerState.memoryDebug.currentState = nextCurrentState;
    sceneTaggerState.memoryDebug.lastUpdatedTimestamp = nextCurrentState.updated_at || '';
    sceneTaggerState.memoryDebug.lastSourceSceneId = nextCurrentState.last_source_scene_id || '';

    const hardStopPercent = extension_settings[extensionName]?.retention?.hardStopStoragePercent ?? 90;
    const warnPercent = extension_settings[extensionName]?.retention?.warnStoragePercent ?? 70;

    if (storageUsage?.percentUsed >= hardStopPercent) {
        setSceneTaggerStatus(`Storage near quota (${storageUsage.percentUsed}%). Automatic tagging paused soon unless cleaned up.`);
    } else if (storageUsage?.percentUsed >= warnPercent) {
        setSceneTaggerStatus(`Storage warning: ${storageUsage.percentUsed}% of browser storage is in use.`);
    }

    return {
        memoryEvent,
        currentState: nextCurrentState,
    };
}

const defaultSettings = {
    insertType: INSERT_TYPE.DISABLED,
    commonPromptPrefix: '',
    promptPhrases: [],
    sceneTagger: {
        autoSaveGeneratedScenes: true,
        sanitizeCharacterOutput: true,
        dataMaintenanceEnabled: true,
        dataMaintenanceEveryMessages: 5,
    },
    continuityMemory: {
        ...DEFAULT_MEMORY_SETTINGS,
        showUserCorrectionsInPrompt: true,
    },
    canon: {
        canonEnabled: true,
        refreshCanonOnChatLoad: true,
        includeCanonInMemoryBlock: true,
        maxCanonChars: 600,
    },
    userReplyMemory: {
        ...DEFAULT_USER_REPLY_MEMORY_SETTINGS,
    },
    retention: {
        maxScenesPerChat: 1000,
        compactEveryScenes: 50,
        maxRecentEvents: 5,
        maxContinuityFacts: 30,
        maxOpenThreads: 10,
        archiveAfterScenes: 200,
        deleteArchivedSourceText: false,
        warnStoragePercent: 70,
        hardStopStoragePercent: 90,
    },
    llmAnalysis: {
        enabled: true,
        backend: 'kobold',
        endpoint: '',
        apiKey: '',
        model: '',
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
        $('#common_prompt_prefix').val(
            extension_settings[extensionName].commonPromptPrefix,
        );

        $('#llm_analysis_enabled').prop(
            'checked',
            extension_settings[extensionName].llmAnalysis.enabled,
        );
        $('#llm_analysis_backend').val(
            extension_settings[extensionName].llmAnalysis.backend,
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
        $('#llm_analysis_cooldown_enabled').prop(
            'checked',
            extension_settings[extensionName].llmAnalysis.cooldown?.enabled === true,
        );
        $('#llm_analysis_cooldown_messages').val(
            extension_settings[extensionName].llmAnalysis.cooldown?.messages,
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

        if (typeof extension_settings[extensionName].commonPromptPrefix !== 'string') {
            extension_settings[extensionName].commonPromptPrefix = defaultSettings.commonPromptPrefix;
        }

        if (!extension_settings[extensionName].sceneTagger) {
            extension_settings[extensionName].sceneTagger = structuredClone(defaultSettings.sceneTagger);
        } else {
            for (const key in defaultSettings.sceneTagger) {
                if (extension_settings[extensionName].sceneTagger[key] === undefined) {
                    extension_settings[extensionName].sceneTagger[key] = structuredClone(defaultSettings.sceneTagger[key]);
                }
            }
        }

        if (!extension_settings[extensionName].continuityMemory) {
            extension_settings[extensionName].continuityMemory = structuredClone(defaultSettings.continuityMemory);
        } else {
            for (const key in defaultSettings.continuityMemory) {
                if (extension_settings[extensionName].continuityMemory[key] === undefined) {
                    extension_settings[extensionName].continuityMemory[key] = structuredClone(defaultSettings.continuityMemory[key]);
                }
            }
        }

        if (!extension_settings[extensionName].retention) {
            extension_settings[extensionName].retention = structuredClone(defaultSettings.retention);
        } else {
            for (const key in defaultSettings.retention) {
                if (extension_settings[extensionName].retention[key] === undefined) {
                    extension_settings[extensionName].retention[key] = structuredClone(defaultSettings.retention[key]);
                }
            }
        }

        if (!extension_settings[extensionName].canon) {
            extension_settings[extensionName].canon = structuredClone(defaultSettings.canon);
        } else {
            for (const key in defaultSettings.canon) {
                if (extension_settings[extensionName].canon[key] === undefined) {
                    extension_settings[extensionName].canon[key] = structuredClone(defaultSettings.canon[key]);
                }
            }
        }

        if (!extension_settings[extensionName].userReplyMemory) {
            extension_settings[extensionName].userReplyMemory = structuredClone(defaultSettings.userReplyMemory);
        } else {
            for (const key in defaultSettings.userReplyMemory) {
                if (extension_settings[extensionName].userReplyMemory[key] === undefined) {
                    extension_settings[extensionName].userReplyMemory[key] = structuredClone(defaultSettings.userReplyMemory[key]);
                }
            }
        }

        extension_settings[extensionName].promptPhrases = normalizePromptPhrases(
            extension_settings[extensionName].promptPhrases,
        );
    }

    updateUI();
    syncSceneTaggerUiSettings();
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

    $('#common_prompt_prefix').on('input', function () {
        extension_settings[extensionName].commonPromptPrefix = String($(this).val() || '');
        saveSettingsDebounced();
    });

    $('#llm_analysis_enabled').on('change', function () {
        extension_settings[extensionName].llmAnalysis.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#llm_analysis_backend').on('change', function () {
        extension_settings[extensionName].llmAnalysis.backend = $(this).val();
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

    $('#llm_analysis_cooldown_enabled').on('change', function () {
        extension_settings[extensionName].llmAnalysis.cooldown.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#llm_analysis_cooldown_messages').on('input', function () {
        const rawValue = Number($(this).val());
        extension_settings[extensionName].llmAnalysis.cooldown.messages = Number.isFinite(rawValue)
            ? Math.max(0, Math.floor(rawValue))
            : 0;
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

    sceneTaggerUi = createSceneTaggerUi({
        rootSelector: '#scene_tagger_ui_mount',
        state: sceneTaggerState,
        onTagCurrentChat: handleTagCurrentChat,
        onTagSelectedMessages: handleTagSelectedMessages,
        onReprocessScene: handleReprocessScene,
        onExportJson: handleExportScenes,
        onExportCurrentChatJson: handleExportCurrentChatScenes,
        onImportJson: handleImportScenes,
        onClearDatabase: handleClearSceneDatabase,
        onCompactCurrentChat: handleCompactCurrentChat,
        onArchiveOldScenes: handleArchiveOldScenes,
        onDeleteArchivedSourceText: handleDeleteArchivedSourceText,
        onDeleteScene: handleDeleteScene,
        onEditScene: handleEditScene,
        onViewSource: handleViewSceneSource,
        onFiltersChanged: handleSceneFiltersChanged,
        onSceneTaggerSettingsChanged: handleSceneTaggerSettingsChanged,
        onMemorySettingsChanged: handleMemorySettingsChanged,
        onClearCurrentChatMemory: handleClearCurrentChatMemory,
        onClearAllMemory: handleClearAllMemory,
        onRefreshCanonSnapshot: handleRefreshCanonSnapshot,
        onViewCanonSnapshot: handleViewCanonSnapshot,
        onClearCanonSnapshot: handleClearCanonSnapshot,
        onCanonSettingsChanged: handleCanonSettingsChanged,
        onUserReplySettingsChanged: handleUserReplySettingsChanged,
        onClearUserCorrections: handleClearUserCorrections,
        onRequestPersistentStorage: handleRequestPersistentStorage,
        onShowStorageUsage: handleShowStorageUsage,
    });

    updateUI();
    renderPromptPhraseItems();
    sceneTaggerUi.refresh(sceneTaggerState);
    await refreshSceneTaggerRecords();
    await refreshMemoryDebugState();
}

async function tagMessageRange(startIndex, endIndex, existingSceneId = '') {
    const context = getContext();
    const chat = context.chat || [];

    if (!chat.length) {
        throw new Error('No chat messages available.');
    }

    const clampedStart = Math.max(0, Math.min(startIndex, chat.length - 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endIndex, chat.length - 1));
    const { chatId, characterId } = getChatIdentity(context);
    const sourceText = buildSourceTextFromRange(chat, clampedStart, clampedEnd);
    const currentState = await getCurrentState(chatId);

    const sceneEval = await classifyReplyForImage(context, {
        chatId,
        characterId,
        messageStart: clampedStart,
        messageEnd: clampedEnd,
        sourceText,
        currentState,
    });

    if (!sceneEval?.sceneRecord) {
        throw new Error('Scene tagging did not return a scene record.');
    }

    const sceneRecord = {
        ...sceneEval.sceneRecord,
        scene_id: existingSceneId || sceneEval.sceneRecord.scene_id,
        updated_at: new Date().toISOString(),
    };

    if (existingSceneId) {
        const existingScene = sceneTaggerState.scenes.find(scene => scene.scene_id === existingSceneId);
        if (existingScene?.created_at) {
            sceneRecord.created_at = existingScene.created_at;
        }
    }

    await persistSceneRecord(sceneRecord, currentState);
    await refreshSceneTaggerRecords();
    sceneTaggerState.selectedSceneId = sceneRecord.scene_id;
    return sceneRecord;
}

async function handleTagCurrentChat() {
    try {
        setSceneTaggerStatus('Tagging current chat...');
        const context = getContext();
        await tagMessageRange(0, Math.max(0, (context.chat || []).length - 1));
        setSceneTaggerStatus('Tagged current chat.');
        toastr.success('Tagged current chat');
    } catch (error) {
        setSceneTaggerStatus('Tagging current chat failed.');
        toastr.error(`Scene tagging failed: ${error.message || error}`);
    }
}

async function handleTagSelectedMessages() {
    try {
        const range = getSelectedMessageRange();
        if (!range) {
            toastr.warning('Select one or more messages first.');
            return;
        }

        setSceneTaggerStatus(`Tagging messages ${range.start}-${range.end}...`);
        await tagMessageRange(range.start, range.end);
        setSceneTaggerStatus(`Tagged messages ${range.start}-${range.end}.`);
        toastr.success('Tagged selected messages');
    } catch (error) {
        setSceneTaggerStatus('Selected-message tagging failed.');
        toastr.error(`Scene tagging failed: ${error.message || error}`);
    }
}

async function handleReprocessScene(sceneId = '') {
    try {
        const targetSceneId = sceneId || sceneTaggerState.selectedSceneId;
        const scene = sceneTaggerState.scenes.find(item => item.scene_id === targetSceneId);
        if (!scene) {
            toastr.warning('Choose a scene to reprocess first.');
            return;
        }

        setSceneTaggerStatus(`Reprocessing scene ${scene.scene_id}...`);
        await tagMessageRange(scene.message_start, scene.message_end, scene.scene_id);
        setSceneTaggerStatus(`Reprocessed scene ${scene.scene_id}.`);
        toastr.success('Scene reprocessed');
    } catch (error) {
        setSceneTaggerStatus('Scene reprocessing failed.');
        toastr.error(`Scene reprocessing failed: ${error.message || error}`);
    }
}

async function handleExportScenes() {
    try {
        setSceneTaggerStatus('Exporting scene records...');
        const payload = await exportScenes();
        downloadJson(`st-scene-tagger-export-${Date.now()}.json`, payload);
        setSceneTaggerStatus('Exported scene records.');
        toastr.success('Scene records exported');
    } catch (error) {
        setSceneTaggerStatus('Scene export failed.');
        toastr.error(`Scene export failed: ${error.message || error}`);
    }
}

async function handleExportCurrentChatScenes() {
    try {
        const context = getContext();
        const { chatId } = getChatIdentity(context);
        setSceneTaggerStatus('Exporting current chat scene records...');
        const payload = await exportScenes({ chatId });
        downloadJson(`st-scene-tagger-${chatId}-${Date.now()}.json`, payload);
        setSceneTaggerStatus('Exported current chat scene records.');
        toastr.success('Current chat scene records exported');
    } catch (error) {
        setSceneTaggerStatus('Current chat export failed.');
        toastr.error(`Scene export failed: ${error.message || error}`);
    }
}

async function handleImportScenes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        try {
            setSceneTaggerStatus(`Importing ${file.name}...`);
            const text = await file.text();
            const payload = JSON.parse(text);
            await importScenes(payload);
            await refreshSceneTaggerRecords();
            setSceneTaggerStatus(`Imported ${file.name}.`);
            toastr.success('Scene records imported');
        } catch (error) {
            setSceneTaggerStatus('Scene import failed.');
            toastr.error(`Scene import failed: ${error.message || error}`);
        }
    };

    input.click();
}

async function handleClearSceneDatabase() {
    if (!window.confirm('Clear all local scene tagger data?')) {
        return;
    }

    try {
        setSceneTaggerStatus('Clearing local scene database...');
        await clearScenes();
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus('Cleared local scene database.');
        toastr.success('Local scene database cleared');
    } catch (error) {
        setSceneTaggerStatus('Clearing local scene database failed.');
        toastr.error(`Clear failed: ${error.message || error}`);
    }
}

async function handleCompactCurrentChat() {
    try {
        const context = getContext();
        const { chatId } = getChatIdentity(context);
        await compactChatScenes(chatId, extension_settings[extensionName]?.retention || {});
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus('Compacted current chat scenes.');
        toastr.success('Current chat compacted');
    } catch (error) {
        toastr.error(`Compact failed: ${error.message || error}`);
    }
}

async function handleArchiveOldScenes() {
    try {
        const context = getContext();
        const { chatId } = getChatIdentity(context);
        const count = await archiveOldScenes(chatId, extension_settings[extensionName]?.retention || {});
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus(`Archived ${count} old scenes.`);
        toastr.success(`Archived ${count} old scenes`);
    } catch (error) {
        toastr.error(`Archive failed: ${error.message || error}`);
    }
}

async function handleDeleteArchivedSourceText() {
    if (!window.confirm('Delete source text from archived scenes for the current chat?')) {
        return;
    }

    try {
        const context = getContext();
        const { chatId } = getChatIdentity(context);
        const count = await cleanupArchivedSourceText(chatId);
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus(`Deleted source text from ${count} archived scenes.`);
        toastr.success(`Archived source text deleted for ${count} scenes`);
    } catch (error) {
        toastr.error(`Archived source cleanup failed: ${error.message || error}`);
    }
}

async function handleDeleteScene(sceneId) {
    if (!sceneId) {
        return;
    }

    if (!window.confirm('Delete this scene record?')) {
        return;
    }

    try {
        await deleteScene(sceneId);
        if (sceneTaggerState.selectedSceneId === sceneId) {
            sceneTaggerState.selectedSceneId = '';
        }
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus('Deleted scene record.');
        toastr.success('Scene record deleted');
    } catch (error) {
        setSceneTaggerStatus('Delete failed.');
        toastr.error(`Delete failed: ${error.message || error}`);
    }
}

function handleViewSceneSource(sceneId) {
    const scene = sceneTaggerState.scenes.find(item => item.scene_id === sceneId);
    if (!scene) {
        return;
    }

    sceneTaggerState.selectedSceneId = sceneId;
    window.alert(scene.source_text || '(empty source text)');
}

async function handleEditScene(sceneId) {
    const scene = sceneTaggerState.scenes.find(item => item.scene_id === sceneId);
    if (!scene) {
        return;
    }

    sceneTaggerState.selectedSceneId = sceneId;
    const updatedJson = window.prompt(
        'Edit the scene record JSON and submit the full object:',
        JSON.stringify(scene, null, 2),
    );

    if (!updatedJson) {
        return;
    }

    try {
        const updatedScene = JSON.parse(updatedJson);
        await saveScene(updatedScene);
        await refreshSceneTaggerRecords();
        setSceneTaggerStatus(`Saved edits for ${sceneId}.`);
        toastr.success('Scene record updated');
    } catch (error) {
        toastr.error(`Edit failed: ${error.message || error}`);
    }
}

function handleSceneFiltersChanged(controlId, value) {
    const map = {
        scene_filter_content: 'content',
        scene_filter_action_group: 'action_group',
        scene_filter_action: 'action',
        scene_filter_pose: 'pose',
        scene_filter_exposure: 'exposure',
        scene_filter_contact: 'contact',
        scene_filter_attire: 'attire',
        scene_filter_setting: 'setting',
        scene_filter_age: 'age',
        scene_filter_consent: 'consent',
        scene_filter_risk: 'risk',
        scene_filter_search: 'search',
    };

    const filterKey = map[controlId];
    if (!filterKey) {
        return;
    }

    sceneTaggerState.filters[filterKey] = value;
    refreshSceneTaggerRecords().catch(error => {
        console.error(`[${extensionName}] failed to refresh scene filters`, error);
    });
}

function handleMemorySettingsChanged(key, value) {
    extension_settings[extensionName].continuityMemory[key] = value;
    syncSceneTaggerUiSettings();
    saveSettingsDebounced();
    refreshMemoryDebugState().catch(() => { });
}

function handleCanonSettingsChanged(key, value) {
    extension_settings[extensionName].canon[key] = value;
    syncSceneTaggerUiSettings();
    saveSettingsDebounced();
    refreshMemoryDebugState().catch(() => { });
}

function handleUserReplySettingsChanged(key, value) {
    extension_settings[extensionName].userReplyMemory[key] = value;
    syncSceneTaggerUiSettings();
    saveSettingsDebounced();
    refreshMemoryDebugState().catch(() => { });
}

function handleSceneTaggerSettingsChanged(key, value) {
    extension_settings[extensionName].sceneTagger[key] = value;
    syncSceneTaggerUiSettings();
    saveSettingsDebounced();
}

async function handleClearCurrentChatMemory() {
    const context = getContext();
    const { chatId } = getChatIdentity(context);

    if (!window.confirm('Clear continuity memory for the current chat?')) {
        return;
    }

    await clearCurrentState(chatId);
    await refreshMemoryDebugState(context);
    setSceneTaggerStatus('Cleared current chat memory.');
}

async function handleClearAllMemory() {
    if (!window.confirm('Clear all continuity memory records?')) {
        return;
    }

    await clearAllCurrentStates();
    sceneTaggerState.memoryDebug.currentState = null;
    sceneTaggerState.memoryDebug.lastInjectedMemoryBlock = '';
    await refreshMemoryDebugState();
    setSceneTaggerStatus('Cleared all continuity memory.');
}

async function handleRefreshCanonSnapshot() {
    try {
        setSceneTaggerStatus('Refreshing canon snapshot...');
        await refreshCanonSnapshotForCurrentChat(getContext(), true);
        setSceneTaggerStatus('Canon snapshot refreshed.');
        toastr.success('Canon snapshot refreshed');
    } catch (error) {
        setSceneTaggerStatus('Canon snapshot refresh failed.');
        toastr.error(`Canon refresh failed: ${error.message || error}`);
    }
}

async function handleViewCanonSnapshot() {
    try {
        const context = getContext();
        const { chatId } = getChatIdentity(context);
        const snapshot = await getCanonSnapshot(chatId);
        window.alert(JSON.stringify(snapshot || null, null, 2));
        await refreshMemoryDebugState(context);
    } catch (error) {
        toastr.error(`Canon snapshot view failed: ${error.message || error}`);
    }
}

async function handleClearCanonSnapshot() {
    const context = getContext();
    const { chatId } = getChatIdentity(context);

    if (!window.confirm('Clear the canon snapshot for the current chat?')) {
        return;
    }

    try {
        await clearCanonSnapshot(chatId);
        await refreshMemoryDebugState(context);
        setSceneTaggerStatus('Cleared current chat canon snapshot.');
        toastr.success('Canon snapshot cleared');
    } catch (error) {
        setSceneTaggerStatus('Clearing canon snapshot failed.');
        toastr.error(`Canon snapshot clear failed: ${error.message || error}`);
    }
}

async function handleClearUserCorrections() {
    const context = getContext();
    const { chatId } = getChatIdentity(context);

    if (!window.confirm('Clear user corrections, assertions, and temporary guidance for the current chat?')) {
        return;
    }

    try {
        const currentState = (await getCurrentState(chatId)) || { ...DEFAULT_CURRENT_STATE, chat_id: chatId };
        const nextState = {
            ...currentState,
            user_assertions: [],
            corrections: [],
            temporary_guidance: [],
            updated_at: new Date().toISOString(),
        };
        await saveCurrentState(chatId, nextState);
        sceneTaggerState.memoryDebug.currentState = nextState;
        await refreshMemoryDebugState(context);
        setSceneTaggerStatus('Cleared user corrections for the current chat.');
        toastr.success('User corrections cleared');
    } catch (error) {
        setSceneTaggerStatus('Clearing user corrections failed.');
        toastr.error(`User correction clear failed: ${error.message || error}`);
    }
}

async function handleRequestPersistentStorage() {
    const granted = await requestPersistentStorage();
    setSceneTaggerStatus(granted ? 'Persistent browser storage granted.' : 'Persistent browser storage was not granted.');
    await refreshMemoryDebugState();
}

async function handleShowStorageUsage() {
    const usage = await getStorageUsage();
    sceneTaggerState.memoryDebug.storageUsage = usage;
    if (usage?.percentUsed != null) {
        setSceneTaggerStatus(`Storage usage: ${usage.percentUsed}% of browser quota.`);
    } else {
        setSceneTaggerStatus('Storage usage is unavailable in this browser.');
    }
    if (sceneTaggerUi) {
        sceneTaggerUi.refresh(sceneTaggerState);
    }
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
        await initDb();

        $('#extensionsMenu').append(`<div id="auto_generation" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-robot"></div>
            <span data-i18n="Image Auto Generation">Image Auto Generation</span>
        </div>`);

        $('#auto_generation').off('click').on('click', onExtensionButtonClick);

        await loadSettings();
        await createSettings(settingsHtml);
        await refreshCanonSnapshotForCurrentChat(getContext()).catch(error => {
            console.warn(`[${extensionName}] initial canon snapshot refresh failed`, error);
        });

        $('#extensions-settings-button').off('click.stImageAutoGeneration').on('click.stImageAutoGeneration', function () {
            setTimeout(() => {
                updateUI();
            }, 200);
        });
    })();
});

function getImageAnalysisTextContext(context) {
    const { latestAssistant, latestUser, previousAssistant } =
        getRecentContextForImageAnalysis(context);

    return {
        latestAssistant,
        latestUser,
        previousAssistant,
        assistantText: preprocessForClassifierInput(preprocessForImagePrompt(latestAssistant)),
        latestUserText: preprocessForClassifierInput(preprocessForImagePrompt(latestUser)),
        previousAssistantText: preprocessForClassifierInput(preprocessForImagePrompt(previousAssistant)),
    };
}

function hasConfiguredEndpoint(endpoint) {
    return typeof endpoint === 'string' && endpoint.trim().length > 0;
}

function canUseLlmPromptBuilder(settings) {
    return hasConfiguredEndpoint(settings?.endpoint);
}

function canUseLlmClassifier(settings) {
    if (settings?.enabled !== true) {
        return false;
    }

    if (settings.classifierUseSeparateBackend === true) {
        return hasConfiguredEndpoint(settings.classifierEndpoint || settings.endpoint);
    }

    return canUseLlmPromptBuilder(settings);
}

const callChat = createChatCaller({
    extensionName,
    getSettings: getLlmSettings,
});

const {
    classifyReplyForImage,
} = createAnalysisPipeline({
    extensionName,
    getSettings: getLlmSettings,
    getImageAnalysisTextContext,
    callChat,
});

registerPromptInjection(async ({ type }) => {
    const memoryBlock = await buildInjectedMemoryBlockForCurrentChat(type);
    if (!memoryBlock) {
        return null;
    }

    return {
        memoryBlock,
        position: getMemorySettings().injectPosition || 'before_latest_message',
    };
});

globalThis.stSceneTaggerGenerateInterceptor = runPromptInjection;

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

async function sanitizeLatestAssistantMessage(context, message, messageIndex) {
    if (extension_settings[extensionName]?.sceneTagger?.sanitizeCharacterOutput !== true) {
        return message;
    }

    if (!message || message.is_user || typeof message.mes !== 'string') {
        return message;
    }

    const originalText = message.mes;
    const result = sanitizeCharacterOutput(originalText);
    if (!result.changed) {
        return message;
    }

    message.mes = result.text;
    if (!message.extra) {
        message.extra = {};
    }
    message.extra.stSceneTaggerSanitizedOutput = {
        reasons: result.reasons,
        sanitized_at: new Date().toISOString(),
    };

    const messageElement = $(`.mes[mesid="${messageIndex}"]`);
    if (messageElement.length) {
        updateMessageBlock(messageIndex, message, { rerenderMessage: true });
    } else {
        console.warn(`[${extensionName}] skipped sanitized message rerender because DOM element was not ready`, {
            messageIndex,
        });
    }
    await context.saveChat?.();

    console.log(`[${extensionName}] sanitized character output`, {
        messageIndex,
        reasons: result.reasons,
        beforePreview: originalText.slice(0, 160),
        afterPreview: result.text.slice(0, 160),
    });

    return message;
}

async function maybeRunDataMaintenance(context, messageIndex) {
    const settings = extension_settings[extensionName]?.sceneTagger || {};
    if (settings.dataMaintenanceEnabled === false) {
        return;
    }

    const everyMessages = Math.max(1, Math.floor(Number(settings.dataMaintenanceEveryMessages || 5)));
    if (messageIndex < 0 || (messageIndex + 1) % everyMessages !== 0) {
        return;
    }

    if (isDataMaintenanceRunning) {
        return;
    }

    isDataMaintenanceRunning = true;
    try {
        const { chatId } = getChatIdentity(context);
        const result = await repairChatData(chatId, {
            repairSceneRecord,
            repairMemoryEvent,
            repairCurrentState,
        });

        if (result.scenes || result.memory_events || result.current_states) {
            await refreshSceneTaggerRecords().catch(() => { });
            await refreshMemoryDebugState(context).catch(() => { });
        }

        console.log(`[${extensionName}] data maintenance pass completed`, {
            chatId,
            messageIndex,
            everyMessages,
            result,
        });
    } catch (error) {
        console.warn(`[${extensionName}] data maintenance pass failed`, error);
    } finally {
        isDataMaintenanceRunning = false;
    }
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

    await maybeRunDataMaintenance(context, currentIndex);

    if (!message || message.is_user) {
        if (message?.is_user && extension_settings[extensionName]?.userReplyMemory?.userReplyMemoryEnabled !== false) {
            try {
                const currentState = await getCurrentState(getChatIdentity(context).chatId);
                const userMessageText = preprocessForImagePrompt(message?.mes || '');
                if (
                    userMessageText &&
                    (
                        extension_settings[extensionName]?.userReplyMemory?.detectCorrectionsWithRegex === true
                            ? detectUserCorrection(userMessageText)
                            : extension_settings[extensionName]?.userReplyMemory?.runLlmCorrectionExtractor === true
                    )
                ) {
                    let memory = null;

                    if (extension_settings[extensionName]?.userReplyMemory?.runLlmCorrectionExtractor !== false) {
                        const output = await callChat(
                            [
                                {
                                    role: 'system',
                                    content: 'You extract user correction and steering memory. Return only the requested labeled fields.',
                                },
                                {
                                    role: 'user',
                                    content: buildUserReplyMemoryPrompt(userMessageText, currentState),
                                },
                            ],
                            {
                                useClassifierBackend: getLlmSettings().classifierUseSeparateBackend === true,
                                max_tokens: getLlmSettings().classifierMaxTokens ?? 80,
                                temperature: Math.min(getLlmSettings().classifierTemperature ?? 0.1, 0.1),
                            },
                        );

                        memory = parseUserReplyMemoryOutput(output);
                    } else {
                        memory = {
                            correction: 'yes',
                            state_changes: [],
                            location: 'unknown',
                            user_state: [],
                            character_state: [],
                            temporary_guidance: [],
                            new_facts: [],
                        };
                    }

                    const nextState = applyUserReplyMemoryToCurrentState(
                        currentState || { ...DEFAULT_CURRENT_STATE, chat_id: getChatIdentity(context).chatId },
                        memory,
                        extension_settings[extensionName]?.userReplyMemory || defaultSettings.userReplyMemory,
                    );
                    nextState.chat_id = getChatIdentity(context).chatId;
                    await saveCurrentState(nextState.chat_id, nextState);
                    sceneTaggerState.memoryDebug.currentState = nextState;
                    sceneTaggerState.memoryDebug.lastParserWarning = '';

                    console.log(`[${extensionName}] applied user reply memory`, {
                        userMessageText,
                        memory,
                        nextState,
                    });
                }
            } catch (error) {
                sceneTaggerState.memoryDebug.lastParserWarning = `user reply memory failed: ${error?.message || error}`;
                console.warn(`[${extensionName}] user reply memory extraction failed`, error);
            }
        }

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

    message = await sanitizeLatestAssistantMessage(context, message, currentIndex);

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

    const llmSettings = extension_settings[extensionName]?.llmAnalysis || {};
    const canUsePromptBuilder = canUseLlmPromptBuilder(llmSettings);
    const canUseClassifier = canUseLlmClassifier(llmSettings);
    const {
        latestUserText: userText,
        assistantText,
    } = getImageAnalysisTextContext(context);
    const explicitPhotoRequest = PHOTO_REQUEST_REGEX.test(userText);
    const fallbackSceneTags = buildFallbackSceneTags(assistantText);

    let sceneEval = {
        generate: false,
        category: 'dialogue_only',
        weight: 0,
    };
    let continuityStateForImage = null;

    if (!llmSettings.enabled) {
        sceneEval = {
            generate: Boolean(fallbackSceneTags),
            category: explicitPhotoRequest ? 'explicit_request' : 'fallback_reply',
            weight: 1,
        };
        console.log(`[${extensionName}] LLM analysis disabled, using reply text fallback`, {
            currentIndex,
            explicitPhotoRequest,
            fallbackSceneTags,
        });
    } else if (!canUseClassifier && !canUsePromptBuilder) {
        sceneEval = {
            generate: Boolean(fallbackSceneTags),
            category: explicitPhotoRequest ? 'explicit_request' : 'fallback_reply',
            weight: 1,
        };
        console.warn(`[${extensionName}] missing LLM endpoints, using reply text fallback`, {
            currentIndex,
            explicitPhotoRequest,
            fallbackSceneTags,
        });
    } else {
        try {
            isImageAnalysisCall = true;
            const { chatId, characterId } = getChatIdentity(context);
            const currentState = await getCurrentState(chatId);
            continuityStateForImage = currentState;

            if (canUseClassifier) {
                sceneEval = await classifyReplyForImage(context, {
                    chatId,
                    characterId,
                    messageStart: Math.max(0, currentIndex - 1),
                    messageEnd: currentIndex,
                    sourceText: buildSourceTextFromRange(context.chat || [], Math.max(0, currentIndex - 1), currentIndex),
                    currentState,
                });
            }

            if (
                canUseClassifier &&
                extension_settings[extensionName]?.sceneTagger?.autoSaveGeneratedScenes !== false &&
                sceneEval?.sceneRecord
            ) {
                const persisted = await persistSceneRecord(sceneEval.sceneRecord, currentState);
                continuityStateForImage = persisted?.currentState || continuityStateForImage;
                await refreshSceneTaggerRecords();
            }

            if (explicitPhotoRequest) {
                sceneEval.generate = true;
                sceneEval.weight = 1.0;
                sceneEval.category = 'explicit_request';
            }

            if (!canUseClassifier) {
                sceneEval.generate = Boolean(fallbackSceneTags);
                sceneEval.weight = fallbackSceneTags ? 1 : 0;
                sceneEval.category = explicitPhotoRequest ? 'explicit_request' : 'fallback_reply';
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

            sceneEval = {
                generate: Boolean(fallbackSceneTags),
                category: explicitPhotoRequest ? 'explicit_request' : 'fallback_reply',
                weight: fallbackSceneTags ? 1 : 0,
            };

            console.warn(`[${extensionName}] falling back to reply text after analysis failure`, {
                currentIndex,
                explicitPhotoRequest,
                fallbackSceneTags,
            });
        } finally {
            isImageAnalysisCall = false;
        }
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
        continuityStateForImage,
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

    const continuityFallbackTags = continuityStateForImage
        ? imageTagsToSceneTags([], continuityStateForImage)
        : '';

    if (Array.isArray(sceneEval.imageTags) && sceneEval.imageTags.length > 0) {
        sceneTags = imageTagsToSceneTags(sceneEval.imageTags, continuityStateForImage);
        console.log(`[${extensionName}] using image tags from router pipeline`, {
            currentIndex,
            imageTags: sceneEval.imageTags,
            continuityStateForImage,
            sceneTags,
        });
    } else if (continuityFallbackTags) {
        sceneTags = continuityFallbackTags;
        console.log(`[${extensionName}] using continuity fallback tags`, {
            currentIndex,
            continuityStateForImage,
            sceneTags,
        });
    } else {
        sceneTags = fallbackSceneTags;
        console.warn(`[${extensionName}] image tags unavailable, using reply text fallback`, {
            currentIndex,
            sceneTags,
        });
    }

    if (!sceneTags || !sceneTags.trim()) {
        console.warn(`[${extensionName}] empty scene tags`);
        return;
    }

    const commonPromptPrefix = resolveCommonPromptPrefix();
    const rawPrompt = buildPromptFromPhraseItems(
        extension_settings[extensionName]?.promptPhrases,
        sceneTags,
        commonPromptPrefix.value,
    );
    const prompt = sanitizeFinalImagePrompt(rawPrompt);

    console.log(`[${extensionName}] final SD prompt`, {
        rawPrompt,
        prompt,
        commonPromptPrefix: commonPromptPrefix.value,
        commonPromptPrefixSource: commonPromptPrefix.source,
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
