const DB_NAME = 'st-scene-tagger';
const DB_VERSION = 3;

const STORE_SCENES = 'scenes';
const STORE_SETTINGS = 'settings';
const STORE_PROMPT_VERSIONS = 'prompt_versions';
const STORE_MEMORY_EVENTS = 'memory_events';
const STORE_CURRENT_STATE = 'current_state';
const STORE_ROLLUP_SUMMARIES = 'rollup_summaries';
const STORE_CANON_SNAPSHOTS = 'canon_snapshots';

let dbPromise = null;

function ensureIndexedDb() {
    if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is unavailable in this environment.');
    }
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function createScenesStore(db) {
    if (db.objectStoreNames.contains(STORE_SCENES)) {
        return;
    }

    const store = db.createObjectStore(STORE_SCENES, { keyPath: 'scene_id' });
    store.createIndex('chat_id', 'chat_id', { unique: false });
    store.createIndex('character_id', 'character_id', { unique: false });
    store.createIndex('created_at', 'created_at', { unique: false });
    store.createIndex('scene_index', 'scene_index', { unique: false });
    store.createIndex('archived', 'archived', { unique: false });
    store.createIndex('normalized_tags.content', 'normalized_tags.content', { unique: false });
    store.createIndex('normalized_tags.action', 'normalized_tags.action', { unique: false });
    store.createIndex('normalized_tags.action_group', 'normalized_tags.action_group', { unique: false });
    store.createIndex('normalized_tags.pose', 'normalized_tags.pose', { unique: false });
    store.createIndex('normalized_tags.location', 'normalized_tags.location', { unique: false });
    store.createIndex('safety_tags.age', 'safety_tags.age', { unique: false });
    store.createIndex('safety_tags.consent', 'safety_tags.consent', { unique: false });
    store.createIndex('safety_tags.risk', 'safety_tags.risk', { unique: false });
}

function createMemoryEventsStore(db) {
    if (db.objectStoreNames.contains(STORE_MEMORY_EVENTS)) {
        return;
    }

    const store = db.createObjectStore(STORE_MEMORY_EVENTS, { keyPath: 'memory_id' });
    store.createIndex('chat_id', 'chat_id', { unique: false });
    store.createIndex('scene_id', 'scene_id', { unique: false });
    store.createIndex('updated_at', 'updated_at', { unique: false });
}

function createCurrentStateStore(db) {
    if (db.objectStoreNames.contains(STORE_CURRENT_STATE)) {
        return;
    }

    const store = db.createObjectStore(STORE_CURRENT_STATE, { keyPath: 'chat_id' });
    store.createIndex('updated_at', 'updated_at', { unique: false });
}

function createRollupSummariesStore(db) {
    if (db.objectStoreNames.contains(STORE_ROLLUP_SUMMARIES)) {
        return;
    }

    const store = db.createObjectStore(STORE_ROLLUP_SUMMARIES, { keyPath: 'summary_id' });
    store.createIndex('chat_id', 'chat_id', { unique: false });
    store.createIndex('scene_start', 'scene_start', { unique: false });
    store.createIndex('scene_end', 'scene_end', { unique: false });
    store.createIndex('created_at', 'created_at', { unique: false });
}

function createCanonSnapshotsStore(db) {
    if (db.objectStoreNames.contains(STORE_CANON_SNAPSHOTS)) {
        return;
    }

    const store = db.createObjectStore(STORE_CANON_SNAPSHOTS, { keyPath: 'chat_id' });
    store.createIndex('character_id', 'character_id', { unique: false });
    store.createIndex('updated_at', 'updated_at', { unique: false });
}

function createBasicStore(db, name, keyPath = 'id') {
    if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name, { keyPath });
    }
}

export async function initDb() {
    ensureIndexedDb();

    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                createScenesStore(db);
                createBasicStore(db, STORE_SETTINGS, 'key');
                createBasicStore(db, STORE_PROMPT_VERSIONS, 'key');
                createMemoryEventsStore(db);
                createCurrentStateStore(db);
                createRollupSummariesStore(db);
                createCanonSnapshotsStore(db);
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    return dbPromise;
}

async function getStore(storeName, mode = 'readonly') {
    const db = await initDb();
    return db.transaction(storeName, mode).objectStore(storeName);
}

function sortByCreatedDesc(items) {
    return [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export async function saveScene(scene) {
    const db = await initDb();
    const tx = db.transaction(STORE_SCENES, 'readwrite');
    const nextScene = {
        archived: false,
        scene_index: Number.isFinite(scene.scene_index) ? scene.scene_index : scene.message_end,
        ...scene,
    };
    tx.objectStore(STORE_SCENES).put(nextScene);
    await transactionDone(tx);
    return nextScene;
}

export async function getScene(sceneId) {
    const store = await getStore(STORE_SCENES);
    return requestToPromise(store.get(sceneId));
}

export async function getAllScenes() {
    const store = await getStore(STORE_SCENES);
    return requestToPromise(store.getAll());
}

export async function getScenesByChat(chatId, options = {}) {
    const store = await getStore(STORE_SCENES);
    let scenes = await requestToPromise(store.index('chat_id').getAll(chatId));

    if (options.archived === true || options.archived === false) {
        scenes = scenes.filter(scene => Boolean(scene.archived) === options.archived);
    }

    scenes = sortByCreatedDesc(scenes);

    if (Number.isFinite(options.limit) && options.limit > 0) {
        scenes = scenes.slice(0, options.limit);
    }

    return scenes;
}

export async function getRecentScenes(chatId, limit = 5) {
    return getScenesByChat(chatId, { archived: false, limit });
}

export async function deleteScene(sceneId) {
    const db = await initDb();
    const tx = db.transaction(STORE_SCENES, 'readwrite');
    tx.objectStore(STORE_SCENES).delete(sceneId);
    await transactionDone(tx);
}

export async function clearScenes() {
    const db = await initDb();
    const tx = db.transaction(
        [STORE_SCENES, STORE_MEMORY_EVENTS, STORE_CURRENT_STATE, STORE_ROLLUP_SUMMARIES, STORE_CANON_SNAPSHOTS],
        'readwrite',
    );
    tx.objectStore(STORE_SCENES).clear();
    tx.objectStore(STORE_MEMORY_EVENTS).clear();
    tx.objectStore(STORE_CURRENT_STATE).clear();
    tx.objectStore(STORE_ROLLUP_SUMMARIES).clear();
    tx.objectStore(STORE_CANON_SNAPSHOTS).clear();
    await transactionDone(tx);
}

export async function exportScenes(options = {}) {
    const { chatId } = options;
    const scenes = chatId ? await getScenesByChat(chatId) : await getAllScenes();
    const memoryEvents = chatId ? await getMemoryEventsByChat(chatId) : await getAllMemoryEvents();
    const currentStates = chatId
        ? (await getCurrentState(chatId) ? [await getCurrentState(chatId)] : [])
        : await getAllCurrentStates();
    const rollupSummaries = chatId ? await getRollupSummariesByChat(chatId) : await getAllRollupSummaries();
    const canonSnapshots = chatId
        ? (await getCanonSnapshot(chatId) ? [await getCanonSnapshot(chatId)] : [])
        : await getAllCanonSnapshots();

    return {
        app: 'st-scene-tagger',
        version: '1.0.0',
        exported_at: new Date().toISOString(),
        scenes,
        memory_events: memoryEvents,
        current_states: currentStates,
        rollup_summaries: rollupSummaries,
        canon_snapshots: canonSnapshots,
    };
}

export async function importScenes(payload) {
    const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
    const memoryEvents = Array.isArray(payload?.memory_events) ? payload.memory_events : [];
    const currentStates = Array.isArray(payload?.current_states) ? payload.current_states : [];
    const rollupSummaries = Array.isArray(payload?.rollup_summaries) ? payload.rollup_summaries : [];
    const canonSnapshots = Array.isArray(payload?.canon_snapshots) ? payload.canon_snapshots : [];
    const db = await initDb();
    const tx = db.transaction(
        [STORE_SCENES, STORE_MEMORY_EVENTS, STORE_CURRENT_STATE, STORE_ROLLUP_SUMMARIES, STORE_CANON_SNAPSHOTS],
        'readwrite',
    );

    for (const scene of scenes) {
        tx.objectStore(STORE_SCENES).put(scene);
    }

    for (const memoryEvent of memoryEvents) {
        tx.objectStore(STORE_MEMORY_EVENTS).put(memoryEvent);
    }

    for (const currentState of currentStates) {
        tx.objectStore(STORE_CURRENT_STATE).put(currentState);
    }

    for (const rollupSummary of rollupSummaries) {
        tx.objectStore(STORE_ROLLUP_SUMMARIES).put(rollupSummary);
    }

    for (const canonSnapshot of canonSnapshots) {
        tx.objectStore(STORE_CANON_SNAPSHOTS).put(canonSnapshot);
    }

    await transactionDone(tx);
}

export async function saveMemoryEvent(memoryEvent) {
    const db = await initDb();
    const tx = db.transaction(STORE_MEMORY_EVENTS, 'readwrite');
    tx.objectStore(STORE_MEMORY_EVENTS).put(memoryEvent);
    await transactionDone(tx);
    return memoryEvent;
}

export async function getMemoryEventsByChat(chatId) {
    const store = await getStore(STORE_MEMORY_EVENTS);
    return requestToPromise(store.index('chat_id').getAll(chatId));
}

export async function getAllMemoryEvents() {
    const store = await getStore(STORE_MEMORY_EVENTS);
    return requestToPromise(store.getAll());
}

export async function repairChatData(chatId, repairers = {}) {
    const db = await initDb();
    const tx = db.transaction([STORE_SCENES, STORE_MEMORY_EVENTS, STORE_CURRENT_STATE], 'readwrite');
    const sceneStore = tx.objectStore(STORE_SCENES);
    const memoryEventStore = tx.objectStore(STORE_MEMORY_EVENTS);
    const currentStateStore = tx.objectStore(STORE_CURRENT_STATE);

    const scenes = await requestToPromise(sceneStore.index('chat_id').getAll(chatId));
    const memoryEvents = await requestToPromise(memoryEventStore.index('chat_id').getAll(chatId));
    const currentState = await requestToPromise(currentStateStore.get(chatId));

    let repairedScenes = 0;
    let repairedMemoryEvents = 0;
    let repairedCurrentStates = 0;

    if (typeof repairers.repairSceneRecord === 'function') {
        for (const scene of scenes) {
            const repaired = repairers.repairSceneRecord(scene);
            if (JSON.stringify(repaired) !== JSON.stringify(scene)) {
                sceneStore.put(repaired);
                repairedScenes += 1;
            }
        }
    }

    if (typeof repairers.repairMemoryEvent === 'function') {
        for (const memoryEvent of memoryEvents) {
            const repaired = repairers.repairMemoryEvent(memoryEvent);
            if (JSON.stringify(repaired) !== JSON.stringify(memoryEvent)) {
                memoryEventStore.put(repaired);
                repairedMemoryEvents += 1;
            }
        }
    }

    if (currentState && typeof repairers.repairCurrentState === 'function') {
        const repaired = repairers.repairCurrentState(currentState);
        if (JSON.stringify(repaired) !== JSON.stringify(currentState)) {
            currentStateStore.put(repaired);
            repairedCurrentStates += 1;
        }
    }

    await transactionDone(tx);

    return {
        scenes: repairedScenes,
        memory_events: repairedMemoryEvents,
        current_states: repairedCurrentStates,
    };
}

export async function saveCurrentState(chatIdOrState, maybeCurrentState) {
    const currentState = typeof chatIdOrState === 'string'
        ? { ...maybeCurrentState, chat_id: chatIdOrState }
        : chatIdOrState;

    const db = await initDb();
    const tx = db.transaction(STORE_CURRENT_STATE, 'readwrite');
    tx.objectStore(STORE_CURRENT_STATE).put(currentState);
    await transactionDone(tx);
    return currentState;
}

export async function getCurrentState(chatId) {
    const store = await getStore(STORE_CURRENT_STATE);
    return requestToPromise(store.get(chatId));
}

export async function updateCurrentState(chatId, patch) {
    const currentState = (await getCurrentState(chatId)) || { chat_id: chatId };
    return saveCurrentState(chatId, { ...currentState, ...patch, chat_id: chatId });
}

export async function clearCurrentState(chatId) {
    const db = await initDb();
    const tx = db.transaction(STORE_CURRENT_STATE, 'readwrite');
    tx.objectStore(STORE_CURRENT_STATE).delete(chatId);
    await transactionDone(tx);
}

export async function clearAllCurrentStates() {
    const db = await initDb();
    const tx = db.transaction(STORE_CURRENT_STATE, 'readwrite');
    tx.objectStore(STORE_CURRENT_STATE).clear();
    await transactionDone(tx);
}

export async function getAllCurrentStates() {
    const store = await getStore(STORE_CURRENT_STATE);
    return requestToPromise(store.getAll());
}

export async function saveCanonSnapshot(chatIdOrSnapshot, maybeSnapshot) {
    const snapshot = typeof chatIdOrSnapshot === 'string'
        ? { ...maybeSnapshot, chat_id: chatIdOrSnapshot }
        : chatIdOrSnapshot;

    const db = await initDb();
    const tx = db.transaction(STORE_CANON_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_CANON_SNAPSHOTS).put(snapshot);
    await transactionDone(tx);
    return snapshot;
}

export async function getCanonSnapshot(chatId) {
    const store = await getStore(STORE_CANON_SNAPSHOTS);
    return requestToPromise(store.get(chatId));
}

export async function updateCanonSnapshot(chatId, patch) {
    const snapshot = (await getCanonSnapshot(chatId)) || { chat_id: chatId };
    return saveCanonSnapshot(chatId, { ...snapshot, ...patch, chat_id: chatId, updated_at: new Date().toISOString() });
}

export async function clearCanonSnapshot(chatId) {
    const db = await initDb();
    const tx = db.transaction(STORE_CANON_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_CANON_SNAPSHOTS).delete(chatId);
    await transactionDone(tx);
}

export async function clearAllCanonSnapshots() {
    const db = await initDb();
    const tx = db.transaction(STORE_CANON_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_CANON_SNAPSHOTS).clear();
    await transactionDone(tx);
}

export async function getAllCanonSnapshots() {
    const store = await getStore(STORE_CANON_SNAPSHOTS);
    return requestToPromise(store.getAll());
}

export async function saveRollupSummary(summary) {
    const db = await initDb();
    const tx = db.transaction(STORE_ROLLUP_SUMMARIES, 'readwrite');
    tx.objectStore(STORE_ROLLUP_SUMMARIES).put(summary);
    await transactionDone(tx);
    return summary;
}

export async function getRollupSummariesByChat(chatId) {
    const store = await getStore(STORE_ROLLUP_SUMMARIES);
    return requestToPromise(store.index('chat_id').getAll(chatId));
}

export async function getAllRollupSummaries() {
    const store = await getStore(STORE_ROLLUP_SUMMARIES);
    return requestToPromise(store.getAll());
}

export async function createRollupSummary(chatId, sceneStart, sceneEnd, summaryData = null) {
    const scenes = await getScenesByChat(chatId);
    const matchingScenes = scenes
        .filter(scene => (scene.scene_index ?? scene.message_end) >= sceneStart && (scene.scene_index ?? scene.message_end) <= sceneEnd)
        .sort((a, b) => (a.scene_index ?? a.message_end) - (b.scene_index ?? b.message_end));

    const summary = summaryData || {
        summary: matchingScenes.slice(0, 3).map(scene => scene.continuity_memory?.scene_summary || scene.normalized_tags?.action || 'unknown').join(', '),
        key_facts: [...new Set(matchingScenes.flatMap(scene => scene.continuity_memory?.continuity_facts || []))].slice(0, 8),
        recurring_locations: [...new Set(matchingScenes.map(scene => scene.normalized_tags?.location).filter(Boolean))].slice(0, 5),
        open_threads: [...new Set(matchingScenes.flatMap(scene => scene.continuity_memory?.open_threads || []))].slice(0, 5),
    };

    return saveRollupSummary({
        summary_id: `summary_${chatId}_${sceneStart}_${sceneEnd}`,
        chat_id: chatId,
        scene_start: sceneStart,
        scene_end: sceneEnd,
        message_start: matchingScenes[0]?.message_start ?? 0,
        message_end: matchingScenes.at(-1)?.message_end ?? 0,
        summary: summary.summary || 'unknown',
        key_facts: summary.key_facts || [],
        recurring_locations: summary.recurring_locations || [],
        open_threads: summary.open_threads || [],
        created_at: new Date().toISOString(),
    });
}

export async function compactChatScenes(chatId, options = {}) {
    const compactEveryScenes = options.compactEveryScenes || 50;
    const scenes = [...await getScenesByChat(chatId)].sort((a, b) => (a.scene_index ?? a.message_end) - (b.scene_index ?? b.message_end));
    const existingSummaries = await getRollupSummariesByChat(chatId);
    const existingIds = new Set(existingSummaries.map(summary => summary.summary_id));

    for (let start = 0; start < scenes.length; start += compactEveryScenes) {
        const batch = scenes.slice(start, start + compactEveryScenes);
        if (!batch.length) {
            continue;
        }

        const sceneStart = batch[0].scene_index ?? batch[0].message_end;
        const sceneEnd = batch.at(-1).scene_index ?? batch.at(-1).message_end;
        const summaryId = `summary_${chatId}_${sceneStart}_${sceneEnd}`;
        if (existingIds.has(summaryId)) {
            continue;
        }

        await createRollupSummary(chatId, sceneStart, sceneEnd);
    }
}

export async function archiveOldScenes(chatId, options = {}) {
    const archiveAfterScenes = options.archiveAfterScenes || 200;
    const scenes = sortByCreatedDesc(await getScenesByChat(chatId));
    const toArchive = scenes.slice(archiveAfterScenes);
    if (!toArchive.length) {
        return 0;
    }

    const db = await initDb();
    const tx = db.transaction(STORE_SCENES, 'readwrite');
    const store = tx.objectStore(STORE_SCENES);

    for (const scene of toArchive) {
        store.put({ ...scene, archived: true, updated_at: new Date().toISOString() });
    }

    await transactionDone(tx);
    return toArchive.length;
}

export async function cleanupArchivedSourceText(chatId) {
    const archivedScenes = await getScenesByChat(chatId, { archived: true });
    const db = await initDb();
    const tx = db.transaction(STORE_SCENES, 'readwrite');
    const store = tx.objectStore(STORE_SCENES);

    for (const scene of archivedScenes) {
        store.put({
            ...scene,
            source_text_deleted: true,
            source_text: '',
            raw_extraction: {},
            updated_at: new Date().toISOString(),
        });
    }

    await transactionDone(tx);
    return archivedScenes.length;
}

export async function getRelevantRollupSummaries(chatId, latestMessage, limit = 1) {
    const summaries = await getRollupSummariesByChat(chatId);
    const query = String(latestMessage || '').toLowerCase();

    return summaries
        .map(summary => {
            const searchable = [
                summary.summary,
                ...(summary.key_facts || []),
                ...(summary.recurring_locations || []),
                ...(summary.open_threads || []),
            ].join(' ').toLowerCase();

            let score = 0;
            for (const word of query.split(/\s+/)) {
                if (word.length > 3 && searchable.includes(word)) {
                    score += 1;
                }
            }

            return { summary, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.summary);
}

export async function searchRelevantScenes(chatId, latestMessage, limit = 5) {
    const scenes = await getScenesByChat(chatId, { archived: false });
    const query = String(latestMessage || '').toLowerCase();

    return scenes
        .map(scene => {
            const searchable = [
                scene.source_text,
                scene.normalized_tags?.action,
                scene.normalized_tags?.location,
                ...(scene.continuity_memory?.continuity_facts || []),
                ...(scene.image_tags || []),
            ].filter(Boolean).join(' ').toLowerCase();

            let score = 0;
            for (const word of query.split(/\s+/)) {
                if (word.length > 3 && searchable.includes(word)) {
                    score += 1;
                }
            }

            return { scene, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.scene);
}

export async function getMemoryContextForChat(chatId, latestMessage, options = {}) {
    const currentState = await getCurrentState(chatId);
    const recentScenes = await getRecentScenes(chatId, options.recentSceneLimit || 5);
    const relevantScenes = await searchRelevantScenes(chatId, latestMessage, options.relevantSceneLimit || 5);
    const summaries = await getRelevantRollupSummaries(chatId, latestMessage, options.summaryLimit || 1);

    return {
        currentState,
        recentScenes,
        relevantScenes,
        summaries,
    };
}

export async function getStorageUsage() {
    if (!navigator.storage?.estimate) {
        return null;
    }

    const estimate = await navigator.storage.estimate();
    return {
        usage: estimate.usage,
        quota: estimate.quota,
        percentUsed: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : null,
    };
}

export async function requestPersistentStorage() {
    if (!navigator.storage?.persist) {
        return false;
    }

    return navigator.storage.persist();
}
