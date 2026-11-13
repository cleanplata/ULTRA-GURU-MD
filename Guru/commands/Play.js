import yts from 'yt-search'
import axios from 'axios'

// Same download method as GURU MINI BOT: try each free API in order, pick the best
// media link from its reply, download it, and send it as WhatsApp audio.
// Override the list with the config var YT_AUDIO_APIS (comma separated, {url} / {id} placeholders).
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const LINE = '═══════════════════════'

const DEFAULT_APIS = [
  'https://noobs-api.top/dipto/ytDl3?link={id}&format=mp3',
  'https://api.siputzx.my.id/api/d/ytmp3?url={url}',
  'https://apis.davidcyriltech.my.id/youtube/mp3?url={url}',
  'https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url={url}',
  'https://api.agatz.xyz/api/ytmp3?url={url}'
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

async function findVideo(query) {
  const m = query.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)
  if (m) {
    try { const v = await yts({ videoId: m[1] }); if (v) return v } catch { /* fall through to search */ }
  }
  const r = await yts(query)
  const vids = r.videos || []
  return vids.find(x => x.seconds && x.seconds <= 1800) || vids[0] || null
}

const SPORTIFY_API = (process.env.SPORTIFY_API_URL || 'https://sportify.xcasper.space/api').replace(/\/$/, '')

function spotifyTrackFrom(data) {
  const raw = data?.track || data?.result || data?.data?.track || data?.data || data
  if (!raw || typeof raw !== 'object') return null
  const track = {
    id: raw.id,
    title: raw.title || raw.name,
    artist: raw.artist || raw.artists?.map?.(item => typeof item === 'string' ? item : item.name).filter(Boolean).join(', '),
    album: raw.album?.name || raw.album,
    url: raw.url || raw.external_urls?.spotify,
    thumbnail: raw.thumbnail || raw.album?.images?.[0]?.url || raw.images?.[0]?.url,
    duration: raw.duration || raw.duration_ms && `${Math.floor(raw.duration_ms / 60000)}:${String(Math.floor(raw.duration_ms / 1000) % 60).padStart(2, '0')}`
  }
  return track.title && track.artist ? track : null
}

export async function searchSportify(query) {
  const spotifyUrl = String(query).match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([\w]+)/i)
  try {
    if (spotifyUrl) {
      const response = await axios.get(`${SPORTIFY_API}/track/${encodeURIComponent(spotifyUrl[1])}`, {
        timeout: 12000, headers: { 'User-Agent': UA, Accept: 'application/json' }
      })
      const track = spotifyTrackFrom(response.data)
      if (track) return track
    }
    const response = await axios.get(`${SPORTIFY_API}/search`, {
      params: { q: query, type: 'track', limit: 1, offset: 0 },
      timeout: 12000, headers: { 'User-Agent': UA, Accept: 'application/json' }
    })
    const data = response.data
    if (data?.success === false) return null
    return spotifyTrackFrom(data?.results?.[0] || data?.tracks?.items?.[0] || data?.results?.tracks?.items?.[0])
  } catch (error) {
    console.warn('[PLAY] Sportify metadata unavailable; using YouTube search:', short(error))
    return null
  }
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
  const spotifyTrack = await searchSportify(query)
  const searchQuery = spotifyTrack ? `${spotifyTrack.title} ${spotifyTrack.artist}` : query
  let video
  try { video = await findVideo(searchQuery) } catch (e) {
    console.error('[PLAY] search failed:', short(e))
    return sock.sendMessage(from, { text: '❌ YouTube search failed. Try again in a moment.' }, q)
  }
  if (!video) return sock.sendMessage(from, { text: '❌ No results found. Try different words.' }, q)

  const title = spotifyTrack?.title || video.title || query
  const rows = [
    `🎧 *ᴛɪᴛʟᴇ* ➜ ${clip(title, 60)}`,
    `🎤 *ᴀʀᴛɪsᴛ* ➜ ${clip(spotifyTrack?.artist || video.author?.name || 'Unknown', 50)}`,
    `⏳ *ᴅᴜʀᴀᴛɪᴏɴ* ➜ ${spotifyTrack?.duration || video.timestamp || video.duration?.timestamp || '?'}`,
    ...(spotifyTrack?.album ? [`💿 *ᴀʟʙᴜᴍ* ➜ ${clip(spotifyTrack.album, 45)}`] : []),
    `📺 *sᴏᴜʀᴄᴇ* ➜ YouTube audio`,
    ...(spotifyTrack?.url ? [`🔗 *sᴘᴏᴛɪғʏ* ➜ ${spotifyTrack.url}`] : [`🔗 ${video.url}`])
  ]
  const caption = card('ɴᴏᴡ ᴘʟᴀʏɪɴɢ', rows, footer)
  const thumb = spotifyTrack?.thumbnail || video.thumbnail || video.image
  try {
    if (thumb) await sock.sendMessage(from, { image: { url: thumb }, caption }, q)
    else await sock.sendMessage(from, { text: caption }, q)
  } catch {
    try { await sock.sendMessage(from, { text: caption }, q) } catch {}
  }

  try {
    const { buffer, source } = await viaProviders({ url: video.url, id: video.videoId })
    console.log(`[PLAY] audio via ${source} (${(buffer.length / 1048576).toFixed(1)} MB)`)
    const mb = buffer.length / 1048576
    const fileName = `${title.replace(/[\\/:*?"<>|]/g, '')}.mp3`
    if (mb <= 16) {
      await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mpeg', fileName }, q)
    } else if (mb <= 90) {
      await sock.sendMessage(from, { document: buffer, mimetype: 'audio/mpeg', fileName }, q)
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
