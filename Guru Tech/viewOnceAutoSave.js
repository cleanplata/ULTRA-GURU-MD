// ════════════════════════════════════════════════════════════════════════════
//  AUTO-SAVE VIEW-ONCE MEDIA
//
//  Ported from the older ULTRA-GURU-MD-main (guru/gmdFunctions2.js's
//  setupVVTracker), rewritten for this project's ESM/Baileys setup.
//
//  Two independent triggers, either one saves the media privately to
//  whoever triggered it:
//    1. REACT  — react with any emoji to a view-once message.
//    2. REPLY  — reply to a view-once message with anything at all.
//
//  This runs as its own "messages.upsert" listener, separate from command
//  dispatch, so it doesn't require a command prefix and doesn't interfere
//  with normal commands (including a reply that happens to also be a
//  command — both still run).
// ════════════════════════════════════════════════════════════════════════════

import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { messageStore } from './anti.js'
import CONFIG from './config.js'

function cleanJid(jid) {
  if (!jid) return null
  if (jid.includes(':')) {
    const parts = jid.split(':')
    return parts[0] + '@' + parts[1].split('@')[1]
  }
  return jid
}

function isViewOnceContent(content) {
  if (!content) return false
  if (content.imageMessage?.viewOnce) return true
  if (content.videoMessage?.viewOnce) return true
  if (content.audioMessage?.viewOnce) return true
  if (content.viewOnceMessage) return true
  if (content.viewOnceMessageV2) return true
  if (content.viewOnceMessageV2Extension) return true
  return false
}

// Returns { type: 'imageMessage' | 'videoMessage' | 'audioMessage', media } or null.
function extractViewOnceMedia(content) {
  if (!content) return null

  for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
    if (content[type]?.viewOnce) return { type, media: content[type] }
  }

  for (const wrapper of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
    const inner = content[wrapper]?.message
    if (!inner) continue
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
      if (inner[type]) return { type, media: inner[type] }
    }
  }

  return null
}

function extractContextInfo(content) {
  return (
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.audioMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.stickerMessage?.contextInfo ||
    content?.buttonsResponseMessage?.contextInfo ||
    content?.listResponseMessage?.contextInfo ||
    content?.contextInfo ||
    null
  )
}

const shortTypeLabel = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' }

async function deliverViewOnceMedia(sock, { type, media }, targetJid, triggeredByNum) {
  const kind = shortTypeLabel[type]
  if (!kind) return

  const stream = await downloadContentFromMessage(media, kind)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  if (!buffer.length) return

  const originalCaption = media.caption || ''
  const botName = CONFIG.BOT_NAME || 'ULTRA GURU'
  const caption = [
    '👁️ *VIEW-ONCE SAVED*',
    originalCaption ? `📝 ${originalCaption}` : null,
    `> _Saved by ${botName}_`
  ].filter(Boolean).join('\n')

  if (kind === 'image') {
    await sock.sendMessage(targetJid, { image: buffer, caption, mimetype: media.mimetype })
  } else if (kind === 'video') {
    await sock.sendMessage(targetJid, { video: buffer, caption, mimetype: media.mimetype })
  } else if (kind === 'audio') {
    await sock.sendMessage(targetJid, { audio: buffer, mimetype: media.mimetype || 'audio/mp4', ptt: true })
  }
}

const installedSockets = new WeakSet()

export function installViewOnceAutoSave(sock) {
  if (installedSockets.has(sock)) return
  installedSockets.add(sock)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        const content = msg?.message
        if (!content) continue
        if (msg.key.remoteJid === 'status@broadcast') continue

        const botNum = cleanJid(sock.user?.id)?.split('@')[0]?.split(':')[0]
        // Who to send the saved media to: whoever reacted/replied. If that
        // was the bot's own account (you reacted/replied yourself), send to
        // your own DM rather than back into the chat you reacted in.
        const triggeredByNum = msg.key.fromMe
          ? botNum
          : cleanJid(msg.key.participant || msg.key.remoteJid)?.split('@')[0]?.split(':')[0]
        if (!triggeredByNum) continue
        const targetJid = `${triggeredByNum}@s.whatsapp.net`

        // ── Trigger 1: reacted to a message ──────────────────────────────
        if (content.reactionMessage) {
          const reactedId = content.reactionMessage.key?.id
          if (!reactedId) continue
          const original = messageStore.get(reactedId)
          const originalContent = original?.message
          if (!isViewOnceContent(originalContent)) continue
          const vo = extractViewOnceMedia(originalContent)
          if (!vo) continue
          await deliverViewOnceMedia(sock, vo, targetJid, triggeredByNum)
          continue
        }

        // ── Trigger 2: replied to a message ──────────────────────────────
        const contextInfo = extractContextInfo(content)
        if (!contextInfo?.stanzaId) continue

        // WhatsApp strips the viewOnce flag from contextInfo.quotedMessage,
        // so the original as we stored it is the one worth trusting; the
        // quoted copy is only a fallback for messages we never saw/stored.
        const stored = messageStore.get(contextInfo.stanzaId)
        const sourceContent = stored?.message || contextInfo.quotedMessage
        if (!isViewOnceContent(sourceContent)) continue
        const vo = extractViewOnceMedia(sourceContent)
        if (!vo) continue
        await deliverViewOnceMedia(sock, vo, targetJid, triggeredByNum)
      } catch (err) {
        console.error('[VO-AUTOSAVE] Error:', err.message)
      }
    }
  })
}
