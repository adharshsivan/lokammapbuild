export interface SavedReference {
  data: string;
  name: string;
  width: number;
  height: number;
}

function openReferenceStore(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('islandforge-reference',1);
    request.onupgradeneeded = () => request.result.createObjectStore('references');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReference(reference: SavedReference) {
  const database = await openReferenceStore();
  try {
    await new Promise<void>((resolve,reject) => {
      const transaction = database.transaction('references','readwrite');
      transaction.objectStore('references').put(reference,'coastal-island');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export async function loadReference(): Promise<SavedReference | null> {
  const database = await openReferenceStore();
  try {
    return await new Promise((resolve,reject) => {
      const request = database.transaction('references','readonly').objectStore('references').get('coastal-island');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}