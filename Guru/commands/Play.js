import axios from 'axios'
import yts from 'yt-search'

// Works exactly like Silva MD's .play:
//   1. search YouTube (play-dl, falling back to yt-search if play-dl isn't installed)
//   2. get the MP3 link from the davidcyriltech API  ->  result.download_url
//   3. send the audio from that link, then the same MP3 as a document
const BASE = 'https://apis.davidcyriltech.my.id'
const PLACEHOLDER_THUMB = 'https://files.catbox.moe/5uli5p.jpeg'

async function searchYoutube(query) {
  const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)
  let playdl = null
  try { playdl = (await import('play-dl')).default } catch { /* not installed: use yt-search */ }

  if (isUrl) {
    if (playdl) {
      try {
        const info = await playdl.video_info(query)
        const d = info.video_details
        return {
          url: query, title: d.title || 'Unknown', artist: d.channel?.name || 'Unknown',
          thumbnail: d.thumbnails?.slice(-1)[0]?.url || '', duration: d.durationRaw || '', seconds: d.durationInSec || 0
        }
      } catch { /* fall through */ }
    }
    const id = query.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1]
    if (id) {
      try {
        const v = await yts({ videoId: id })
        if (v) return { url: query, title: v.title || 'Unknown', artist: v.author?.name || 'Unknown', thumbnail: v.thumbnail || `https://img.youtube.com/vi/${id}/hqdefault.jpg`, duration: v.timestamp || '', seconds: v.seconds || 0 }
      } catch { /* fall through */ }
    }
    return { url: query, title: 'Unknown', artist: 'Unknown', thumbnail: id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '', duration: '' }
  }

  if (playdl) {
    try {
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 })
      const v = results?.[0]
      if (v) return {
        url: v.url, title: v.title || 'Unknown', artist: v.channel?.name || 'Unknown',
        thumbnail: v.thumbnails?.slice(-1)[0]?.url || '', duration: v.durationRaw || '', seconds: v.durationInSec || 0
      }
    } catch { /* fall back to yt-search */ }
  }
  const r = await yts(query)
  const v = r.videos?.[0]
  if (!v) throw new Error('No results found for: ' + query)
  return { url: v.url, title: v.title || 'Unknown', artist: v.author?.name || 'Unknown', thumbnail: v.thumbnail || '', duration: v.timestamp || '', seconds: v.seconds || 0 }
}

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

// First source is Silva's. The rest are only used if it gives a broken file or errors out.
// Override with the config var YT_AUDIO_APIS (comma separated, {url} / {id} placeholders).
const DEFAULT_APIS = [
  `${BASE}/download/ytmp3?url={url}`,
  'https://noobs-api.top/dipto/ytDl3?link={id}&format=mp3',
  'https://api.ryzendesu.vip/api/downloader/ytmp3?url={url}',
  'https://eliteprotech-apis.zone.id/ytmp3?url={url}',
  'https://api.siputzx.my.id/api/d/ytmp3?url={url}'
]
const audioApis = () => process.env.YT_AUDIO_APIS
  ? process.env.YT_AUDIO_APIS.split(',').map(x => x.trim()).filter(Boolean)
  : DEFAULT_APIS

const short = e => String((e && e.message) || e || 'error').replace(/\s+/g, ' ').slice(0, 120)
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
    const k = x.key.toLowerCase(); const u = x.url.toLowerCase(); let sc = 0
    if (/download|dl|link|url|play|hd|source/.test(k)) sc += 2
    if (/\.(mp3|m4a|opus|ogg|aac)/.test(u) || /audio|mp3/.test(k)) sc += 4
    return sc
  }
  all.sort((a, b) => score(b) - score(a))
  return all.length ? all[0].url : null
}

// Real audio starts with an ID3 tag, an MPEG frame sync, or an MP4 "ftyp" box.
function looksLikeAudio(buf) {
  if (buf.length < 12) return false
  if (buf.slice(0, 3).toString('latin1') === 'ID3') return true
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') return true
  if (buf.slice(0, 4).toString('latin1') === 'OggS') return true
  return false
}

async function fetchAudio(link, seconds) {
  const r = await axios.get(link, {
    responseType: 'arraybuffer', timeout: 90000,
    maxContentLength: 64 * 1024 * 1024, maxBodyLength: 64 * 1024 * 1024,
    headers: { 'User-Agent': UA }
  })
  const buffer = Buffer.from(r.data)
  const type = String(r.headers['content-type'] || '').split(';')[0].toLowerCase()
  // A 3-minute song can't be a few KB: anything under ~32 kbps worth of audio is a stub or error page.
  const minBytes = Math.max(150000, (seconds || 0) * 4000)
  if (!looksLikeAudio(buffer) || buffer.length < minBytes) {
    const head = buffer.slice(0, 80).toString('utf8').replace(/[^\x20-\x7e]/g, '.')
    console.warn(`[PLAY] rejected file: ${buffer.length} bytes, type=${type || '?'}, need>=${minBytes}, head="${head}"`)
    const e = new Error(`bad audio file (${Math.round(buffer.length / 1024)} KB, ${type || 'no type'}): ${head.slice(0, 45)}`)
    e.badFile = true
    throw e
  }
  return buffer
}

async function downloadMp3(track) {
  const attempts = []
  for (const tpl of audioApis()) {
    const host = hostOf(tpl)
    try {
      const api = tpl
        .replace(/\{url\}/g, encodeURIComponent(track.url))
        .replace(/\{id\}/g, encodeURIComponent(track.videoId || track.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] || ''))
      let buffer
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await axios.get(api, { timeout: 30000, headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } })
        const link = res.data?.result?.download_url || res.data?.result?.downloadUrl || pickAudio(res.data)
        if (!link) throw new Error('no download link in reply')
        try {
          buffer = await fetchAudio(link, track.seconds)
          break
        } catch (e) {
          if (!e.badFile || attempt === 3) throw e
          console.warn(`[PLAY] ${host} gave a stub file, retrying in 6s (attempt ${attempt}/3)`)
          await new Promise(r => setTimeout(r, 6000))
        }
      }
      console.log(`[PLAY] audio via ${host} (${(buffer.length / 1048576).toFixed(1)} MB)`)
      return buffer
    } catch (e) { attempts.push(`${host}: ${short(e)}`) }
  }
  try {
    const res = await axios.post('https://api.cobalt.tools/', { url: track.url, downloadMode: 'audio', audioFormat: 'mp3' }, {
      timeout: 30000,
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' }
    })
    const link = res.data?.url
    if (!link) throw new Error(res.data?.error?.code || res.data?.status || 'no url in reply')
    const buffer = await fetchAudio(link, track.seconds)
    console.log(`[PLAY] audio via cobalt (${(buffer.length / 1048576).toFixed(1)} MB)`)
    return buffer
  } catch (e) { attempts.push(`cobalt: ${short(e?.response?.data?.error?.code || e)}`) }

  console.error('[PLAY] all sources failed:', attempts.join(' | '))
  const err = new Error('every download source gave a broken or empty file.')
  err.attempts = attempts
  throw err
}

export async function runPlay({ sock, from, text, msg }) {
  const query = String(text || '').trim()
  const q = { quoted: msg }

  if (!query) {
    return sock.sendMessage(from, {
      text: '🎵 Usage: `.play <song name or YouTube link>`\nExample: `.play Blinding Lights`'
    }, q)
  }

  await sock.sendMessage(from, { text: `🔍 Searching: *${query}*...` }, q)

  try {
    const track = await searchYoutube(query)

    await sock.sendMessage(from, {
      image: { url: track.thumbnail || PLACEHOLDER_THUMB },
      caption: `🎵 *${track.title}*\n🎤 *Artist:* ${track.artist}\n⏱ *Duration:* ${track.duration}\n\n_Downloading..._`
    }, q)

    const audioBuffer = await downloadMp3(track)

    await sock.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, q)

    const safeName = track.title.replace(/[^\w\s-]/g, '').trim().slice(0, 50)
    await sock.sendMessage(from, { document: audioBuffer, mimetype: 'audio/mpeg', fileName: `${safeName}.mp3` }, q)
  } catch (err) {
    console.error('[PLAY] failed:', err?.response?.status ? `HTTP ${err.response.status}` : '', err?.message)
    const detail = (err.attempts || []).slice(0, 6).map(a => `• ${a}`).join('\n')
    await sock.sendMessage(from, {
      text: `❌ *Download failed:* ${err.message}${detail ? `\n\n_Details:_\n${detail}` : ''}`
    }, q)
  }
}

export const commands = [
  {
    name: 'play',
    description: 'Search and download a song from YouTube.',
    category: 'Search',
    execute: runPlay
  }
]
