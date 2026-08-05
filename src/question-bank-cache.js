const DB_NAME = "sizheng-question-bank-cache";
const STORE_NAME = "course-banks";
const DB_VERSION = 1;

function cacheKey(userId, courseId, contentHash) {
  return `${userId}:${courseId}:${contentHash}`;
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex("user_id", "user_id", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
    try {
      result = callback(store);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function requestResult(mode, callback) {
  return withStore(mode, (transactionStore) => {
    return callback(transactionStore);
  }).then((request) => request.result);
}

export async function getCourseQuestionCache({ userId, courseId, contentHash }) {
  const key = cacheKey(userId, courseId, contentHash);
  return requestResult("readonly", (store) => store.get(key));
}

export async function putCourseQuestionCache({ userId, courseId, contentHash, choices, essays }) {
  const record = {
    key: cacheKey(userId, courseId, contentHash),
    user_id: userId,
    course_id: courseId,
    content_hash: contentHash,
    choices,
    essays,
    stored_at: new Date().toISOString()
  };
  await requestResult("readwrite", (store) => store.put(record));
}

export async function deleteUserQuestionCaches(userId) {
  if (!userId) return;
  await withStore("readwrite", (store) => {
    const index = store.index("user_id");
    const request = index.openKeyCursor(IDBKeyRange.only(userId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    return request;
  });
}
