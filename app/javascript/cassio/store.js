const DB_NAME = "cassio-v1"
const DB_VERSION = 2
const RECOVERY = "recovery"
const USER_SOUNDS = "userSounds"
const FAVORITES = "favorites"
const RECOVERY_KEY = "last-project"

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RECOVERY)) db.createObjectStore(RECOVERY)
      if (!db.objectStoreNames.contains(USER_SOUNDS)) db.createObjectStore(USER_SOUNDS, { keyPath: "id" })
      if (!db.objectStoreNames.contains(FAVORITES)) db.createObjectStore(FAVORITES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadRecovery() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY, "readonly")
      const req = tx.objectStore(RECOVERY).get(RECOVERY_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function saveRecovery(state) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY, "readwrite")
      tx.objectStore(RECOVERY).put({ ...state, updatedAt: Date.now() }, RECOVERY_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* ignore */
  }
}

export async function listUserSounds() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(USER_SOUNDS, "readonly")
      const req = tx.objectStore(USER_SOUNDS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function getUserSound(id) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(USER_SOUNDS, "readonly")
      const req = tx.objectStore(USER_SOUNDS).get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function putUserSound(sound) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SOUNDS, "readwrite")
    tx.objectStore(USER_SOUNDS).put(sound)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return sound
}

export async function deleteUserSound(id) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SOUNDS, "readwrite")
    tx.objectStore(USER_SOUNDS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadFavorites() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FAVORITES, "readonly")
      const req = tx.objectStore(FAVORITES).get("ids")
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveFavorites(ids) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FAVORITES, "readwrite")
      tx.objectStore(FAVORITES).put(ids, "ids")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* ignore */
  }
}

export function defaultPads() {
  return [
    { pad: 1, soundId: "kick-01", level: 1, pan: 0, mode: "gate" },
    { pad: 2, soundId: null, level: 1, pan: 0, mode: "gate" },
    { pad: 3, soundId: "snare-01", level: 1, pan: 0, mode: "gate" },
    { pad: 4, soundId: null, level: 1, pan: 0, mode: "gate" },
    { pad: 5, soundId: "hat-01", level: 1, pan: 0, mode: "gate" },
    { pad: 6, soundId: null, level: 1, pan: 0, mode: "gate" }
  ]
}

export function defaultProject() {
  return {
    bpm: 120,
    soundId: "glass-poly",
    octave: 0,
    hold: false,
    masterVolume: 0.7,
    brightness: 0.68,
    resonance: 0.34,
    attack: 0.018,
    release: 0.48,
    bassDb: 0,
    trebleDb: 0,
    space: 0.24,
    delay: 0,
    root: "C3",
    pads: defaultPads()
  }
}
