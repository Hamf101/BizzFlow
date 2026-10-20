import type { UnsentStore } from "./live-session"

const DATABASE = "bizflow-offline"
const STORE = "unsent"

/**
 * One room's unsent changes in this browser's IndexedDB, kept per member and
 * per tab, so edits made offline survive closing the tab and go out when the
 * document next opens. Each tab writes only its own entry, so two tabs never
 * overwrite each other; opening the room takes in every tab's leftovers, and
 * once this tab's changes are all kept, it clears the entries it took in.
 * Where IndexedDB is missing or refuses (a private window), it keeps nothing
 * and the editor works as before.
 *
 * @param key - The member and room, as `userId:roomId`.
 * @returns The store.
 */
export function createUnsentStore(key: string): UnsentStore {
  const own = `${key}:${crypto.randomUUID()}`
  // Every tab's entry, and the one shared entry this store kept before it kept one per tab.
  const range = IDBKeyRange.bound(key, `${key}:\uffff`)
  let adopted: IDBValidKey[] = []

  return {
    load: async () => {
      let keys: IDBValidKey[] = []
      const values = (await run("readonly", (store) => {
        store.getAllKeys(range).onsuccess = (event) => {
          keys = (event.target as IDBRequest<IDBValidKey[]>).result
        }
        return store.getAll(range)
      })) as Uint8Array[][]
      adopted = keys

      return values.flat()
    },
    save: async (updates) => {
      await run("readwrite", (store) => {
        if (updates.length > 0) {
          return store.put([...updates], own)
        }

        // ponytail: an offline tab still open that wrote again since we took its entry loses that write here unless it changes once more; a per-entry version check if that ever matters
        adopted.forEach((other) => store.delete(other))
        adopted = []
        return store.delete(own)
      })
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
    const transaction = database.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
  })
}
