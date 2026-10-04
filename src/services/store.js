/*
 * 作業中のプロジェクトを 1 つだけ IndexedDB に保存し、次回開いたときに続きから再開できるようにする。
 * - meta ストア: 'project' キーにプロジェクトの JSON
 * - photos ストア: 写真 ID → 元画像の Blob
 * IndexedDB が使えない環境 (一部のプライベートブラウズなど) では保存せずに動く。
 */

const DB_NAME = 'photo-collage';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta');
      db.createObjectStore('photos');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(work(tx)).then((value) => { result = value; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function loadProject() {
  try {
    return (await run(['meta'], 'readonly', (tx) => requestValue(tx.objectStore('meta').get('project')))) ?? null;
  } catch {
    return null;
  }
}

export async function getPhotoBlob(id) {
  try {
    return (await run(['photos'], 'readonly', (tx) => requestValue(tx.objectStore('photos').get(id)))) ?? null;
  } catch {
    return null;
  }
}

/** 写真の元画像を保存する。保存できなくても作業は続けられるので、失敗は false で返す。 */
export async function putPhotos(photos) {
  try {
    await run(['photos'], 'readwrite', (tx) => {
      const store = tx.objectStore('photos');
      for (const photo of photos) store.put(photo.blob, photo.id);
    });
    return true;
  } catch (error) {
    console.warn('写真の保存に失敗', error);
    return false;
  }
}

export async function deletePhotos(ids) {
  try {
    await run(['photos'], 'readwrite', (tx) => {
      const store = tx.objectStore('photos');
      for (const id of ids) store.delete(id);
    });
  } catch {
    // 保存できない環境では何もしない
  }
}

/** 保存済みのプロジェクトと写真をすべて削除する */
export async function clearAll() {
  cancelScheduledSave();
  try {
    await run(['meta', 'photos'], 'readwrite', (tx) => {
      tx.objectStore('meta').clear();
      tx.objectStore('photos').clear();
    });
  } catch {
    // 保存できない環境では何もしない
  }
}

// MARK: 自動保存 (連続した変更をまとめて書き込む)

let saveTimer = 0;
let pendingJSON = null;

async function writeProject(json) {
  try {
    await run(['meta'], 'readwrite', (tx) => { tx.objectStore('meta').put(json, 'project'); });
  } catch (error) {
    console.warn('プロジェクトの保存に失敗', error);
  }
}

export function scheduleSave(getJSON) {
  pendingJSON = getJSON;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

export function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingJSON) return;
  const json = pendingJSON();
  pendingJSON = null;
  writeProject(json);
}

function cancelScheduledSave() {
  clearTimeout(saveTimer);
  pendingJSON = null;
}

// タブを閉じる・切り替えるときは待たずに書き込む
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
addEventListener('pagehide', flushSave);
