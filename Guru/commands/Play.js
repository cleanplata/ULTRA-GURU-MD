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
          thumbnail: d.thumbnails?.slice(-1)[0]?.url || '', duration: d.durationRaw || ''
        }
      } catch { /* fall through */ }
    }
    const id = query.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1]
    if (id) {
      try {
        const v = await yts({ videoId: id })
        if (v) return { url: query, title: v.title || 'Unknown', artist: v.author?.name || 'Unknown', thumbnail: v.thumbnail || `https://img.youtube.com/vi/${id}/hqdefault.jpg`, duration: v.timestamp || '' }
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
        thumbnail: v.thumbnails?.slice(-1)[0]?.url || '', duration: v.durationRaw || ''
      }
    } catch { /* fall back to yt-search */ }
  }
  const r = await yts(query)
  const v = r.videos?.[0]
  if (!v) throw new Error('No results found for: ' + query)
  return { url: v.url, title: v.title || 'Unknown', artist: v.author?.name || 'Unknown', thumbnail: v.thumbnail || '', duration: v.timestamp || '' }
}

async function downloadMp3(videoUrl) {
  const { data } = await axios.get(`${BASE}/download/ytmp3?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 })
  const link = data?.result?.download_url || data?.result?.downloadUrl || data?.result?.url || data?.url || data?.link
  if (!link) throw new Error('No download link in API response')
  return link
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

    const audioUrl = await downloadMp3(track.url)

    await sock.sendMessage(from, { audio: { url: audioUrl }, mimetype: 'audio/mpeg', ptt: false }, q)

    const safeName = track.title.replace(/[^\w\s-]/g, '').trim().slice(0, 50)
    await sock.sendMessage(from, { document: { url: audioUrl }, mimetype: 'audio/mpeg', fileName: `${safeName}.mp3` }, q)
  } catch (err) {
    console.error('[PLAY] failed:', err?.response?.status ? `HTTP ${err.response.status}` : '', err?.message)
    await sock.sendMessage(from, { text: `❌ *Download failed:* ${err.message}` }, q)
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
