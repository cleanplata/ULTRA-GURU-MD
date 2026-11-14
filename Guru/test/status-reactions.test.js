import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseStatusReactionEmoji, DEFAULT_STATUS_REACTIONS, isSingleEmoji, normalizeStatusReaction } from '../../Guru Tech/statusReactions.js'

test('default random pool matches Toxic-MD’s 25 status emojis', () => {
  assert.deepEqual(DEFAULT_STATUS_REACTIONS, [
    '❤️', '🔥', '😂', '😍', '👏', '🥰', '💯', '😭', '🤣', '🙏', '👌', '💪',
    '🤩', '😎', '🥳', '✨', '💀', '🤯', '😤', '💅', '👀', '🎉', '😈', '🤫', '🫶'
  ])
})

test('fixed emoji is used for every status reaction', () => {
  assert.equal(chooseStatusReactionEmoji('🔥', () => 0), '🔥')
})

test('random mode uses the default pool or the legacy custom pool', () => {
  assert.equal(chooseStatusReactionEmoji('random', () => 0), '❤️')
  assert.equal(chooseStatusReactionEmoji('random', () => 0.999999), '🫶')
  assert.equal(chooseStatusReactionEmoji('random', () => 0.99, ['🌿', '🐾']), '🐾')
})

test('one-emoji validation accepts graphemes and rejects text or multiple emojis', () => {
  assert.equal(isSingleEmoji('❤️'), true)
  assert.equal(isSingleEmoji('👨‍👩‍👧‍👦'), true)
  assert.equal(isSingleEmoji('🔥😂'), false)
  assert.equal(isSingleEmoji('hello'), false)
  assert.equal(normalizeStatusReaction('random'), 'random')
  assert.equal(normalizeStatusReaction('several words'), 'random')
})

test('owner runtime settings persist emoji and status auto-like switches', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-guru-status-'))
  const settingsPath = path.join(directory, 'runtime-settings.json')
  const previousPath = process.env.RUNTIME_SETTINGS_FILE
  process.env.RUNTIME_SETTINGS_FILE = settingsPath
  try {
    const { applyRuntimeSettings, updateRuntimeSettings } = await import(`../../Guru Tech/runtimeSettings.js?test=${Date.now()}`)
    const config = { AUTO_VIEW: false, AUTO_LIKE: false, STATUS_LIKE_EMOJI: 'random' }
    updateRuntimeSettings(config, { AUTO_VIEW: true, AUTO_LIKE: true, STATUS_LIKE_EMOJI: '🔥' })
    assert.deepEqual(config, { AUTO_VIEW: true, AUTO_LIKE: true, STATUS_LIKE_EMOJI: '🔥' })

    const restartedConfig = { AUTO_VIEW: false, AUTO_LIKE: false, STATUS_LIKE_EMOJI: 'random' }
    applyRuntimeSettings(restartedConfig)
    assert.deepEqual(restartedConfig, config)
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).STATUS_LIKE_EMOJI, '🔥')
    assert.throws(() => updateRuntimeSettings(config, { STATUS_LIKE_EMOJI: 'not an emoji' }), /Unsupported runtime setting/)
  } finally {
    if (previousPath === undefined) delete process.env.RUNTIME_SETTINGS_FILE
    else process.env.RUNTIME_SETTINGS_FILE = previousPath
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
