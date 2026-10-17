import type { UnsentStore } from "./live-session"

const DATABASE = "bizflow-offline"
const STORE = "unsent"

/**
 * One room's unsent changes in this browser's IndexedDB, kept per member, so
 * edits made offline survive closing the tab and go out when the document
 * next opens. Where IndexedDB is missing or refuses (a private window), it
 * keeps nothing and the editor works as before.
 *
 * @param key - The member and room, as `userId:roomId`.
 * @returns The store.
 */
export function createUnsentStore(key: string): UnsentStore {
  return {
    load: async () => ((await run("readonly", (store) => store.get(key))) as Uint8Array[] | undefined) ?? [],
    save: async (updates) => {
      await run("readwrite", (store) => (updates.length > 0 ? store.put([...updates], key) : store.delete(key)))
    },
  }
}

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    opening = null
    throw error
  })

  return opening
}

async function run(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const database = await open()

  return new Promise((resolve, reject) => {
    const request = action(database.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
