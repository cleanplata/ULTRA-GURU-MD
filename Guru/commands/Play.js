import yts from 'yt-search'
import axios from 'axios'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'

// Same download method as GURU MINI BOT: try each free API in order, pick the best
// media link from its reply, download it, and send it as WhatsApp audio.
// Override the list with the config var YT_AUDIO_APIS (comma separated, {url} / {id} placeholders).
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const LINE = '═══════════════════════'

const DEFAULT_APIS = [
  'https://noobs-api.top/dipto/ytDl3?link={id}&format=mp3',
  'https://apis.davidcyriltech.my.id/youtube/mp3?url={url}',
  'https://api.ryzendesu.vip/api/downloader/ytmp3?url={url}',
  'https://eliteprotech-apis.zone.id/ytmp3?url={url}',
  'https://api.siputzx.my.id/api/d/ytmp3?url={url}'
]

const audioApis = () => {
  const fromEnv = process.env.YT_AUDIO_APIS
  return fromEnv ? fromEnv.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_APIS
}

const short = e => String((e && e.message) || e || 'error').replace(/\s+/g, ' ').slice(0, 90)
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))
const hostOf = u => { try { return new URL(u.replace('{url}', 'x').replace('{id}', 'x')).hostname } catch { return 'source' } }

function collectUrls(o, out = [], key = '') {
  if (typeof o === 'string') { if (/^https?:\/\//i.test(o)) out.push({ key, url: o }) }
  else if (Array.isArray(o)) o.forEach(v => collectUrls(v, out, key))
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) collectUrls(v, out, k)
  return out
}

function pickAudio(data) {
  const all = collectUrls(data).filter(x =>
    !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(x.url) && !/thumb|cover|avatar|poster|image|icon/i.test(x.key))
  const score = x => {
    const k = x.key.toLowerCase(); const u = x.url.toLowerCase(); let s = 0
    if (/download|dl|link|url|play|hd|nowm|source/.test(k)) s += 2
    if (/\.(mp3|m4a|opus|ogg|aac)/.test(u) || /audio|mp3/.test(k)) s += 4
    return s
  }
  all.sort((a, b) => score(b) - score(a))
  return all.length ? all[0].url : null
}

async function downloadAudio(link, minBytes = 30000) {
  const r = await axios.get(link, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: 64 * 1024 * 1024,
    maxBodyLength: 64 * 1024 * 1024,
    headers: { 'User-Agent': UA }
  })
  const buffer = Buffer.from(r.data)
  const type = String(r.headers['content-type'] || '').split(';')[0].toLowerCase()
  if (/text\/html|application\/json|text\/plain/.test(type)) throw new Error('link returned a web page')
  if (buffer.length < minBytes) throw new Error('file too small')
  return buffer
}

async function viaProviders(vars) {
  const attempts = []
  for (const tpl of audioApis()) {
    const host = hostOf(tpl)
    try {
      const api = tpl
        .replace(/\{url\}/g, encodeURIComponent(vars.url || ''))
        .replace(/\{id\}/g, encodeURIComponent(vars.id || ''))
      const res = await axios.get(api, {
        timeout: 25000,
        headers: { 'User-Agent': UA, Accept: 'application/json,*/*' }
      })
      const link = pickAudio(res.data)
      if (!link) throw new Error('no download link in reply')
      const buffer = await downloadAudio(link)
      return { buffer, source: host }
    } catch (e) { attempts.push(`${host}: ${short(e)}`) }
  }
  const err = new Error('all download sources failed')
  err.attempts = attempts
  throw err
}


// ---------------------------------------------------------------- Sportify (Spotify search) API
const SPORTIFY_BASE = (process.env.SPORTIFY_API || 'https://sportify.xcasper.space').replace(/\/+$/, '')

function findTrackNode(node, depth = 0) {
  if (!node || depth > 7) return null
  if (Array.isArray(node)) {
    for (const item of node) { const f = findTrackNode(item, depth + 1); if (f) return f }
    return null
  }
  if (typeof node === 'object') {
    const hasName = typeof node.name === 'string' || typeof node.title === 'string'
    const hasArtist = node.artists || node.artist || node.artistName
    if (hasName && hasArtist) return node
    for (const k of Object.keys(node)) { const f = findTrackNode(node[k], depth + 1); if (f) return f }
  }
  return null
}

const artistNames = t => {
  const raw = t.artists ?? t.artist ?? t.artistName
  const list = Array.isArray(raw) ? raw : (raw?.items || [raw])
  return list.map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ')
}

async function sportifySearch(query) {
  const res = await axios.get(`${SPORTIFY_BASE}/api/search`, {
    params: { q: query, type: 'track', limit: 1 },
    timeout: 12000,
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  })
  const t = findTrackNode(res.data)
  if (!t) {
    // Log the real reply shape so the parser can be matched to it.
    console.warn('[PLAY] Sportify raw reply:', JSON.stringify(res.data).slice(0, 600))
    throw new Error('no track in reply')
  }
  const images = t.album?.images || t.images || []
  const ms = t.duration_ms || t.durationMs || 0
  return {
    title: t.name || t.title,
    artist: artistNames(t) || 'Unknown',
    album: (typeof t.album === 'string' ? t.album : t.album?.name) || '',
    seconds: ms ? Math.round(ms / 1000) : Math.round(Number(t.duration) || 0),
    cover: images[0]?.url || t.image || t.cover || t.thumbnail || '',
    spotifyUrl: t.external_urls?.spotify || t.url || (t.id ? `https://open.spotify.com/track/${t.id}` : '')
  }
}

const fmtTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

// ---------------------------------------------------------------- local fallback (yt-dlp)
const runFfmpeg = (bin, input, output) => new Promise((resolve, reject) => {
  execFile(bin, ['-y', '-i', input, '-vn', '-acodec', 'libmp3lame', '-b:a', '128k', output],
    { timeout: 90000 }, err => (err ? reject(err) : resolve()))
})

// The npm yt-dlp wrapper needs Python, which Heroku doesn't have. Instead we download yt-dlp's
// standalone Linux binary once (it bundles its own Python) and run that directly.
const YTDLP_URL = process.arch === 'arm64'
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
let ytDlpReady = null

async function ensureYtDlp() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN
  if (process.platform !== 'linux') throw new Error('standalone yt-dlp is only set up for Linux hosts')
  const bin = path.join(os.tmpdir(), 'yt-dlp_standalone')
  if (fs.existsSync(bin) && fs.statSync(bin).size > 5 * 1048576) return bin
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      console.log('[PLAY] downloading yt-dlp binary (one time)…')
      const r = await axios.get(YTDLP_URL, {
        responseType: 'arraybuffer', timeout: 120000, maxContentLength: 120 * 1048576, headers: { 'User-Agent': UA }
      })
      const tmp = `${bin}.part`
      fs.writeFileSync(tmp, Buffer.from(r.data))
      fs.chmodSync(tmp, 0o755)
      fs.renameSync(tmp, bin)
      return bin
    })().finally(() => { ytDlpReady = null })
  }
  return ytDlpReady
}

const runBinary = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 100000, maxBuffer: 8 * 1048576 }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).split('\n').filter(Boolean).pop() || err.message))
    else resolve()
  })
})

async function viaYtDlp(videoUrl) {
  const bin = await ensureYtDlp()
  let ffmpegPath = null
  try { ffmpegPath = (await import('ffmpeg-static')).default } catch {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-'))
  try {
    const baseArgs = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-o', path.join(dir, 'src.%(ext)s'),
      '--no-playlist', '--no-warnings', '--no-progress']

    // Optional anti-bot helpers, set as config vars on the host:
    //   YT_COOKIES_B64 (or YT_COOKIES) = a YouTube cookies.txt (Netscape format), base64 encoded for _B64
    //   YT_PROXY       = e.g. http://user:pass@host:port (a residential/non-datacenter proxy)
    const extra = []
    const cookieText = process.env.YT_COOKIES_B64
      ? Buffer.from(process.env.YT_COOKIES_B64, 'base64').toString('utf8')
      : process.env.YT_COOKIES
    if (cookieText) {
      const cookieFile = path.join(dir, 'cookies.txt')
      fs.writeFileSync(cookieFile, cookieText)
      extra.push('--cookies', cookieFile)
    }
    if (process.env.YT_PROXY) extra.push('--proxy', process.env.YT_PROXY)

    // YouTube treats different "player clients" differently; datacenter hosts are often
    // blocked on one client but not another, so try several in turn.
    const attempts = [
      ['--js-runtimes', 'node'],
      ['--extractor-args', 'youtube:player_client=tv,ios'],
      ['--extractor-args', 'youtube:player_client=mweb,web_safari'],
      ['--extractor-args', 'youtube:player_client=android_vr']
    ]
    let lastError
    for (const [i, flags] of attempts.entries()) {
      try {
        await runBinary(bin, [...flags, ...extra, ...baseArgs, videoUrl])
        lastError = null
        break
      } catch (err) {
        lastError = err
        console.warn(`[PLAY] yt-dlp attempt ${i + 1} failed:`, short(err))
        for (const f of fs.readdirSync(dir)) if (f.startsWith('src.')) fs.rmSync(path.join(dir, f), { force: true })
      }
    }
    if (lastError) throw lastError
    const file = fs.readdirSync(dir).find(f => f.startsWith('src.'))
    if (!file) throw new Error('yt-dlp produced no file')
    const src = path.join(dir, file)
    const ext = path.extname(file).slice(1).toLowerCase()
    if (ffmpegPath && ext !== 'mp3') {
      const out = path.join(dir, 'out.mp3')
      await runFfmpeg(ffmpegPath, src, out)
      return { buffer: fs.readFileSync(out), mime: 'audio/mpeg', ext: 'mp3', source: 'yt-dlp+ffmpeg' }
    }
    const mimeByExt = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac' }
    if (!mimeByExt[ext]) throw new Error(`got .${ext} but ffmpeg is unavailable`)
    return { buffer: fs.readFileSync(src), mime: mimeByExt[ext], ext, source: 'yt-dlp' }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function findVideo(query, targetSeconds = 0) {
  const m = query.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)
  if (m) {
    try { const v = await yts({ videoId: m[1] }); if (v) return v } catch { /* fall through to search */ }
  }
  const r = await yts(query)
  const vids = r.videos || []
  if (targetSeconds) {
    const close = vids.filter(x => x.seconds && Math.abs(x.seconds - targetSeconds) <= 12)
    if (close.length) return close[0]
  }
  return vids.find(x => x.seconds && x.seconds <= 1800) || vids[0] || null
}

// Mini-bot card layout. The footer line starts with "> " so WhatsApp shows it in the grey quote style.
function card(title, rows, footer) {
  return `*⚙️ ${title}*\n\n╔${LINE}\n${rows.map(r => '║ ' + r).join('\n')}\n╚${LINE}\n\n> ${footer}`
}

export async function runPlay({ sock, from, text, msg, config }) {
  const footer = config?.BOT_FOOTER || `Powered by ${config?.OWNER_NAME || 'GuruTech'}`
  const q = { quoted: msg }
  const react = async emoji => { try { await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }) } catch {} }
  const query = String(text || '').trim()

  if (!query) {
    return sock.sendMessage(from, {
      text: card('ᴜsᴀɢᴇ', ['🔣 *.play* <song name or YouTube link>', '💡 .play Sauti Sol Melanin'], footer)
    }, q)
  }

  await react('🎵')
  const isLink = /(?:youtu\.be\/|youtube\.com\/)/i.test(query)
  let meta = null
  if (!isLink) {
    try { meta = await sportifySearch(query) } catch (e) { console.warn('[PLAY] Sportify search failed:', short(e)) }
  }

  let video
  try {
    video = meta ? await findVideo(`${meta.artist} ${meta.title}`, meta.seconds) : await findVideo(query)
    if (!video && meta) video = await findVideo(query)
  } catch (e) {
    console.error('[PLAY] search failed:', short(e))
    return sock.sendMessage(from, { text: '❌ YouTube search failed. Try again in a moment.' }, q)
  }
  if (!video) return sock.sendMessage(from, { text: '❌ No results found. Try different words.' }, q)

  const title = meta?.title || video.title || query
  const rows = meta ? [
    `🎧 *ᴛɪᴛʟᴇ* ➜ ${clip(meta.title, 60)}`,
    `🎤 *ᴀʀᴛɪsᴛ* ➜ ${clip(meta.artist, 50)}`,
    ...(meta.album ? [`💿 *ᴀʟʙᴜᴍ* ➜ ${clip(meta.album, 50)}`] : []),
    `⏳ *ᴅᴜʀᴀᴛɪᴏɴ* ➜ ${meta.seconds ? fmtTime(meta.seconds) : (video.timestamp || '?')}`,
    ...(meta.spotifyUrl ? [`🟢 ${meta.spotifyUrl}`] : []),
    `🔗 ${video.url}`
  ] : [
    `🎧 *ᴛɪᴛʟᴇ* ➜ ${clip(title, 60)}`,
    `⏳ *ᴅᴜʀᴀᴛɪᴏɴ* ➜ ${video.timestamp || video.duration?.timestamp || '?'}`,
    `👁️ *ᴠɪᴇᴡs* ➜ ${Number(video.views || 0).toLocaleString()}`,
    `📺 *ᴄʜᴀɴɴᴇʟ* ➜ ${clip(video.author?.name || 'Unknown', 40)}`,
    `🔗 ${video.url}`
  ]
  const caption = card('ɴᴏᴡ ᴘʟᴀʏɪɴɢ', rows, footer)
  const thumb = meta?.cover || video.thumbnail || video.image
  try {
    if (thumb) await sock.sendMessage(from, { image: { url: thumb }, caption }, q)
    else await sock.sendMessage(from, { text: caption }, q)
  } catch {
    try { await sock.sendMessage(from, { text: caption }, q) } catch {}
  }

  try {
    let audio
    const problems = []
    try {
      const r = await viaProviders({ url: video.url, id: video.videoId })
      audio = { buffer: r.buffer, mime: 'audio/mpeg', ext: 'mp3', source: r.source }
    } catch (apiError) {
      problems.push(...(apiError.attempts || [short(apiError)]))
      console.warn('[PLAY] all APIs failed, trying yt-dlp:', problems.join(' | '))
      try { audio = await viaYtDlp(video.url) }
      catch (ytError) {
        problems.push(`yt-dlp: ${short(ytError)}`)
        const err = new Error('all download sources failed')
        err.attempts = problems
        throw err
      }
    }
    const { buffer, mime, ext, source } = audio
    const mb = buffer.length / 1048576
    console.log(`[PLAY] audio via ${source} (${mb.toFixed(1)} MB)`)
    const fileName = `${(meta ? `${meta.artist} - ${meta.title}` : title).replace(/[\\/:*?"<>|]/g, '')}.${ext}`
    if (mb <= 16) {
      await sock.sendMessage(from, { audio: buffer, mimetype: mime, fileName }, q)
    } else if (mb <= 90) {
      await sock.sendMessage(from, { document: buffer, mimetype: mime, fileName }, q)
    } else {
      throw new Error('file is too large to send')
    }
    await react('✅')
  } catch (e) {
    console.error('[PLAY] failed:', (e.attempts || [short(e)]).join(' | '))
    await sock.sendMessage(from, {
      text: `❌ I found the song but every download source failed right now.\n\n🔗 ${video.url}\n\n_Try again in a minute. You can also add fresh sources with the config var YT_AUDIO_APIS._`
    }, q)
  }
}

export const commands = [
  {
    name: 'play',
    description: 'Search YouTube and send the song as audio.',
    category: 'Search',
    execute: runPlay
  }
]
