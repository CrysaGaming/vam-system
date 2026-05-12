/**
 * Track 5 #25 (Section E) — Offline Draft Queue (IndexedDB)
 *
 * Generischer offline-queue für serialisierbare drafts (PIREPs, comments,
 * was auch immer). Wird von der UI gefüllt wenn navigator.onLine === false
 * oder ein submit-attempt mit network-error fehlschlägt; wird vom SW
 * sync-handler gedrained wenn connectivity zurück ist.
 *
 * # Warum IndexedDB statt localStorage?
 *
 *   1. SW kann localStorage NICHT lesen (kein access). IDB ist die einzige
 *      shared storage zwischen client + SW (außer Cache API, die ist aber
 *      für Request/Response gemacht, nicht für arbitrary structured data).
 *   2. IDB ist async + structured (kein JSON-roundtrip nötig) + viel
 *      größer (multi-MB statt 5MB).
 *   3. IDB hat eingebaute keypath-indizierung — wir kriegen FIFO ordering
 *      umsonst via auto-increment id.
 *
 * # Schema (geteilt mit sw.js)
 *
 * Die DB-name + store-name + version MÜSSEN im SW-handler IDENTISCH sein
 * (sw.js öffnet die selbe DB read-only). Wenn sich hier was ändert, MUSS
 * gleichzeitig sw.js aktualisiert werden — siehe drainDrafts() in sw.js
 * für die SW-side mirror-constants.
 */

// Schema constants — wenn das hier ändert, MUSS sw.js gleichzeitig ändern.
// Format: vam-{purpose}-vN. Versionsbump nur wenn store-schema bricht.
export const DRAFT_QUEUE_DB_NAME = 'vam-drafts-v1';
export const DRAFT_QUEUE_STORE = 'drafts';
export const DRAFT_QUEUE_DB_VERSION = 1;

/**
 * Ein record im queue. id wird beim enqueue auto-assigned (keyPath +
 * autoIncrement). retryCount tracked drain-attempts damit wir nicht
 * unendlich retry-en bei persistent-failing entries (z.B. server-side
 * validation-error die niemals success-en wird).
 */
export type DraftRecord = {
  id?: number;
  /** Discriminator für den drain-handler. Z.B. 'demo-ping' oder 'pirep-submit'. */
  kind: string;
  /** Serializable payload — wird per IDB structured-clone gespeichert. */
  payload: unknown;
  /** ms-since-epoch zeitpunkt des enqueue. */
  createdAt: number;
  /** wie oft drain-attempts schon gescheitert sind. Default 0. */
  retryCount?: number;
};

/**
 * Open the queue-database. Idempotent — wenn die DB schon existiert,
 * gibt nur eine connection zurück. Wenn nicht, wird sie beim upgrade-
 * event erstellt mit dem expected store-schema.
 *
 * Resolve-wert ist die offene DB. Caller verantwortlich für .close()
 * nach use, aber für one-shot ops ist das überflüssig — browser cleant
 * automatisch beim GC.
 */
function openDraftQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_QUEUE_DB_NAME, DRAFT_QUEUE_DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error('IDB open failed'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_QUEUE_STORE)) {
        // keyPath 'id' + autoIncrement → FIFO ordering, kein manuelles
        // id-management. Index auf 'kind' für künftige kind-spezifische
        // queries (z.B. "wie viele pirep-drafts liegen offline").
        const store = db.createObjectStore(DRAFT_QUEUE_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * Wrap eine IDBTransaction in eine Promise. IDB's transaction-API ist
 * event-based (oncomplete/onerror), das macht promise-chains ohne wrapper
 * sehr ugly. Diese helper konsumiert eine transaction + extract-callback,
 * gibt eine Promise zurück die mit dem callback-result resolved.
 */
function txPromise<T>(
  tx: IDBTransaction,
  workCallback: () => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    Promise.resolve(workCallback())
      .then((value) => {
        result = value;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
  });
}

/**
 * Enqueue a new draft. Returns die assigned id (vom autoIncrement key).
 * createdAt wird automatisch auf Date.now() gesetzt — caller braucht
 * nur kind + payload anzugeben.
 */
export async function enqueueDraft(
  draft: Omit<DraftRecord, 'id' | 'createdAt' | 'retryCount'>,
): Promise<number> {
  const db = await openDraftQueue();
  const record: DraftRecord = {
    kind: draft.kind,
    payload: draft.payload,
    createdAt: Date.now(),
    retryCount: 0,
  };

  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  return txPromise(tx, () => {
    return new Promise<number>((resolve, reject) => {
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error ?? new Error('add failed'));
    });
  });
}

/**
 * List ALL drafts in FIFO order (oldest first). Für den drain-handler
 * + UI-anzeige "du hast N drafts pending offline". Kein cursor/pagination
 * weil drafts-queues per definition klein sind (max 100-stellig).
 */
export async function listDrafts(): Promise<DraftRecord[]> {
  const db = await openDraftQueue();
  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readonly');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  return txPromise(tx, () => {
    return new Promise<DraftRecord[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as DraftRecord[]);
      req.onerror = () => reject(req.error ?? new Error('getAll failed'));
    });
  });
}

/**
 * Remove a draft by id (idempotent — wenn die id nicht existiert,
 * resolved silent). Wird vom drain-handler nach success-submit pro
 * draft aufgerufen.
 */
export async function removeDraft(id: number): Promise<void> {
  const db = await openDraftQueue();
  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  await txPromise(tx, () => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('delete failed'));
    });
  });
}

/**
 * Bump retryCount für einen draft. Wenn das drain mit transient-failure
 * fehlschlägt (network-error, 5xx) trackt das wie oft wir's schon
 * probiert haben. Caller-policy: nach N retries (z.B. 5) record als
 * dead-letter behandeln + UI-warning anzeigen.
 */
export async function incrementRetryCount(id: number): Promise<void> {
  const db = await openDraftQueue();
  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  await txPromise(tx, () => {
    return new Promise<void>((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as DraftRecord | undefined;
        if (!record) return resolve(); // already removed, idempotent
        record.retryCount = (record.retryCount ?? 0) + 1;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () =>
          reject(putReq.error ?? new Error('put failed'));
      };
      getReq.onerror = () => reject(getReq.error ?? new Error('get failed'));
    });
  });
}

/** Count: cheap "wie viele drafts liegen offline" für UI-badge. */
export async function countDrafts(): Promise<number> {
  const db = await openDraftQueue();
  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readonly');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  return txPromise(tx, () => {
    return new Promise<number>((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('count failed'));
    });
  });
}

/**
 * Nuke all drafts. Für eine "alles verwerfen"-UI-action oder bei
 * account-switch (drafts vom alten user gehören nicht zum neuen).
 */
export async function clearAllDrafts(): Promise<void> {
  const db = await openDraftQueue();
  const tx = db.transaction(DRAFT_QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(DRAFT_QUEUE_STORE);

  await txPromise(tx, () => {
    return new Promise<void>((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('clear failed'));
    });
  });
}
