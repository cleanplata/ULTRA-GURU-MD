import yts from 'yt-search'
import axios from 'axios'
import { API_CONFIG, MESSAGES } from '../france/index.js'
import ffmpegStatic from 'ffmpeg-static'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const MAX_SOURCE_BYTES = 80 * 1024 * 1024
const MAX_WHATSAPP_AUDIO_BYTES = 15 * 1024 * 1024
const PLAY_API_TIMEOUT_MS = 12000
const PLAY_DOWNLOAD_TIMEOUT_MS = 45000

function findFfmpegPath() {
  const candidates = [ffmpegStatic, 'ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean)
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-version'], { stdio: 'ignore' })
    if (!result.error && result.status === 0) return candidate
  }
  return null
}

const FFMPEG_PATH = findFfmpegPath()

function safeFileName(value) {
  return String(value || 'song')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'song'
}

function safeDisplay(value, fallback = 'N/A') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').trim().slice(0, 160) || fallback
}

function safeErrorSummary(error) {
  return String(error?.stderr || error?.message || 'Unknown error')
    .replace(/https?:\/\/[^\s\"')]+/gi, '[URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

function extractAudioSource(payload) {
  const candidates = [
    payload?.audio,
    payload?.audioUrl,
    payload?.audio_url,
    payload?.downloadUrl,
    payload?.download_url,
    payload?.mp3,
    payload?.url
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const url = candidate.url || candidate.downloadUrl || candidate.download_url || candidate.link
      if (typeof url === 'string' && url.trim()) return url.trim()
      if (Buffer.isBuffer(candidate.data) || candidate.data instanceof Uint8Array) return candidate.data
      if (typeof candidate.base64 === 'string') return `data:audio/mpeg;base64,${candidate.base64}`
    }
  }
  return null
}

function extensionFrom(source, contentType) {
  const mime = String(contentType || '').split(';')[0].toLowerCase()
  let ext = ''
  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+)/i)
      if (match?.[1]) return extensionFromMime(match[1])
    }
    try {
      ext = path.extname(new URL(source).pathname).slice(1).toLowerCase()
    } catch {
      ext = path.extname(source).slice(1).toLowerCase()
    }
  }
  if (['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', 'mp4'].includes(ext)) return ext
  return extensionFromMime(mime) || 'bin'
}

function extensionFromMime(mime) {
  const value = String(mime || '').toLowerCase()
  if (value.includes('mpeg') || value.includes('audio/mp3')) return 'mp3'
  if (value.includes('ogg') || value.includes('opus')) return 'ogg'
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a'
  if (value.includes('wav')) return 'wav'
  if (value.includes('aac')) return 'aac'
  if (value.includes('webm')) return 'webm'
  return ''
}

async function loadAudio(source, httpGet, timeout) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    return { buffer: Buffer.from(source), contentType: 'audio/mpeg', source }
  }
  if (typeof source !== 'string') throw new Error('Audio source is not a supported URL or buffer.')

  const dataUri = source.match(/^data:([^;,]+)?;base64,(.+)$/i)
  if (dataUri) {
    return {
      buffer: Buffer.from(dataUri[2], 'base64'),
      contentType: dataUri[1] || 'audio/mpeg',
      source
    }
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await httpGet(source, {
      responseType: 'arraybuffer',
      timeout,
      maxContentLength: MAX_SOURCE_BYTES,
      maxBodyLength: MAX_SOURCE_BYTES,
      headers: { 'User-Agent': 'Mozilla/5.0 ULTRA-GURU' }
    })
    const buffer = Buffer.from(response.data)
    return { buffer, contentType: response.headers?.['content-type'] || '', source }
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(source) && source.length > 256) {
    return { buffer: Buffer.from(source, 'base64'), contentType: 'audio/mpeg', source }
  }
  throw new Error('Audio download link was not valid.')
}

async function downloadWithYtDlp(videoUrl, tempDir, dependencies = {}) {
  let ytDlp = dependencies.ytDlp
  if (!ytDlp) {
    const module = await import('youtube-dl-exec')
    ytDlp = module.default || module
  }
  const run = typeof ytDlp.exec === 'function' ? ytDlp.exec.bind(ytDlp) : ytDlp
  if (typeof run !== 'function') throw new Error('Local audio downloader is unavailable.')

  const outputTemplate = path.join(tempDir, 'yt-dlp-source.%(ext)s')
  await run(videoUrl, {
    format: 'bestaudio/best',
    output: outputTemplate,
    noPlaylist: true,
    noWarnings: true,
    noProgress: true,
    jsRuntimes: 'node',
    restrictFilenames: true
  }, { timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 })

  const downloaded = fs.readdirSync(tempDir).find(name =>
    name.startsWith('yt-dlp-source.') && !name.endsWith('.part')
  )
  if (!downloaded) throw new Error('Local audio downloader produced no file.')
  return path.join(tempDir, downloaded)
}

async function transcodeToMp3(inputPath, outputPath, ffmpegPath, runFile) {
  await runFile(ffmpegPath, [
    '-y', '-i', inputPath, '-vn',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-f', 'mp3', outputPath
  ], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 })
}

export async function runPlay({ sock, from, text, msg, config }, dependencies = {}) {
  const botName = config?.BOT_NAME || 'ULTRA GURU'
  const ownerName = config?.OWNER_NAME || 'GuruTech'
  const messages = MESSAGES?.play || {}
  const query = String(text || '').trim()
  const search = dependencies.search || yts
  const http = dependencies.http || axios
  const httpGet = http.get.bind(http)
  const apiConfig = dependencies.apiConfig || API_CONFIG
  const ffmpegPath = Object.hasOwn(dependencies, 'ffmpegPath') ? dependencies.ffmpegPath : FFMPEG_PATH
  const runFile = dependencies.execFile || execFileAsync
  const configuredTimeout = Number(apiConfig?.nayanApi?.timeout) || PLAY_API_TIMEOUT_MS
  const timeout = Math.min(configuredTimeout, PLAY_API_TIMEOUT_MS)
  const downloadTimeout = PLAY_DOWNLOAD_TIMEOUT_MS
  let tempDir

  if (!query) {
    return sock.sendMessage(from, {
      text: messages.noQuery || '🎵 Send a song title or YouTube link. Example: .play song name'
    }, { quoted: msg })
  }

  try {
    await sock.sendMessage(from, { text: '🔎 Searching for your song…' }, { quoted: msg })
    const results = await search(query)
    const video = results?.videos?.[0]
    if (!video) {
      return sock.sendMessage(from, {
        text: messages.noResults || '❌ No matching song was found. Try another title.'
      }, { quoted: msg })
    }

    const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.videoId}`
    const displayTitle = safeDisplay(video.title || query, 'Unknown song')
    const channel = safeDisplay(video.author?.name, 'Unknown')
    const duration = safeDisplay(video.timestamp, 'N/A')
    const thumbnail = video.thumbnail ||
      (video.videoId ? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` : '')
    const previewCaption = [
      `> ╭─⌈ 🔥 *${botName}* · _MUSIC PLAYER_ ⌋`,
      `> │ 🎵 *Title* › ${displayTitle}`,
      `> │ 👤 *Channel* › ${channel}`,
      `> │ ⏱️ *Duration* › ${duration}`,
      '> │ 🔊 *Audio* › *MP3 · 128 kbps*',
      `> ╰⊷ ✨ _Powered by ${ownerName}_`
    ].join('\n')
    try {
      if (thumbnail) {
        await sock.sendMessage(from, { image: { url: thumbnail }, caption: previewCaption }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: previewCaption }, { quoted: msg })
      }
    } catch (previewError) {
      console.warn('[PLAY] Preview send failed:', previewError.message)
      try { await sock.sendMessage(from, { text: previewCaption }, { quoted: msg }) } catch {}
    }
    await sock.sendMessage(from, { text: messages.fetching || '⏳ Preparing the audio…' }, { quoted: msg })

    let payload = {}
    let audioResult = null
    let hostedError = null
    const endpoint = apiConfig?.nayanApi?.youtube
    if (endpoint) {
      const downloadApiUrl = new URL(endpoint)
      downloadApiUrl.searchParams.set('url', videoUrl)
      for (let attempt = 0; attempt < 2 && !audioResult; attempt++) {
        try {
          const apiResponse = await httpGet(downloadApiUrl.toString(), {
            timeout,
            maxContentLength: 4 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0 ULTRA-GURU' }
          })
          const responseBody = apiResponse.data
          payload = responseBody?.data?.data || responseBody?.data || responseBody?.result || responseBody || {}
          const audioSource = extractAudioSource(payload)
          if (!audioSource || responseBody?.status === false || responseBody?.success === false) {
            throw new Error('Hosted downloader did not return audio.')
          }
          audioResult = await loadAudio(audioSource, httpGet, downloadTimeout)
        } catch (error) {
          hostedError = error
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350))
        }
      }
    } else {
      hostedError = new Error('Hosted downloader is not configured.')
    }

    let miniApiError = null
    if (!audioResult && video.videoId) {
      try {
        const miniApiUrl = new URL('https://noobs-api.top/dipto/ytDl3')
        miniApiUrl.searchParams.set('link', video.videoId)
        miniApiUrl.searchParams.set('format', 'mp3')
        const miniApiResponse = await httpGet(miniApiUrl.toString(), {
          timeout,
          maxContentLength: 4 * 1024 * 1024,
          headers: { 'User-Agent': 'Mozilla/5.0 ULTRA-GURU', 'Accept': 'application/json' }
        })
        const miniApiPayload = miniApiResponse.data
        const miniAudioSource = miniApiPayload?.downloadLink
        if (!miniAudioSource) throw new Error('Mini-bot audio API did not return a download link.')
        payload = { ...payload, title: payload?.title || miniApiPayload?.title || video.title }
        audioResult = await loadAudio(miniAudioSource, httpGet, downloadTimeout)
      } catch (error) {
        miniApiError = error
        console.warn('[PLAY] Mini-bot backup API unavailable:', safeErrorSummary(error))
      }
    }

    let audioBuffer
    let sourceReference
    let sourceContentType = ''
    let localSourcePath = null
    if (audioResult?.buffer?.length) {
      audioBuffer = audioResult.buffer
      sourceReference = audioResult.source
      sourceContentType = audioResult.contentType
    } else {
      if (!ffmpegPath) throw hostedError || new Error('MP3 conversion is unavailable.')
      const providerError = miniApiError || hostedError
      console.warn('[PLAY] Hosted/mini-bot APIs unavailable; trying local fallback:', safeErrorSummary(providerError) || 'no audio returned')
      await sock.sendMessage(from, { text: '⏳ Trying the local audio fallback…' }, { quoted: msg })
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-guru-play-'))
      localSourcePath = await downloadWithYtDlp(videoUrl, tempDir, dependencies)
      audioBuffer = fs.readFileSync(localSourcePath)
      sourceReference = localSourcePath
    }

    if (!audioBuffer.length || audioBuffer.length > MAX_SOURCE_BYTES) {
      throw new Error('The downloaded audio is empty or too large.')
    }

    const title = safeFileName(payload?.title || video.title || query)
    let audioFileName = `${title}.mp3`
    if (ffmpegPath) {
      tempDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-guru-play-'))
      const inputPath = localSourcePath || path.join(tempDir, `source.${extensionFrom(sourceReference, sourceContentType)}`)
      const outputPath = path.join(tempDir, 'audio.mp3')
      if (!localSourcePath) fs.writeFileSync(inputPath, audioBuffer)
      await transcodeToMp3(inputPath, outputPath, ffmpegPath, runFile)
      audioBuffer = fs.readFileSync(outputPath)
    } else if (extensionFrom(sourceReference, sourceContentType) !== 'mp3') {
      throw new Error('MP3 conversion is unavailable on this deployment.')
    }

    if (!audioBuffer.length || audioBuffer.length > MAX_WHATSAPP_AUDIO_BYTES) {
      throw new Error('The finished audio exceeds WhatsApp’s 15 MB audio-message limit.')
    }

    await sock.sendMessage(from, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      fileName: audioFileName,
      ptt: false
    }, { quoted: msg })
  } catch (error) {
    console.error('[PLAY] Song request failed:', safeErrorSummary(error))
    const errorText = /timeout|timed out|ETIMEDOUT|ECONNABORTED/i.test(error.message)
      ? (messages.timeout || '⏱️ The song service timed out. Please try again.')
      : (messages.error || '❌ Could not prepare that song right now. Please try again later.')
    await sock.sendMessage(from, { text: errorText }, { quoted: msg })
  } finally {
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export const commands = [
  {
    name: 'play',
    description: 'Search for a song and send its cover preview plus WhatsApp-playable MP3 audio.',
    category: 'Search',
    execute: runPlay
  }
]
