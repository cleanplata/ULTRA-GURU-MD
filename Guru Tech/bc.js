import moment from 'moment-timezone'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import CONFIG from './config.js'
import { chooseStatusReactionEmoji } from './statusReactions.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const seenStatusIds = new Set()
const STATUS_VIEW_MAX_RETRIES = 3
const STATUS_VIEW_RETRY_BASE_MS = 1000
const STATUS_LIKE_TIMEOUT_MS = 25000
const STATUS_LIKE_QUEUE_LIMIT = 10
// Optional legacy custom pool; otherwise the Toxic-MD 25-emoji pool is used.
const STATUS_LIKE_EMOJIS = (process.env.STATUS_LIKE_EMOJIS || '')
  .split(',').map(e => e.trim()).filter(Boolean)
const statusLikeQueue = []
let statusLikeBusy = false

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function withTimeout(operation, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function pumpStatusLikeQueue() {
  if (statusLikeBusy) return
  statusLikeBusy = true
  try {
    while (statusLikeQueue.length) {
      const job = statusLikeQueue.shift()
      // WhatsApp only delivers a status reaction when the recipient list contains
      // the poster AND the bot's own account (phone JID and LID forms).
      const recipients = new Set()
      const addJid = jid => {
        if (typeof jid === 'string' && jid && jid !== 'status@broadcast') {
          recipients.add(jid.replace(/:\d+@/, '@'))
        }
      }
      addJid(job.participant)
      addJid(job.key?.participant)
      addJid(job.sock.user?.id)
      addJid(job.sock.user?.lid)

      let liked = false
      for (let attempt = 1; attempt <= 2 && !liked; attempt++) {
        try {
          await withTimeout(
            () => job.sock.sendMessage('status@broadcast', {
              react: { text: job.emoji, key: job.key }
            }, { statusJidList: [...recipients] }),
            STATUS_LIKE_TIMEOUT_MS,
            'status like timed out'
          )
          liked = true
          await job.sock.readMessages([job.key]).catch(() => {})
          console.log(`${job.emoji} Reacted to status from: ${job.participant}`)
        } catch (error) {
          console.warn(`⚠️ Status reaction attempt ${attempt} failed: ${error.message}`)
          if (attempt < 2) await wait(1500)
        }
      }
    }
  } finally {
    statusLikeBusy = false
  }
}

function enqueueStatusLike(sock, key, participant) {
  if (!participant || participant === 'Unknown') return
  if (statusLikeQueue.length >= STATUS_LIKE_QUEUE_LIMIT) {
    console.warn('⚠️ Status like queue full; skipping reaction')
    return
  }
  const emoji = chooseStatusReactionEmoji(CONFIG.STATUS_LIKE_EMOJI, Math.random, STATUS_LIKE_EMOJIS)
  statusLikeQueue.push({ sock, key, participant, emoji })
  void pumpStatusLikeQueue()
}

export function logStatus(participant, messageId, pushName, statusType = 'unknown', caption = '') {
  const timestamp = moment().tz(CONFIG.TZ).format('DD/MM/YYYY HH:mm:ss')
  const userPhone = getStatusUserPhone(participant)
  const formattedPhone = formatPhoneNumber(userPhone)

  console.log(`\n[📅 ${timestamp}] [📊 STATUS UPDATE]`)
  console.log(`├─ 👤 From: ${pushName || 'Unknown'} (${formattedPhone})`)
  console.log(`├─ 🔑 JID: ${participant}`)
  console.log(`├─ 🆔 Message ID: ${messageId}`)
  console.log(`├─ 📎 Type: ${statusType}`)
  if (caption) console.log(`├─ 📝 Content: ${caption.substring(0, 100)}`)
  console.log(`├─ 👁️ Auto View: ${CONFIG.AUTO_VIEW === true ? '✅ ON' : '❌ OFF'}`)
  console.log(`├─ ❤️ Auto Like: ${CONFIG.AUTO_LIKE === true ? '✅ ON' : '❌ OFF'}`)
  console.log(`└─ 📖 Auto Read: ${CONFIG.AUTO_READ === true ? '✅ ON' : '❌ OFF'}\n`)
}

export function getStatusUserPhone(statusJid) {
  if (!statusJid) return 'Unknown'
  return statusJid.split('@')[0]
}

function formatPhoneNumber(phone) {
  if (!phone || phone === 'Unknown') return 'Unknown'
  const cleaned = phone.replace(/[^\d+]/g, '')
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

export async function processStatusMessage(msg, sock) {
  if (!msg?.key || !msg.message || (msg.key.remoteJid !== 'status@broadcast' && msg.key.remoteJidAlt !== 'status@broadcast')) return
  if (!msg.key.id || msg.message?.protocolMessage) return

  if (msg.key.fromMe === true) return

  const id = msg.key.id
  if (seenStatusIds.has(id)) return

  const resolvedParticipant = [
    msg.key.participantPn,
    msg.key.participantAlt,
    msg.participant,
    msg.key.participant,
    msg.key.remoteJidAlt
  ].find(jid => typeof jid === 'string' && jid && jid !== 'status@broadcast')
  const resolvedKey = {
    ...msg.key,
    remoteJid: 'status@broadcast',
    ...(resolvedParticipant ? { participant: resolvedParticipant } : {})
  }

  const statusPosterJid = resolvedParticipant || (msg.key.remoteJidAlt !== 'status@broadcast' ? msg.key.remoteJidAlt : null) || 'Unknown'
  let statusType = 'unknown'
  let statusCaption = ''

  try {
    if (msg.message?.imageMessage) {
      statusType = 'image'
      statusCaption = msg.message.imageMessage.caption || ''
    } else if (msg.message?.videoMessage) {
      statusType = 'video'
      statusCaption = msg.message.videoMessage.caption || ''
    } else if (msg.message?.conversation) {
      statusType = 'text'
      statusCaption = msg.message.conversation
    } else if (msg.message?.extendedTextMessage) {
      statusType = 'text'
      statusCaption = msg.message.extendedTextMessage.text || ''
    } else if (msg.message?.audioMessage) {
      statusType = 'audio'
    } else if (msg.message?.documentMessage) {
      statusType = 'document'
    }

    if (CONFIG.AUTO_VIEW === true && !resolvedParticipant) {
      console.warn(`⚠️ Status ${id} arrived without a participant JID; skipping read receipt.`)
    } else if (CONFIG.AUTO_VIEW === true && !(CONFIG.AUTO_LIKE === true && statusPosterJid !== 'Unknown')) {
      let viewError
      for (let attempt = 1; attempt <= STATUS_VIEW_MAX_RETRIES; attempt++) {
        try {
          // Like Mini Bot, read receipts do not require changing online/offline presence.
          await sock.readMessages([resolvedKey])
          console.log(`✅ Viewed status: ${statusPosterJid.split('@')[0]} [${id}]`)
          viewError = null
          break
        } catch (error) {
          viewError = error
          if (attempt < STATUS_VIEW_MAX_RETRIES) {
            console.warn(`⚠️ Status view attempt ${attempt} failed; retrying: ${error.message}`)
            await wait(STATUS_VIEW_RETRY_BASE_MS * attempt)
          }
        }
      }
      if (viewError) console.error(`❌ Failed to view status ${id} after ${STATUS_VIEW_MAX_RETRIES} attempts: ${viewError.message}`)
    }

    if (CONFIG.AUTO_LIKE === true && statusPosterJid !== 'Unknown') {
      const reactKey = { ...msg.key, remoteJid: 'status@broadcast', participant: msg.key.participant || resolvedParticipant }
      setTimeout(() => enqueueStatusLike(sock, reactKey, statusPosterJid), 2000)
    }

    seenStatusIds.add(id)
    if (seenStatusIds.size > 1000) {
      const firstKey = seenStatusIds.values().next().value
      seenStatusIds.delete(firstKey)
    }

    let senderName = msg.pushName || 'Unknown'
    if (statusPosterJid !== 'Unknown') {
      try {
        const contact = await sock.onWhatsApp(statusPosterJid)
        if (contact && contact[0]) {
          senderName = contact[0].notify || senderName
        }
      } catch {}
    }

    logStatus(statusPosterJid, id, senderName, statusType, statusCaption)

  } catch (err) {
    console.error('[AUTO-VIEW] Error viewing status:', err)
  }
}

export async function handleStatusReply(msg, sock, senderJid) {
  const tempDir = '/tmp/ultra-guru-temp'
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    const quotedMsg = contextInfo?.quotedMessage
    const commandText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
    const normalizedCommand = commandText.toLowerCase().trim()
    const statusCommands = ['share', 'send', 'tuma', 'nitumie']
    const isStatusReply = contextInfo?.participant && quotedMsg

    if (statusCommands.includes(normalizedCommand) && isStatusReply) {
      const recipientJid = senderJid
      let sendMsg
      const quotedMsgWrapper = { message: quotedMsg }

      if (quotedMsg.imageMessage) {
        const buffer = await downloadMediaMessage(quotedMsgWrapper, 'buffer', {}, { logger: console })
        const filePath = path.join(tempDir, `${Date.now()}-status-image.jpg`)
        fs.writeFileSync(filePath, buffer)
        sendMsg = { image: { url: filePath }, caption: '📸 Sent by *ULTRA GURU* !' }
      } else if (quotedMsg.videoMessage) {
        const buffer = await downloadMediaMessage(quotedMsgWrapper, 'buffer', {}, { logger: console })
        const filePath = path.join(tempDir, `${Date.now()}-status-video.mp4`)
        fs.writeFileSync(filePath, buffer)
        sendMsg = { video: { url: filePath }, caption: '🎥 Sent by *ULTRA GURU* !' }
      } else if (quotedMsg.stickerMessage) {
        const buffer = await downloadMediaMessage(quotedMsgWrapper, 'buffer', {}, { logger: console })
        const filePath = path.join(tempDir, `${Date.now()}-status-sticker.webp`)
        fs.writeFileSync(filePath, buffer)
        sendMsg = { sticker: { url: filePath } }
      } else {
        return false
      }

      await sock.sendMessage(recipientJid, sendMsg, { quoted: msg })

      const fileUrl = sendMsg.image?.url || sendMsg.video?.url || sendMsg.sticker?.url
      if (fileUrl) {
        try { await fs.promises.unlink(fileUrl) } catch {}
      }
      return true
    }
  } catch (err) {
    console.error(`Error in status reply: ${err.message}`)
  }
  return false
}
