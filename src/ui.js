import {
    ACTION_GROUP_LABELS,
    AGE_LABELS,
    ALL_ACTION_LABELS,
    ATTIRE_LABELS,
    CONSENT_LABELS,
    CONTACT_LABELS,
    CONTENT_LABELS,
    EXPOSURE_LABELS,
    POSE_LABELS,
    RISK_LABELS,
    SETTING_LABELS,
} from './labels.js';

function escapeHtml(value) {
    return $('<div>').text(value ?? '').html();
}

function buildOptions(values, selectedValue = '') {
    const options = ['<option value="">Any</option>'];

    for (const value of values) {
        options.push(
            `<option value="${escapeHtml(value)}" ${selectedValue === value ? 'selected' : ''}>${escapeHtml(value)}</option>`,
        );
    }

    return options.join('');
}

function scenePreview(scene) {
    const preview = String(scene.source_text || '').trim().replace(/\s+/g, ' ');
    return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}

function imageTagPreview(scene) {
    return (scene.image_tags || []).slice(0, 8).join(', ');
}

function renderScenesList($container, scenes) {
    if (!$container.length) {
        return;
    }

    if (!scenes.length) {
        $container.html('<div class="text-muted">No scene records yet.</div>');
        return;
    }

    const html = scenes.map(scene => `
        <div class="st_scene_card" data-scene-id="${escapeHtml(scene.scene_id)}">
            <div class="st_scene_card_header">
                <div class="st_scene_badges">
                    <span class="tag">content: ${escapeHtml(scene.normalized_tags?.content || 'unknown')}</span>
                    <span class="tag">group: ${escapeHtml(scene.normalized_tags?.action_group || 'unknown')}</span>
                    <span class="tag">action: ${escapeHtml(scene.normalized_tags?.action || 'unknown')}</span>
                    <span class="tag">pose: ${escapeHtml(scene.normalized_tags?.pose || 'unknown')}</span>
                    <span class="tag">location: ${escapeHtml(scene.normalized_tags?.location || 'unknown')}</span>
                    <span class="tag">safety: ${escapeHtml(scene.safety_tags?.age || 'unknown')}/${escapeHtml(scene.safety_tags?.consent || 'unknown')}/${escapeHtml(scene.safety_tags?.risk || 'unknown')}</span>
                </div>
                <div class="st_scene_range">messages ${escapeHtml(scene.message_start)}-${escapeHtml(scene.message_end)}</div>
            </div>
            <div class="st_scene_preview">${escapeHtml(scenePreview(scene))}</div>
            <div class="st_scene_tags_preview">${escapeHtml(imageTagPreview(scene))}</div>
            <div class="st_scene_actions">
                <button class="menu_button st_scene_view_source" type="button">View Source</button>
                <button class="menu_button st_scene_edit_tags" type="button">Edit Tags</button>
                <button class="menu_button st_scene_reprocess" type="button">Reprocess</button>
                <button class="menu_button st_scene_delete" type="button">Delete</button>
            </div>
        </div>
    `).join('');

    $container.html(html);
}

export function ensureSceneTaggerStyles() {
    if ($('#st_scene_tagger_styles').length) {
        return;
    }

    $('head').append(`
        <style id="st_scene_tagger_styles">
            #scene_tagger_panel { margin-top: 16px; }
            #scene_tagger_panel .st_scene_grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
            #scene_tagger_panel .st_scene_controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
            #scene_tagger_panel .st_scene_filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
            #scene_tagger_panel .st_scene_card { border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 12px; margin-top: 10px; background: rgba(255,255,255,0.03); }
            #scene_tagger_panel .st_scene_card_header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
            #scene_tagger_panel .st_scene_badges { display: flex; flex-wrap: wrap; gap: 6px; }
            #scene_tagger_panel .tag { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 12px; }
            #scene_tagger_panel .st_scene_preview, #scene_tagger_panel .st_scene_tags_preview { margin-top: 8px; opacity: 0.9; }
            #scene_tagger_panel .st_scene_actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
            #scene_tagger_panel .st_scene_status { margin-top: 8px; opacity: 0.8; font-size: 12px; }
            #scene_tagger_panel .st_memory_panel { margin-top: 16px; padding: 12px; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; background: rgba(255,255,255,0.03); }
            #scene_tagger_panel .st_memory_debug { margin-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
            #scene_tagger_panel .st_memory_debug pre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,0.18); padding: 10px; border-radius: 8px; }
            @media (max-width: 900px) {
                #scene_tagger_panel .st_scene_filters,
                #scene_tagger_panel .st_scene_grid,
                #scene_tagger_panel .st_memory_debug { grid-template-columns: 1fr; }
            }
        </style>
    `);
}

export function createSceneTaggerUi({
    rootSelector,
    state,
    onTagCurrentChat,
    onTagSelectedMessages,
    onReprocessScene,
    onExportJson,
    onImportJson,
    onClearDatabase,
    onDeleteScene,
    onEditScene,
    onViewSource,
    onFiltersChanged,
    onSceneTaggerSettingsChanged,
    onMemorySettingsChanged,
    onClearCurrentChatMemory,
    onClearAllMemory,
    onRefreshCanonSnapshot,
    onViewCanonSnapshot,
    onClearCanonSnapshot,
    onCanonSettingsChanged,
    onUserReplySettingsChanged,
    onClearUserCorrections,
    onRequestPersistentStorage,
    onShowStorageUsage,
    onExportCurrentChatJson,
    onCompactCurrentChat,
    onArchiveOldScenes,
    onDeleteArchivedSourceText,
}) {
    ensureSceneTaggerStyles();
    const $root = $(rootSelector);
    if (!$root.length) {
        return { refresh() { } };
    }

    function renderFilters() {
        const filters = state.filters || {};
        $('#scene_filter_content').html(buildOptions(CONTENT_LABELS, filters.content));
        $('#scene_filter_action_group').html(buildOptions(ACTION_GROUP_LABELS, filters.action_group));
        $('#scene_filter_action').html(buildOptions(ALL_ACTION_LABELS, filters.action));
        $('#scene_filter_pose').html(buildOptions(POSE_LABELS, filters.pose));
        $('#scene_filter_exposure').html(buildOptions(EXPOSURE_LABELS, filters.exposure));
        $('#scene_filter_contact').html(buildOptions(CONTACT_LABELS, filters.contact));
        $('#scene_filter_attire').html(buildOptions(ATTIRE_LABELS, filters.attire));
        $('#scene_filter_setting').html(buildOptions(SETTING_LABELS, filters.setting));
        $('#scene_filter_age').html(buildOptions(AGE_LABELS, filters.age));
        $('#scene_filter_consent').html(buildOptions(CONSENT_LABELS, filters.consent));
        $('#scene_filter_risk').html(buildOptions(RISK_LABELS, filters.risk));
        $('#scene_filter_search').val(filters.search || '');
    }

    function render() {
        const sceneTaggerSettings = state.sceneTaggerSettings || {};
        const memorySettings = state.memorySettings || {};
        const canonSettings = state.canonSettings || {};
        const userReplySettings = state.userReplySettings || {};
        const memoryDebug = state.memoryDebug || {};
        const storageUsage = memoryDebug.storageUsage;
        const currentState = memoryDebug.currentState || {};

        $root.html(`
            <div id="scene_tagger_panel">
                <hr class="sysHR">
                <div class="flex-container flexnowrap">
                    <strong>Scene Tagger</strong>
                </div>

                <div class="st_scene_controls">
                    <button id="scene_tag_current_chat" class="menu_button" type="button">Tag Current Chat</button>
                    <button id="scene_tag_selected_messages" class="menu_button" type="button">Tag Selected Messages</button>
                    <button id="scene_reprocess_selected" class="menu_button" type="button">Reprocess Selected Scene</button>
                    <button id="scene_export_json" class="menu_button" type="button">Export JSON</button>
                    <button id="scene_export_current_chat_json" class="menu_button" type="button">Export Current Chat</button>
                    <button id="scene_import_json" class="menu_button" type="button">Import JSON</button>
                    <button id="scene_clear_database" class="menu_button" type="button">Clear Local Database</button>
                    <button id="scene_compact_current_chat" class="menu_button" type="button">Compact Current Chat</button>
                    <button id="scene_archive_old" class="menu_button" type="button">Archive Old Scenes</button>
                    <button id="scene_delete_archived_source" class="menu_button" type="button">Delete Archived Source Text</button>
                </div>

                <div class="st_scene_status" id="scene_tagger_status">${escapeHtml(state.status || 'Ready')}</div>

                <div class="st_memory_panel">
                    <div class="flex-container flexnowrap"><strong>Automation</strong></div>
                    <div class="st_scene_controls">
                        <label class="stimg_checkbox_row">
                            <span>Sanitize character output</span>
                            <input id="scene_tagger_sanitize_character_output" type="checkbox" class="checkbox" ${sceneTaggerSettings.sanitizeCharacterOutput ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Auto-save generated scenes</span>
                            <input id="scene_tagger_auto_save_generated_scenes" type="checkbox" class="checkbox" ${sceneTaggerSettings.autoSaveGeneratedScenes ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Enable data maintenance</span>
                            <input id="scene_tagger_data_maintenance_enabled" type="checkbox" class="checkbox" ${sceneTaggerSettings.dataMaintenanceEnabled ? 'checked' : ''}>
                        </label>
                        <input id="scene_tagger_data_maintenance_every_messages" class="text_pole widthNatural" type="number" min="1" step="1" value="${escapeHtml(sceneTaggerSettings.dataMaintenanceEveryMessages || 5)}" placeholder="Maintenance every N messages">
                    </div>

                    <div class="flex-container flexnowrap"><strong>Continuity Memory</strong></div>
                    <div class="st_scene_controls">
                        <label class="stimg_checkbox_row">
                            <span>Enable continuity memory</span>
                            <input id="memory_enabled" type="checkbox" class="checkbox" ${memorySettings.memoryEnabled ? 'checked' : ''}>
                        </label>
                        <select id="memory_mode" class="text_pole widthNatural">
                            <option value="off" ${memorySettings.memoryMode === 'off' ? 'selected' : ''}>off</option>
                            <option value="light" ${memorySettings.memoryMode === 'light' ? 'selected' : ''}>light</option>
                            <option value="strong" ${memorySettings.memoryMode === 'strong' ? 'selected' : ''}>strong</option>
                        </select>
                        <input id="memory_max_chars" class="text_pole widthNatural" type="number" min="100" step="50" value="${escapeHtml(memorySettings.maxMemoryChars || 1200)}" placeholder="Max memory chars">
                        <label class="stimg_checkbox_row">
                            <span>Include recent events</span>
                            <input id="memory_include_recent_events" type="checkbox" class="checkbox" ${memorySettings.includeRecentEvents ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Include open threads</span>
                            <input id="memory_include_open_threads" type="checkbox" class="checkbox" ${memorySettings.includeOpenThreads ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Show memory block debug</span>
                            <input id="memory_debug_show" type="checkbox" class="checkbox" ${memorySettings.debugShowMemoryBlock ? 'checked' : ''}>
                        </label>
                    </div>
                    <div class="st_scene_controls">
                        <button id="memory_clear_current_chat" class="menu_button" type="button">Clear Current Chat Memory</button>
                        <button id="memory_clear_all" class="menu_button" type="button">Clear All Memory</button>
                        <button id="canon_refresh_current_chat" class="menu_button" type="button">Refresh Canon Snapshot</button>
                        <button id="canon_view_current_chat" class="menu_button" type="button">View Canon Snapshot</button>
                        <button id="canon_clear_current_chat" class="menu_button" type="button">Clear Canon Snapshot</button>
                        <button id="memory_clear_user_corrections" class="menu_button" type="button">Clear User Corrections</button>
                        <button id="memory_request_persistent_storage" class="menu_button" type="button">Request Persistent Storage</button>
                        <button id="memory_show_storage_usage" class="menu_button" type="button">Show Storage Usage</button>
                    </div>
                    <div class="st_scene_controls">
                        <label class="stimg_checkbox_row">
                            <span>Enable canon snapshot</span>
                            <input id="canon_enabled" type="checkbox" class="checkbox" ${canonSettings.canonEnabled ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Refresh canon on chat load</span>
                            <input id="canon_refresh_on_chat_load" type="checkbox" class="checkbox" ${canonSettings.refreshCanonOnChatLoad ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Include canon in memory block</span>
                            <input id="canon_include_in_memory_block" type="checkbox" class="checkbox" ${canonSettings.includeCanonInMemoryBlock ? 'checked' : ''}>
                        </label>
                        <input id="canon_max_chars" class="text_pole widthNatural" type="number" min="100" step="50" value="${escapeHtml(canonSettings.maxCanonChars || 600)}" placeholder="Max canon chars">
                    </div>
                    <div class="st_scene_controls">
                        <label class="stimg_checkbox_row">
                            <span>Enable user correction detection</span>
                            <input id="user_reply_memory_enabled" type="checkbox" class="checkbox" ${userReplySettings.userReplyMemoryEnabled ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Use regex correction detection</span>
                            <input id="user_reply_detect_corrections_regex" type="checkbox" class="checkbox" ${userReplySettings.detectCorrectionsWithRegex ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Run LLM correction extractor</span>
                            <input id="user_reply_run_llm_extractor" type="checkbox" class="checkbox" ${userReplySettings.runLlmCorrectionExtractor ? 'checked' : ''}>
                        </label>
                        <label class="stimg_checkbox_row">
                            <span>Show user corrections in memory block</span>
                            <input id="user_reply_show_corrections_in_prompt" type="checkbox" class="checkbox" ${userReplySettings.showUserCorrectionsInPrompt ? 'checked' : ''}>
                        </label>
                        <input id="user_reply_max_assertions" class="text_pole widthNatural" type="number" min="1" step="1" value="${escapeHtml(userReplySettings.maxUserAssertions || 20)}" placeholder="Max user assertions">
                        <input id="user_reply_max_guidance" class="text_pole widthNatural" type="number" min="1" step="1" value="${escapeHtml(userReplySettings.maxTemporaryGuidance || 10)}" placeholder="Max temp guidance">
                    </div>
                    <div class="st_scene_status">
                        Storage: ${storageUsage?.percentUsed != null ? `${escapeHtml(storageUsage.percentUsed)}% (${escapeHtml(storageUsage.usage)} / ${escapeHtml(storageUsage.quota)})` : 'unknown'}
                    </div>
                    <div class="st_memory_debug">
                        <div>
                            <div><strong>Canon snapshot</strong></div>
                            <pre>${escapeHtml(JSON.stringify(memoryDebug.canonSnapshot || null, null, 2))}</pre>
                        </div>
                        <div>
                            <div><strong>Current state JSON</strong></div>
                            <pre>${escapeHtml(JSON.stringify(currentState || null, null, 2))}</pre>
                        </div>
                        <div>
                            <div><strong>User assertions</strong></div>
                            <pre>${escapeHtml(JSON.stringify(currentState.user_assertions || [], null, 2))}</pre>
                        </div>
                        <div>
                            <div><strong>Corrections</strong></div>
                            <pre>${escapeHtml(JSON.stringify(currentState.corrections || [], null, 2))}</pre>
                        </div>
                        <div>
                            <div><strong>Temporary guidance</strong></div>
                            <pre>${escapeHtml(JSON.stringify(currentState.temporary_guidance || [], null, 2))}</pre>
                        </div>
                        <div>
                            <div><strong>Last injected memory block</strong></div>
                            <pre>${escapeHtml(memoryDebug.lastInjectedMemoryBlock || '')}</pre>
                        </div>
                    </div>
                    <div class="st_scene_status">
                        Last updated: ${escapeHtml(memoryDebug.lastUpdatedTimestamp || 'unknown')}<br>
                        Last source scene: ${escapeHtml(memoryDebug.lastSourceSceneId || 'unknown')}<br>
                        Last warning: ${escapeHtml(memoryDebug.lastParserWarning || 'none')}
                    </div>
                </div>

                <div class="st_scene_filters">
                    <select id="scene_filter_content" class="text_pole"></select>
                    <select id="scene_filter_action_group" class="text_pole"></select>
                    <select id="scene_filter_action" class="text_pole"></select>
                    <select id="scene_filter_pose" class="text_pole"></select>
                    <select id="scene_filter_exposure" class="text_pole"></select>
                    <select id="scene_filter_contact" class="text_pole"></select>
                    <select id="scene_filter_attire" class="text_pole"></select>
                    <select id="scene_filter_setting" class="text_pole"></select>
                    <select id="scene_filter_age" class="text_pole"></select>
                    <select id="scene_filter_consent" class="text_pole"></select>
                    <select id="scene_filter_risk" class="text_pole"></select>
                    <input id="scene_filter_search" class="text_pole" type="text" placeholder="Raw search text">
                </div>

                <div id="scene_list_container" class="marginTop10"></div>
            </div>
        `);

        renderFilters();
        renderScenesList($('#scene_list_container'), state.filteredScenes || []);

        $('#scene_tag_current_chat').off('click').on('click', onTagCurrentChat);
        $('#scene_tag_selected_messages').off('click').on('click', onTagSelectedMessages);
        $('#scene_reprocess_selected').off('click').on('click', onReprocessScene);
        $('#scene_export_json').off('click').on('click', onExportJson);
        $('#scene_export_current_chat_json').off('click').on('click', onExportCurrentChatJson);
        $('#scene_import_json').off('click').on('click', onImportJson);
        $('#scene_clear_database').off('click').on('click', onClearDatabase);
        $('#scene_compact_current_chat').off('click').on('click', onCompactCurrentChat);
        $('#scene_archive_old').off('click').on('click', onArchiveOldScenes);
        $('#scene_delete_archived_source').off('click').on('click', onDeleteArchivedSourceText);
        $('#memory_clear_current_chat').off('click').on('click', onClearCurrentChatMemory);
        $('#memory_clear_all').off('click').on('click', onClearAllMemory);
        $('#canon_refresh_current_chat').off('click').on('click', onRefreshCanonSnapshot);
        $('#canon_view_current_chat').off('click').on('click', onViewCanonSnapshot);
        $('#canon_clear_current_chat').off('click').on('click', onClearCanonSnapshot);
        $('#memory_clear_user_corrections').off('click').on('click', onClearUserCorrections);
        $('#memory_request_persistent_storage').off('click').on('click', onRequestPersistentStorage);
        $('#memory_show_storage_usage').off('click').on('click', onShowStorageUsage);
        $('#memory_enabled').off('change').on('change', function () {
            onMemorySettingsChanged('memoryEnabled', $(this).prop('checked'));
        });
        $('#scene_tagger_sanitize_character_output').off('change').on('change', function () {
            onSceneTaggerSettingsChanged('sanitizeCharacterOutput', $(this).prop('checked'));
        });
        $('#scene_tagger_auto_save_generated_scenes').off('change').on('change', function () {
            onSceneTaggerSettingsChanged('autoSaveGeneratedScenes', $(this).prop('checked'));
        });
        $('#scene_tagger_data_maintenance_enabled').off('change').on('change', function () {
            onSceneTaggerSettingsChanged('dataMaintenanceEnabled', $(this).prop('checked'));
        });
        $('#scene_tagger_data_maintenance_every_messages').off('input').on('input', function () {
            onSceneTaggerSettingsChanged('dataMaintenanceEveryMessages', Number($(this).val() || 5));
        });
        $('#memory_mode').off('change').on('change', function () {
            onMemorySettingsChanged('memoryMode', String($(this).val() || 'light'));
        });
        $('#memory_max_chars').off('input').on('input', function () {
            onMemorySettingsChanged('maxMemoryChars', Number($(this).val() || 1200));
        });
        $('#memory_include_recent_events').off('change').on('change', function () {
            onMemorySettingsChanged('includeRecentEvents', $(this).prop('checked'));
        });
        $('#memory_include_open_threads').off('change').on('change', function () {
            onMemorySettingsChanged('includeOpenThreads', $(this).prop('checked'));
        });
        $('#memory_debug_show').off('change').on('change', function () {
            onMemorySettingsChanged('debugShowMemoryBlock', $(this).prop('checked'));
        });
        $('#canon_enabled').off('change').on('change', function () {
            onCanonSettingsChanged('canonEnabled', $(this).prop('checked'));
        });
        $('#canon_refresh_on_chat_load').off('change').on('change', function () {
            onCanonSettingsChanged('refreshCanonOnChatLoad', $(this).prop('checked'));
        });
        $('#canon_include_in_memory_block').off('change').on('change', function () {
            onCanonSettingsChanged('includeCanonInMemoryBlock', $(this).prop('checked'));
        });
        $('#canon_max_chars').off('input').on('input', function () {
            onCanonSettingsChanged('maxCanonChars', Number($(this).val() || 600));
        });
        $('#user_reply_memory_enabled').off('change').on('change', function () {
            onUserReplySettingsChanged('userReplyMemoryEnabled', $(this).prop('checked'));
        });
        $('#user_reply_detect_corrections_regex').off('change').on('change', function () {
            onUserReplySettingsChanged('detectCorrectionsWithRegex', $(this).prop('checked'));
        });
        $('#user_reply_run_llm_extractor').off('change').on('change', function () {
            onUserReplySettingsChanged('runLlmCorrectionExtractor', $(this).prop('checked'));
        });
        $('#user_reply_show_corrections_in_prompt').off('change').on('change', function () {
            onUserReplySettingsChanged('showUserCorrectionsInPrompt', $(this).prop('checked'));
        });
        $('#user_reply_max_assertions').off('input').on('input', function () {
            onUserReplySettingsChanged('maxUserAssertions', Number($(this).val() || 20));
        });
        $('#user_reply_max_guidance').off('input').on('input', function () {
            onUserReplySettingsChanged('maxTemporaryGuidance', Number($(this).val() || 10));
        });

        $('#scene_tagger_panel').off('change.sceneFilters input.sceneFilters');
        $('#scene_tagger_panel').on('change.sceneFilters', 'select', function () {
            const $el = $(this);
            onFiltersChanged($el.attr('id'), String($el.val() || ''));
        });
        $('#scene_tagger_panel').on('input.sceneFilters', '#scene_filter_search', function () {
            onFiltersChanged('scene_filter_search', String($(this).val() || ''));
        });

        $('#scene_list_container').off('click.sceneList');
        $('#scene_list_container').on('click.sceneList', '.st_scene_view_source', function () {
            onViewSource($(this).closest('.st_scene_card').data('scene-id'));
        });
        $('#scene_list_container').on('click.sceneList', '.st_scene_edit_tags', function () {
            onEditScene($(this).closest('.st_scene_card').data('scene-id'));
        });
        $('#scene_list_container').on('click.sceneList', '.st_scene_reprocess', function () {
            onReprocessScene($(this).closest('.st_scene_card').data('scene-id'));
        });
        $('#scene_list_container').on('click.sceneList', '.st_scene_delete', function () {
            onDeleteScene($(this).closest('.st_scene_card').data('scene-id'));
        });
    }

    return {
        refresh(nextState = null) {
            if (nextState) {
                Object.assign(state, nextState);
            }
            render();
        },
    };
}
