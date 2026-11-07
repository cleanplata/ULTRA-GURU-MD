import CONFIG from '../../Guru Tech/config.js'

const FEATURE_FLAGS = {
  antidelete: { label: 'Anti-delete', key: 'ANTIDELETE' },
  antiedit: { label: 'Anti-edit', key: 'ANTIEDIT' },
  autoview: { label: 'Auto-view status', key: 'AUTO_VIEW' },
  autolike: { label: 'Auto-like status', key: 'AUTO_LIKE' }
}

let updateInProgress = false
let lastUpdateTriggeredAt = 0

function ownerOnlyReply(sock, from, msg, isOwner) {
  if (isOwner) return false
  void sock.sendMessage(from, { text: '❌ This command is restricted to the bot owner.' }, { quoted: msg })
  return true
}

function getRepository(config) {
  return String(process.env.UPDATE_REPOSITORY || config?.UPDATE_REPOSITORY || 'cleanplata/ULTRA-GURU-MD')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
}

export const commands = [
  {
    name: 'update',
    aliases: ['checkupdate', 'updatecheck'],
    description: 'Owner-only: build and deploy the latest main-branch code from GitHub to the configured Heroku app.',
    category: 'Owner',
    ownerOnly: true,
    execute: async ({ sock, from, msg, isOwner, config }) => {
      if (ownerOnlyReply(sock, from, msg, isOwner)) return
      const repository = getRepository(config)
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        return sock.sendMessage(from, { text: '❌ The configured GitHub repository is invalid.' }, { quoted: msg })
      }

      const repoUrl = `https://github.com/${repository}`
      const apiKey = process.env.HEROKU_API_KEY
      const appName = process.env.HEROKU_APP_NAME
      if (!apiKey || !appName) {
        return sock.sendMessage(from, {
          text: `❌ Automatic deployment is not configured. Add HEROKU_API_KEY and HEROKU_APP_NAME as private host Config Vars, then restart the bot. Never put the API key in source code or share it in chat.\n\nRepository: ${repoUrl}`
        }, { quoted: msg })
      }
      if (updateInProgress) {
        return sock.sendMessage(from, { text: '⏳ An update build is already being requested.' }, { quoted: msg })
      }
      const cooldownRemaining = 5 * 60 * 1000 - (Date.now() - lastUpdateTriggeredAt)
      if (cooldownRemaining > 0) {
        const minutes = Math.ceil(cooldownRemaining / 60000)
        return sock.sendMessage(from, { text: `⏳ An update was just requested. Try again in about ${minutes} minute(s).` }, { quoted: msg })
      }

      updateInProgress = true
      try {
        const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ULTRA-GURU-update-check' },
          signal: AbortSignal.timeout(8000)
        })
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
        const commit = await response.json()
        const latestSha = String(commit.sha || '')
        if (!/^[a-f0-9]{40}$/i.test(latestSha)) throw new Error('GitHub did not return a valid commit SHA.')

        const deployedSha = process.env.HEROKU_SLUG_COMMIT || process.env.SOURCE_VERSION || process.env.GITHUB_SHA || ''
        if (deployedSha && deployedSha.toLowerCase() === latestSha.toLowerCase()) {
          return sock.sendMessage(from, {
            text: `✅ ULTRA GURU is already running the latest commit (${latestSha.slice(0, 7)}).\nRepository: ${repoUrl}`
          }, { quoted: msg })
        }

        const buildResponse = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/builds`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.heroku+json; version=3',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            source_blob: {
              url: `https://github.com/${repository}/archive/${latestSha}.tar.gz`,
              version: latestSha,
              version_description: commit.commit?.message?.split('\n')[0] || 'ULTRA GURU update'
            }
          }),
          signal: AbortSignal.timeout(15000)
        })
        if (!buildResponse.ok) {
          throw new Error(`Heroku returned HTTP ${buildResponse.status}. Check the app name, token permissions, and deployment logs.`)
        }
        const build = await buildResponse.json()
        lastUpdateTriggeredAt = Date.now()
        return sock.sendMessage(from, {
          text: `🚀 *ULTRA GURU UPDATE STARTED*\n\nRepository: ${repoUrl}\nCommit: ${latestSha.slice(0, 7)}\nBuild: ${build.id || 'accepted'}\nStatus: *${String(build.status || 'pending').toUpperCase()}*\n\nHeroku is building this pinned GitHub commit. If the build succeeds, Heroku releases it and restarts the app automatically. Check Heroku build logs if it fails.`
        }, { quoted: msg })
      } catch (error) {
        return sock.sendMessage(from, {
          text: `❌ Could not start the Heroku update: ${error.message}\n\nRepository: ${repoUrl}\nCheck HEROKU_APP_NAME and HEROKU_API_KEY in the host Config Vars. The API key was not included in this message.`
        }, { quoted: msg })
      } finally {
        updateInProgress = false
      }
    }
  },
  {
    name: 'security',
    aliases: ['securitycheck', 'securestatus'],
    description: 'Owner-only: show the active security and status feature settings.',
    category: 'Settings',
    ownerOnly: true,
    execute: async ({ sock, from, msg, isOwner }) => {
      if (ownerOnlyReply(sock, from, msg, isOwner)) return
      const rows = [
        `• Mode: *${String(CONFIG.MODE || 'private').toUpperCase()}*`,
        ...Object.values(FEATURE_FLAGS).map(({ label, key }) => `• ${label}: *${CONFIG[key] ? 'ON' : 'OFF'}*`),
        `• Auto-read chats: *${CONFIG.AUTO_READ ? 'ON' : 'OFF'}*`
      ]
      return sock.sendMessage(from, {
        text: `*🛡️ ULTRA GURU SECURITY STATUS*\n\n${rows.join('\n')}\n\nUse .antidelete on|off, .antiedit on|off, .autoview on|off, or .autolike on|off to change features for this running process. These toggles reset on restart; set the matching host Config Var to keep a setting across restarts.`
      }, { quoted: msg })
    }
  },
  ...Object.entries(FEATURE_FLAGS).map(([name, { label, key }]) => ({
    name,
    aliases: name === 'antidelete' ? ['antidel'] : name === 'autoview' ? ['autoviewstatus'] : name === 'autolike' ? ['statuslike'] : [],
    description: `Owner-only: show or temporarily change ${label.toLowerCase()} (runtime only).`,
    category: 'Settings',
    ownerOnly: true,
    execute: async ({ sock, from, msg, text, isOwner }) => {
      if (ownerOnlyReply(sock, from, msg, isOwner)) return
      const requested = String(text || '').trim().toLowerCase()
      if (!requested || requested === 'status') {
        return sock.sendMessage(from, {
          text: `${label}: *${CONFIG[key] ? 'ON' : 'OFF'}*\nUsage: .${name} on | off\n\nThis setting change lasts only until the process restarts. Set the matching host Config Var for a persistent change.`
        }, { quoted: msg })
      }
      if (!['on', 'off'].includes(requested)) {
        return sock.sendMessage(from, { text: `Use .${name} on or .${name} off.` }, { quoted: msg })
      }
      CONFIG[key] = requested === 'on'
      return sock.sendMessage(from, {
        text: `✅ ${label} is now *${requested.toUpperCase()}* for this running process.\nFor persistence after restart, set the matching host Config Var: ${key}=${requested}.`
      }, { quoted: msg })
    }
  }))
]
