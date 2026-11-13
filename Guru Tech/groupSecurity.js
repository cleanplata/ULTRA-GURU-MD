import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_FILE = process.env.GROUP_SECURITY_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'group-security.json')
const DEFAULTS = Object.freeze({
  antiBot: { enabled: false, botJids: [] },
  antiLink: { enabled: false, action: 'delete', sensitivity: 'high', allowedDomains: [] },
  slowmodeSeconds: 0,
  rules: '',
  warnings: {},
  reports: []
})
const lastSlowmodeMessage = new Map()
const noticeCooldown = new Map()
const seenSecurityMessages = new Map()
const groupMetadataCache = new Map()
let store

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function normalizeJid(jid) {
  if (!jid) return ''
  const value = String(jid).trim()
  const colon = value.indexOf(':')
  if (colon >= 0) return `${value.slice(0, colon)}@${value.slice(value.indexOf('@') + 1)}`
  return value
}

function loadStore() {
  if (store) return store
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    store = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    store = {}
  }
  return store
}

function saveStore() {
  const directory = path.dirname(DATA_FILE)
  fs.mkdirSync(directory, { recursive: true })
  const temp = `${DATA_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(loadStore(), null, 2), { mode: 0o600 })
  fs.renameSync(temp, DATA_FILE)
}

function withDefaults(input = {}) {
  return {
    ...clone(DEFAULTS),
    ...input,
    antiBot: { ...clone(DEFAULTS.antiBot), ...(input.antiBot || {}) },
    antiLink: { ...clone(DEFAULTS.antiLink), ...(input.antiLink || {}) },
    warnings: input.warnings && typeof input.warnings === 'object' ? input.warnings : {},
    reports: Array.isArray(input.reports) ? input.reports : []
  }
}

export function getGroupSecurity(groupJid) {
  if (!groupJid) return clone(DEFAULTS)
  const current = loadStore()[groupJid]
  return withDefaults(current)
}

export function updateGroupSecurity(groupJid, updater) {
  if (!groupJid || typeof updater !== 'function') throw new TypeError('A group JID and update callback are required.')
  const database = loadStore()
  const current = withDefaults(database[groupJid])
  updater(current)
  database[groupJid] = withDefaults(current)
  saveStore()
  return clone(database[groupJid])
}

function participantIds(participant) {
  return [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber]
    .filter(Boolean).map(normalizeJid)
}

function findParticipant(metadata, jid) {
  const target = normalizeJid(jid)
  if (!target) return null
  return (metadata?.participants || []).find(participant => participantIds(participant).includes(target)) || null
}

export async function getGroupRoles(sock, groupJid, senderJid) {
  const cached = groupMetadataCache.get(groupJid)
  let metadata = cached && cached.expiresAt > Date.now() ? cached.value : null
  if (!metadata) {
    metadata = await sock.groupMetadata(groupJid)
    groupMetadataCache.set(groupJid, { value: metadata, expiresAt: Date.now() + 20_000 })
    if (groupMetadataCache.size > 500) {
      const now = Date.now()
      for (const [jid, entry] of groupMetadataCache) {
        if (entry.expiresAt <= now) groupMetadataCache.delete(jid)
      }
      while (groupMetadataCache.size > 400) groupMetadataCache.delete(groupMetadataCache.keys().next().value)
    }
  }
  const sender = findParticipant(metadata, senderJid)
  const bot = findParticipant(metadata, sock.user?.id) || findParticipant(metadata, sock.user?.lid)
  return {
    metadata,
    senderIsAdmin: Boolean(sender?.admin),
    botIsAdmin: Boolean(bot?.admin),
    senderParticipant: sender
  }
}

function getContextInfo(message) {
  const content = message?.message || {}
  return content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo || content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo || content.audioMessage?.contextInfo ||
    content.stickerMessage?.contextInfo || content.buttonsResponseMessage?.contextInfo || null
}

function messageText(message) {
  const content = message?.message || {}
  return content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption ||
    content.documentMessage?.caption || ''
}

function normalizeLinkText(text, sensitivity) {
  let normalized = String(text || '').normalize('NFKC')
    .replace(/[\u200B-\u200F\uFEFF\u2060]/g, '')
    .replace(/\bhxxps?\b/gi, value => value.toLowerCase().startsWith('hxxps') ? 'https' : 'http')
  if (sensitivity === 'strict') {
    normalized = normalized
      .replace(/\[\s*(?:dot|\.)\s*\]|\(\s*(?:dot|\.)\s*\)|\s+dot\s+/gi, '.')
      .replace(/\[\s*:\s*\]|\(\s*:\s*\)/g, ':')
      .replace(/\s*\.\s*/g, '.')
  }
  return normalized
}

const DOMAIN_PATTERN = /(?:^|[^\w@])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|info|biz|io|co|uk|us|ca|au|nz|in|ng|za|ke|tz|ug|app|dev|xyz|online|site|store|me|tv|gg|ai|edu|gov|mil|mobi|pro|tech|club|live)(?:\b|\/|\?|#)/i

export function containsLink(text, sensitivity = 'high', allowedDomains = []) {
  const level = ['normal', 'high', 'strict'].includes(sensitivity) ? sensitivity : 'high'
  let normalized = normalizeLinkText(text, level)
  for (const domain of allowedDomains || []) {
    const escaped = String(domain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (escaped) {
      const allowedHost = new RegExp(`(^|[^a-z0-9-])(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*${escaped}(?![a-z0-9.-])(?::\\d+)?(?:[/?#][^\\s]*)?`, 'ig')
      normalized = normalized.replace(allowedHost, '$1 ')
    }
  }
  normalized = normalized.replace(/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ')
  if (/(?:https?:\/\/|www\.)\S+/i.test(normalized)) return true
  if (/(?:chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me|t\.me|telegram\.me)\s*\/?/i.test(normalized)) return true
  if (level !== 'normal' && DOMAIN_PATTERN.test(normalized)) return true
  if (level === 'strict' && /(?:\b[a-z0-9-]+\s*\.\s*[a-z]{2,}\b)/i.test(normalized)) return true
  return false
}

export function recordGroupWarning(groupJid, targetJid, { by = 'ULTRA GURU', reason = 'Group rule violation' } = {}) {
  const target = normalizeJid(targetJid)
  if (!target) return []
  let output = []
  updateGroupSecurity(groupJid, state => {
    const key = target
    const rows = Array.isArray(state.warnings[key]) ? state.warnings[key] : []
    rows.push({ by: normalizeJid(by) || by, reason: String(reason).slice(0, 240), at: Date.now() })
    state.warnings[key] = rows.slice(-50)
    output = state.warnings[key]
  })
  return output
}

export function clearGroupWarnings(groupJid, targetJid) {
  const target = normalizeJid(targetJid)
  return updateGroupSecurity(groupJid, state => { if (target) delete state.warnings[target] })
}

export function addGroupReport(groupJid, report) {
  let saved
  updateGroupSecurity(groupJid, state => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    saved = { id, reporter: normalizeJid(report.reporter), text: String(report.text || '').slice(0, 1000), at: Date.now(), status: 'open' }
    state.reports.push(saved)
    state.reports = state.reports.slice(-100)
  })
  return saved
}

export function clearGroupReports(groupJid) {
  return updateGroupSecurity(groupJid, state => { state.reports = [] })
}

function startsWithConfiguredPrefix(text, prefixes = []) {
  const trimmed = String(text || '').trimStart()
  return prefixes.some(prefix => prefix && trimmed.startsWith(prefix) && trimmed.length > prefix.length)
}

function noticeAllowed(key, interval = 30_000) {
  const now = Date.now()
  const last = noticeCooldown.get(key) || 0
  if (now - last < interval) return false
  noticeCooldown.set(key, now)
  return true
}

async function deleteGroupMessage(sock, groupJid, msg) {
  try {
    await sock.sendMessage(groupJid, { delete: msg.key })
    return true
  } catch (error) {
    console.warn(`[GROUP SECURITY] Could not delete message in ${groupJid}: ${error.message}`)
    return false
  }
}

export async function handleGroupSecurityMessage({ sock, msg, groupJid, senderJid, body, prefixes = [], isOwnCommandText = () => false }) {
  if (!groupJid?.endsWith('@g.us') || msg?.key?.fromMe) return false
  const state = getGroupSecurity(groupJid)
  const antiBotEnabled = Boolean(state.antiBot.enabled)
  const antiLinkEnabled = Boolean(state.antiLink.enabled)
  const slowmodeSeconds = Math.max(0, Math.min(3600, Number(state.slowmodeSeconds) || 0))
  if (!antiBotEnabled && !antiLinkEnabled && !slowmodeSeconds) return false

  const messageId = msg?.key?.id
  if (messageId) {
    const key = `${groupJid}:${messageId}`
    if (seenSecurityMessages.has(key)) return false
    seenSecurityMessages.set(key, Date.now())
    if (seenSecurityMessages.size > 1500) {
      const oldest = [...seenSecurityMessages.entries()].sort((a, b) => a[1] - b[1]).slice(0, 300)
      for (const [oldKey] of oldest) seenSecurityMessages.delete(oldKey)
    }
  }

  let roles
  try { roles = await getGroupRoles(sock, groupJid, senderJid) }
  catch (error) {
    console.warn(`[GROUP SECURITY] Could not read group members in ${groupJid}: ${error.message}`)
    return false
  }
  const sender = normalizeJid(senderJid)
  const knownBot = (state.antiBot.botJids || []).map(normalizeJid).includes(sender)
  const isAdmin = roles.senderIsAdmin && !knownBot
  const context = getContextInfo(msg)
  const quotedText = context?.quotedMessage?.conversation || context?.quotedMessage?.extendedTextMessage?.text ||
    context?.quotedMessage?.imageMessage?.caption || context?.quotedMessage?.videoMessage?.caption || ''
  const quotedSenderIsKnownBot = (state.antiBot.botJids || []).map(normalizeJid).includes(normalizeJid(context?.participant))
  const messageBody = String(body || messageText(msg) || '')
  const ownCommand = Boolean(messageBody && isOwnCommandText(messageBody))
  const externalCommand = startsWithConfiguredPrefix(messageBody, prefixes) && !ownCommand
  const replyToExternalCommand = startsWithConfiguredPrefix(quotedText, prefixes) && !isOwnCommandText(quotedText)

  if (antiBotEnabled && (knownBot || quotedSenderIsKnownBot || externalCommand || replyToExternalCommand) && !isAdmin) {
    const removed = await deleteGroupMessage(sock, groupJid, msg)
    if (!removed && noticeAllowed(`bot-permission:${groupJid}`)) {
      await sock.sendMessage(groupJid, { text: '⚠️ Anti-bot detected a command or known bot message, but I could not remove it. Make ULTRA GURU a group admin with message-deletion permission.' })
    }
    return true
  }

  if (antiLinkEnabled && !isAdmin && messageBody && containsLink(messageBody, state.antiLink.sensitivity, state.antiLink.allowedDomains)) {
    const action = ['warn', 'delete', 'kick'].includes(state.antiLink.action) ? state.antiLink.action : 'warn'
    if (action === 'warn') {
      const warnings = recordGroupWarning(groupJid, sender, { reason: 'Posted a link' })
      await sock.sendMessage(groupJid, {
        text: `⚠️ @${sender.split('@')[0]}: links are not allowed here. Warning #${warnings.length}.`,
        mentions: [sender]
      })
    } else {
      const removed = await deleteGroupMessage(sock, groupJid, msg)
      let kicked = action !== 'kick'
      if (action === 'kick') {
        try { await sock.groupParticipantsUpdate(groupJid, [sender], 'remove'); kicked = true }
        catch (error) { kicked = false; console.warn(`[GROUP SECURITY] Could not remove link sender ${sender}: ${error.message}`) }
      }
      if (noticeAllowed(`link:${groupJid}:${sender}`)) {
        await sock.sendMessage(groupJid, {
          text: action === 'kick' && kicked
            ? `⛔ @${sender.split('@')[0]} was removed for posting a link.`
            : !removed
              ? `⚠️ @${sender.split('@')[0]}: I could not remove that link. Make ULTRA GURU a group admin.`
              : action === 'kick'
                ? `⚠️ @${sender.split('@')[0]}: the link was removed, but I could not remove the member.`
                : `⚠️ @${sender.split('@')[0]}: the link was removed.`,
          mentions: [sender]
        })
      }
    }
    return true
  }

  if (slowmodeSeconds > 0 && !isAdmin) {
    const key = `${groupJid}:${sender}`
    const now = Date.now()
    const last = lastSlowmodeMessage.get(key) || 0
    if (now - last < slowmodeSeconds * 1000) {
      const removed = await deleteGroupMessage(sock, groupJid, msg)
      if (noticeAllowed(`slowmode:${key}`, Math.min(slowmodeSeconds * 1000, 60_000))) {
        const wait = Math.max(1, Math.ceil((slowmodeSeconds * 1000 - (now - last)) / 1000))
        await sock.sendMessage(groupJid, { text: removed ? `⏳ Slow mode is active. Please wait ${wait}s before sending again.` : '⚠️ Slow mode is active, but I could not remove the message. Make ULTRA GURU a group admin.', mentions: [sender] })
      }
      return true
    }
    lastSlowmodeMessage.set(key, now)
  }

  return false
}
