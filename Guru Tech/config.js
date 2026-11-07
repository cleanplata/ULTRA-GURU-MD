import dotenv from 'dotenv'
import { gunzipSync } from 'node:zlib'

dotenv.config({ path: '.env' })

const DEFAULT_BOT_PIC = 'https://res.cloudinary.com/dqxlb29uz/image/upload/v1780267810/bwm_uploads/media-1780267810008.jpg'
const DEFAULT_CHANNEL_JID = '120363431857319034@newsletter'
const DEFAULT_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDh88NCMY0Fartkxm1g'

function parsePrefixes(prefixStr) {
  if (!prefixStr || prefixStr.trim() === '' || prefixStr.toLowerCase() === 'none') return []
  return prefixStr.split(',').map(p => p.trim()).filter(Boolean)
}

function parseBoolean(value) {
  if (typeof value === 'string') {
    return ['on', 'true', '1', 'yes'].includes(value.toLowerCase())
  }
  return Boolean(value)
}

function parseLids(lidStr) {
  if (!lidStr || lidStr.trim() === '') return []
  return lidStr.split(',').map(l => l.trim()).filter(Boolean).map(l => l.includes('@') ? l : `${l}@lid`)
}

function parseMenuImages(menuImagesStr, fallbackImage) {
  if (!menuImagesStr || menuImagesStr.trim() === '') return fallbackImage ? [fallbackImage] : []
  return menuImagesStr.split(',').map(img => img.trim()).filter(Boolean)
}

function normalizeSession(rawSession) {
  const session = rawSession?.trim()
  if (!session) return null

  let jsonText
  if (session.startsWith('GURU~')) {
    // Current ULTRA-GURU sessions are GURU~ + base64(gzip(creds.json)).
    try {
      jsonText = gunzipSync(Buffer.from(session.slice('GURU~'.length), 'base64')).toString('utf8')
    } catch {
      throw new Error('SESSION_ID has the GURU~ prefix but is not valid gzip/base64 data.')
    }
  } else {
    // Legacy plain SESSION values are base64-encoded creds.json.
    try {
      jsonText = Buffer.from(session, 'base64').toString('utf8')
    } catch {
      throw new Error('SESSION must be base64-encoded credentials, or SESSION_ID must use the GURU~ format.')
    }
  }

  try {
    JSON.parse(jsonText)
  } catch {
    throw new Error('The supplied WhatsApp session decoded, but was not valid credentials JSON.')
  }

  // index.js writes this value to auth/creds.json as UTF-8 bytes.
  return Buffer.from(jsonText, 'utf8').toString('base64')
}

const botPic = process.env.BOT_PIC || DEFAULT_BOT_PIC
const sessionInput = process.env.SESSION?.trim() || process.env.SESSION_ID?.trim() || ''

const CONFIG = {
  MODE: (process.env.MODE || 'private').trim().toLowerCase(),
  PREFIXES: parsePrefixes(process.env.PREFIXES || '.'),
  PORT: parseInt(process.env.PORT, 10) || 3000,
  SESSION: normalizeSession(sessionInput),
  SESSION_FORMAT: !sessionInput ? null : sessionInput.startsWith('GURU~') ? 'GURU~ gzip/base64' : 'base64 creds.json',
  TZ: process.env.TZ || process.env.TIME_ZONE || 'Africa/Nairobi',
  ANTICALL: parseBoolean(process.env.ANTICALL || 'off'),
  ANTIDELETE: parseBoolean(process.env.ANTIDELETE || 'on'),
  ANTIEDIT: parseBoolean(process.env.ANTIEDIT || 'on'),
  AUTO_READ: parseBoolean(process.env.AUTO_READ || 'off'),
  AUTO_VIEW: parseBoolean(process.env.AUTO_VIEW ?? process.env.AUTO_READ_STATUS ?? 'on'),
  AUTO_LIKE: parseBoolean(process.env.AUTO_LIKE ?? process.env.AUTO_LIKE_STATUS ?? 'on'),
  DM_PRESENCE: process.env.DM_PRESENCE || '',
  GRP_PRESENCE: process.env.GRP_PRESENCE || '',
  USER_LID: parseLids(process.env.USER_LID || ''),
  OWNER_NUMBER: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  OWNER_NAME: process.env.OWNER_NAME || 'GuruTech',
  BOT_NAME: process.env.BOT_NAME || 'ULTRA GURU',
  BOT_PIC: botPic,
  BOT_VERSION: process.env.BOT_VERSION || '3.0.0',
  MENU_IMAGES: parseMenuImages(process.env.MENU_IMAGES || '', botPic),
  CHANNEL_JID: process.env.CHANNEL_JID || process.env.NEWSLETTER_JID || DEFAULT_CHANNEL_JID,
  CHANNEL_URL: process.env.CHANNEL_URL || process.env.NEWSLETTER_URL || DEFAULT_CHANNEL_URL,
  HOSTING_URL: process.env.HOSTING_URL || 'https://cheap.bothosting.gurutech.top',
  HOSTING_PROVIDER: process.env.HOSTING_PROVIDER || 'Bothosting',
  GITHUB_REPO: process.env.GITHUB_REPO || 'GuruhTech/ULTRA-GURU',
}

export { normalizeSession }
export default CONFIG
