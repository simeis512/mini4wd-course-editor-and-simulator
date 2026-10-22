import type { Autosave, SavedCourse } from '../course/saves';

// Courses kept in this browser's IndexedDB (#68). Nothing here leaves the browser.

const DB_NAME = 'mini4wd-courses';
const DB_VERSION = 1;
/** Named saves, keyed by id. */
const SAVES = 'saves';
/** One slot for the course being edited, apart from the named saves (#68). */
const AUTOSAVE = 'autosave';
const AUTOSAVE_KEY = 'current';

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SAVES, { keyPath: 'id' });
      req.result.createObjectStore(AUTOSAVE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // Let a later call try again after a failure (e.g. storage blocked for a moment).
  opening.catch(() => (opening = null));
  return opening;
}

/** Run one request in its own transaction and wait for it to be stored. */
async function run<T>(store: string, mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await db()).transaction(store, mode);
  const req = make(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  });
}

export const listSaves = () => run<SavedCourse[]>(SAVES, 'readonly', (s) => s.getAll());
export const getSave = (id: string) => run<SavedCourse | undefined>(SAVES, 'readonly', (s) => s.get(id));
export const putSave = (save: SavedCourse) => run(SAVES, 'readwrite', (s) => s.put(save));
export const deleteSave = (id: string) => run(SAVES, 'readwrite', (s) => s.delete(id));

export const readAutosave = () => run<Autosave | undefined>(AUTOSAVE, 'readonly', (s) => s.get(AUTOSAVE_KEY));
export const writeAutosave = (save: Autosave) => run(AUTOSAVE, 'readwrite', (s) => s.put(save, AUTOSAVE_KEY));
