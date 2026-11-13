import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SETTINGS_FILE = process.env.RUNTIME_SETTINGS_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'runtime-settings.json')
const ALLOWED_KEYS = new Set(['ANTICALL', 'AUTOBLOCK'])
let loaded = false
let stored = {}

function readSettings() {
  if (loaded) return stored
  loaded = true
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed
  } catch {
    stored = {}
  }
  return stored
}

function writeSettings() {
  const dir = path.dirname(SETTINGS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  const temp = `${SETTINGS_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(stored, null, 2), { mode: 0o600 })
  fs.renameSync(temp, SETTINGS_FILE)
}

export function applyRuntimeSettings(config) {
  const current = readSettings()
  for (const key of ALLOWED_KEYS) {
    if (typeof current[key] === 'boolean') config[key] = current[key]
  }
  return config
}

export function updateRuntimeSettings(config, patch) {
  readSettings()
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== 'boolean') throw new TypeError(`Unsupported runtime setting: ${key}`)
    stored[key] = value
    config[key] = value
  }
  writeSettings()
  return { ...stored }
}
