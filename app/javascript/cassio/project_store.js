const DB_NAME = "cassio-projects-v1"
const DB_VERSION = 1
const PROJECTS = "projects"

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

export function newProjectId() {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export async function listProjects() {
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECTS, "readonly")
      const req = tx.objectStore(PROJECTS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch {
    return []
  }
}

export async function getProject(id) {
  if (!id) return null
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECTS, "readonly")
      const req = tx.objectStore(PROJECTS).get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function putProject(project) {
  const now = Date.now()
  const row = {
    id: project.id || newProjectId(),
    name: String(project.name || "UNTITLED").trim().slice(0, 18) || "UNTITLED",
    createdAt: project.createdAt || now,
    updatedAt: now,
    state: clone(project.state || {})
  }
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readwrite")
    tx.objectStore(PROJECTS).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return row
}

export async function deleteProject(id) {
  if (!id) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readwrite")
    tx.objectStore(PROJECTS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function collectReferencedSoundIds(value, out = new Set()) {
  if (!value || typeof value !== "object") return out
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedSoundIds(item, out)
    return out
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "soundId" && typeof item === "string") out.add(item)
    else collectReferencedSoundIds(item, out)
  }
  return out
}

function portableReplacer(_key, value) {
  if (value instanceof ArrayBuffer) {
    return { __cassioType: "ArrayBuffer", data: Array.from(new Uint8Array(value)) }
  }
  if (ArrayBuffer.isView(value)) {
    return { __cassioType: value.constructor.name, data: Array.from(value) }
  }
  return value
}

function portableReviver(_key, value) {
  if (!value || typeof value !== "object" || !value.__cassioType || !Array.isArray(value.data)) return value
  if (value.__cassioType === "ArrayBuffer") return new Uint8Array(value.data).buffer
  const ctor = globalThis[value.__cassioType]
  if (typeof ctor === "function" && ctor.BYTES_PER_ELEMENT) return new ctor(value.data)
  return value.data
}

export function makeProjectBundle(project, userSounds = []) {
  const referenced = collectReferencedSoundIds(project?.state)
  return {
    format: "cassio-project-v1",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project?.id || newProjectId(),
      name: project?.name || "UNTITLED",
      createdAt: project?.createdAt || Date.now(),
      updatedAt: project?.updatedAt || Date.now(),
      state: clone(project?.state || {})
    },
    userSounds: (userSounds || []).filter((sound) => referenced.has(sound?.id)).map(clone)
  }
}

export function encodeProjectBundle(bundle) {
  return JSON.stringify(bundle, portableReplacer)
}

export function decodeProjectBundle(text) {
  const bundle = JSON.parse(String(text || ""), portableReviver)
  if (bundle?.format !== "cassio-project-v1" || bundle?.version !== 1 || !bundle?.project?.state) {
    throw new Error("NOT A CASSIO V1 PROJECT")
  }
  return bundle
}

export function cloneProjectState(state) {
  return clone(state)
}
