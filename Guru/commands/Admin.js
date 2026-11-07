import CONFIG from '../../Guru Tech/config.js'

const FEATURE_FLAGS = {
  antidelete: { label: 'Anti-delete', key: 'ANTIDELETE' },
  antiedit: { label: 'Anti-edit', key: 'ANTIEDIT' },
  autoview: { label: 'Auto-view status', key: 'AUTO_VIEW' },
  autolike: { label: 'Auto-like status', key: 'AUTO_LIKE' }
}

function ownerOnlyReply(sock, from, msg, isOwner) {
  if (isOwner) return false
  void sock.sendMessage(from, { text: '❌ This command is restricted to the bot owner.' }, { quoted: msg })
  return true
}

function getRepository(config) {
  return String(config?.GITHUB_REPO || CONFIG.GITHUB_REPO || 'GuruhTech/ULTRA-GURU')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
}

export const commands = [
  {
    name: 'update',
    aliases: ['checkupdate', 'updatecheck'],
    description: 'Owner-only: check the primary GitHub repository for the latest version and deployment guidance.',
    category: 'Owner',
    ownerOnly: true,
    execute: async ({ sock, from, msg, isOwner, config }) => {
      if (ownerOnlyReply(sock, from, msg, isOwner)) return
      const repository = getRepository(config)
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        return sock.sendMessage(from, { text: '❌ The configured GitHub repository is invalid.' }, { quoted: msg })
      }

      const repoUrl = `https://github.com/${repository}`
      try {
        const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ULTRA-GURU-update-check' },
          signal: AbortSignal.timeout(8000)
        })
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
        const commit = await response.json()
        const latestSha = String(commit.sha || '')
        const deployedSha = process.env.HEROKU_SLUG_COMMIT || process.env.SOURCE_VERSION || process.env.GITHUB_SHA || ''
        const sameVersion = deployedSha && latestSha && deployedSha.startsWith(latestSha.slice(0, 7))
        const summary = sameVersion
          ? '✅ The deployed commit matches the latest commit reported by GitHub.'
          : deployedSha
            ? `🆕 A newer repository commit may be available. Deployed: ${deployedSha.slice(0, 7)} · Latest: ${latestSha.slice(0, 7)}.`
            : `Latest commit: ${latestSha.slice(0, 7)}. This host does not expose its deployed commit, so I cannot compare versions from inside the bot.`
        const text = `*🔄 ULTRA GURU UPDATE CHECK*\n\n${summary}\n\nRepository: ${repoUrl}\nLatest commit: ${commit.commit?.message?.split('\n')[0] || 'No commit message'}\n\nThis command only checks for updates; it does not download or execute code. To install changes, deploy the repository from your hosting dashboard. Enable that host's GitHub auto-deploy option if you want new pushes deployed automatically.`
        return sock.sendMessage(from, { text }, { quoted: msg })
      } catch (error) {
        return sock.sendMessage(from, {
          text: `❌ Could not check GitHub right now: ${error.message}\n\nRepository: ${repoUrl}`
        }, { quoted: msg })
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
        text: `*🛡️ ULTRA GURU SECURITY STATUS*\n\n${rows.join('\n')}\n\nUse \.antidelete on|off, \.autoview on|off, or \.autolike on|off to change a feature for this running process. These toggles reset on restart; set the matching host Config Var to keep the setting across restarts.`
      }, { quoted: msg })
    }
  },
  ...Object.entries(FEATURE_FLAGS).map(([name, { label, key }]) => ({
    name,
    aliases: name === 'antidelete' ? ['antidel'] : name === 'autoview' ? ['autoviewstatus'] : ['statuslike'],
    description: `Owner-only: show or temporarily change ${label.toLowerCase()} (runtime only).`,
    category: 'Settings',
    ownerOnly: true,
    execute: async ({ sock, from, msg, text, isOwner }) => {
      if (ownerOnlyReply(sock, from, msg, isOwner)) return
      const requested = String(text || '').trim().toLowerCase()
      if (!requested || requested === 'status') {
        return sock.sendMessage(from, {
          text: `${label}: *${CONFIG[key] ? 'ON' : 'OFF'}*\nUsage: \.${name} on | off\n\nThis setting change lasts only until the process restarts. Set the matching host Config Var for a persistent change.`
        }, { quoted: msg })
      }
      if (!['on', 'off'].includes(requested)) {
        return sock.sendMessage(from, { text: `Use \.${name} on or \.${name} off.` }, { quoted: msg })
      }
      CONFIG[key] = requested === 'on'
      return sock.sendMessage(from, {
        text: `✅ ${label} is now *${requested.toUpperCase()}* for this running process.\nFor persistence after restart, set the matching host Config Var: ${key}=${requested}.`
      }, { quoted: msg })
    }
  }))
]
