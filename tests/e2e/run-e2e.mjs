#!/usr/bin/env node
// End-to-end test: drives the real Electron app against a real PaperMC server.
//
//   xvfb-run -a node tests/e2e/run-e2e.mjs            (Linux/CI; starts its own server, needs MC_EULA=true)
//   VASSAGO_TEST_PORT=25570 node tests/e2e/run-e2e.mjs (reuse a running `npm run test-server`)
//
// Screenshots are written to tests/e2e/artifacts/.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startServer, parseArgs } from '../../scripts/test-server.mjs'

const require = createRequire(import.meta.url)
const mineflayer = require('mineflayer')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const artifacts = path.join(root, 'tests', 'e2e', 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vassago-e2e-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const results = []
let failed = false
async function step (name, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`)
  } catch (err) {
    failed = true
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(err?.message ?? err) })
    console.log(`  ✗ ${name}\n      ${String(err?.stack ?? err).split('\n').slice(0, 6).join('\n      ')}`)
  }
}
async function until (fn, timeout = 15000, what = 'condition') {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what}`)
    await sleep(100)
  }
}

let server = null
let port = Number(process.env.VASSAGO_TEST_PORT ?? 0)
if (!port) {
  port = 25590
  console.log('starting Paper test server…')
  server = await startServer({ ...parseArgs([]), port, resourcePack: 'http://127.0.0.1:9/vassago-test-pack.zip', acceptEula: process.env.MC_EULA === 'true' }, { quiet: true })
}

// VASSAGO_APP_PATH=<packaged executable> tests an installed/unpacked build instead of the dev tree.
const packaged = process.env.VASSAGO_APP_PATH
const args = packaged ? [] : [root]
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
const app = await electron.launch({
  ...(packaged ? { executablePath: packaged } : {}),
  args,
  env: { ...process.env, VASSAGO_E2E: '1', VASSAGO_USER_DATA: userData, VASSAGO_SOFTWARE_GL: process.env.VASSAGO_SOFTWARE_GL ?? '1' }
})
const page = await app.firstWindow()
page.on('pageerror', err => console.log('    [pageerror]', err.message))
const shot = name => page.screenshot({ path: path.join(artifacts, name) })
const game = fn => page.evaluate(fn)
const state = () => page.evaluate(() => window.__vassago?.game.debugState())
const say = text => page.evaluate(t => window.__vassago.game.sendChat(t), text)

let bot = null
let px = 0; let py = 0; let pz = 0

try {
  console.log('launcher')
  await step('application window opens and the launcher renders', async () => {
    await page.waitForSelector('.brand-name', { timeout: 30000 })
    const title = await page.title()
    if (title !== 'Vassago') throw new Error(`unexpected title ${title}`)
    const iso = await page.evaluate(() => window.crossOriginIsolated)
    await sleep(600)
    await shot('01-play-empty.png')
    return `crossOriginIsolated=${iso}`
  })

  await step('all six navigation sections render', async () => {
    for (const id of ['servers', 'direct', 'profiles', 'settings', 'about', 'play']) {
      await page.click(`[data-nav="${id}"]`)
      await page.waitForSelector('.page h1')
      await sleep(250)
      if (id === 'settings') await shot('02-settings.png')
      if (id === 'about') await shot('03-about.png')
    }
  })

  await step('graphics settings: presets apply and persist', async () => {
    await page.click('[data-nav="settings"]')
    await page.click('.settings-card .segmented >> text=Low')
    await sleep(300)
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
    if (cfg.settings.preset !== 'low' || cfg.settings.renderDistance !== 5 || cfg.settings.smoothLighting !== false) throw new Error(`preset not saved: ${JSON.stringify(cfg.settings)}`)
    // software rendering in CI: keep smooth lighting on for the screenshots, small view distance for speed
    await page.click('.row:has-text("Smooth lighting") .toggle')
    await page.click('.row:has-text("Clouds") .toggle')
    await sleep(300)
    const cfg2 = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
    if (cfg2.settings.preset !== 'custom' || !cfg2.settings.smoothLighting || !cfg2.settings.clouds) throw new Error('custom settings not saved')
    return `render distance ${cfg2.settings.renderDistance}, preset ${cfg2.settings.preset}`
  })

  await step('creates a private-server (offline) profile', async () => {
    await page.click('[data-nav="profiles"]')
    await page.click('[data-testid="add-offline"]')
    await page.fill('[data-testid="profile-username"]', 'no')
    if (!(await page.isDisabled('[data-testid="save-profile"]'))) throw new Error('invalid username was accepted')
    await page.fill('[data-testid="profile-username"]', 'VassagoOp')
    await page.click('[data-testid="save-profile"]')
    await page.waitForSelector('.profile-card.active >> text=VassagoOp')
    await sleep(250)
    await shot('04-profiles.png')
  })

  await step('adds a saved server and shows its live status ping', async () => {
    await page.click('[data-nav="servers"]')
    await page.click('[data-testid="add-server"]')
    await page.fill('[data-testid="server-name"]', 'Local Paper')
    await page.fill('[data-testid="server-address"]', `127.0.0.1:${port}`)
    await page.waitForSelector('.modal .badge.ok', { timeout: 15000 })
    await page.click('[data-testid="save-server"]')
    await page.waitForSelector('[data-testid="server-card"] .badge.ok', { timeout: 15000 })
    const text = await page.textContent('[data-testid="server-card"]')
    if (!/1\.21\.11/.test(text) || !/verified/.test(text)) throw new Error(`status not shown: ${text}`)
    await sleep(300)
    await shot('05-servers.png')
    return text.replace(/\s+/g, ' ').slice(0, 90)
  })

  await step('shows a clean error when a connection is refused', async () => {
    await page.click('[data-nav="direct"]')
    await page.fill('[data-testid="direct-address"]', '127.0.0.1:1')
    await page.click('[data-testid="direct-connect"]')
    await page.waitForSelector('[data-testid="accept-offline"]')
    await sleep(250)
    await shot('06-offline-warning.png')
    await page.click('[data-testid="accept-offline"]')
    await page.waitForSelector('[data-testid="disconnected"]', { timeout: 20000 })
    const reason = await page.textContent('[data-testid="disconnect-reason"]')
    if (!/refused/i.test(reason)) throw new Error(`unexpected reason: ${reason}`)
    await sleep(250)
    await shot('07-connection-refused.png')
    await page.click('[data-testid="back-to-menu"]')
    await page.waitForSelector('.brand-name')
    return reason
  })

  console.log('in game')
  await step('joins the offline-mode server; asks consent for the resource pack', async () => {
    await page.click('[data-nav="servers"]')
    await page.click('[data-testid="join-server"]')
    await page.waitForSelector('[data-testid="pack-decline"]', { timeout: 30000 })
    await sleep(200)
    await shot('08-resource-pack-prompt.png')
    await page.click('[data-testid="pack-decline"]')
    await page.waitForSelector('[data-testid="hotbar"]', { timeout: 180000 })
  })

  await step('renders the world (chunks meshed and drawn)', async () => {
    // start from the surface in daylight, wherever the player last logged out
    const p0 = (await until(async () => { const st = await state(); return st?.pos && st.pos.y !== 0 ? st : null }, 30000, 'position')).pos
    await say('/gamemode survival')
    await say('/time set 1000')
    await say('/weather clear')
    await say(`/spreadplayers ${Math.floor(p0.x)} ${Math.floor(p0.z)} 0 3 under 100 false VassagoOp`)
    await sleep(2500)
    await until(async () => (await state()).onGround, 20000, 'standing on the surface')
    await game(() => window.__vassago.game.setLook(0.6, -0.12))
    const s = await until(async () => { const st = await state(); return st?.world && st.world.sectionsMeshed > 20 && st.world.queue < 40 ? st : null }, 120000, 'meshed chunks')
    await sleep(1500)
    await shot('09-world.png')
    const d = (await state()).draw
    if (!d || d.triangles < 1000) throw new Error(`nothing drawn: ${JSON.stringify(d)}`)
    return `${s.world.columns} chunks, ${s.world.sectionsMeshed} sections, ${d.triangles} tris/frame, ${s.fps} fps (software GL)`
  })

  await step('prepares a test platform via operator chat commands', async () => {
    await say('/gamemode creative')
    await until(async () => (await state()).gameMode === 'creative', 10000, 'creative mode')
    const s = await state()
    const ground = Math.floor(s.pos.y)
    px = Math.floor(s.pos.x); pz = Math.floor(s.pos.z); py = ground + 24
    await say(`/fill ${px - 6} ${ground + 4} ${pz - 6} ${px + 6} ${ground + 60} ${pz + 6} minecraft:air`) // leftovers from aborted runs
    await say(`/fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py} ${pz + 6} minecraft:smooth_stone`)
    await say(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await until(async () => { const st = await state(); return Math.abs(st.pos.y - (py + 1)) < 0.01 && st.onGround }, 15000, 'teleport to platform')
    await say('/time set 1000')
    await say('/weather clear')
  })

  await step('first-person movement: walk and jump', async () => {
    await game(() => window.__vassago.game.setLook(0, 0))
    const a = await state()
    await game(() => window.__vassago.game.setControls({ forward: true }))
    await sleep(900)
    await game(() => window.__vassago.game.setControls({ forward: false }))
    await sleep(400)
    const b = await state()
    if (a.pos.z - b.pos.z < 2) throw new Error(`did not walk north: ${a.pos.z} → ${b.pos.z}`)
    let maxY = b.pos.y
    await game(() => window.__vassago.game.setControls({ jump: true }))
    for (let i = 0; i < 12; i++) { await sleep(40); maxY = Math.max(maxY, (await state()).pos.y) }
    await game(() => window.__vassago.game.setControls({ jump: false }))
    if (maxY - (py + 1) < 0.9) throw new Error(`jump too low: ${maxY - (py + 1)}`)
    await say(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await until(async () => Math.abs((await state()).pos.z - (pz + 0.5)) < 0.01, 10000, 'teleport back')
    return `walked ${(a.pos.z - b.pos.z).toFixed(2)} blocks, jumped ${(maxY - (py + 1)).toFixed(2)}`
  })

  let locked = false
  await step('captures the mouse and looks around with real mouse input', async () => {
    await page.mouse.click(640, 300)
    locked = await until(() => page.evaluate(() => document.pointerLockElement != null), 4000, 'pointer lock').catch(() => false)
    if (!locked) return 'pointer lock unavailable in this display server — falling back to the scripted input API'
    const before = (await state()).yaw
    await page.mouse.move(700, 300, { steps: 5 })
    await sleep(200)
    const after = (await state()).yaw
    if (before === after) throw new Error('mouse movement did not turn the camera')
    return `yaw ${before.toFixed(3)} → ${after.toFixed(3)}`
  })

  await step('a second player joins and is visible', async () => {
    bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'VassagoBob', auth: 'offline', version: '1.21.11', hideErrors: true, plugins: { resource_pack: false } })
    bot.on('error', () => {})
    bot._client.on('add_resource_pack', p => bot._client.write('resource_pack_receive', { uuid: p.uuid, result: 1 }))
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error(String(r)))); setTimeout(() => reject(new Error('bot spawn timeout')), 60000) })
    await say(`/tp VassagoBob ${px + 0.5} ${py + 1} ${pz - 3.5}`)
    await until(async () => (await state()).entities >= 1, 15000, 'entity for second player')
    await sleep(800)
    await bot.look(Math.PI, 0, true) // face the camera (south)
    await game(() => window.__vassago.game.setLook(0, -0.08))
    await sleep(900)
    await shot('10-second-player.png')
    const seen = await page.evaluate(() => { const g = window.__vassago.game; return [...g.entities.map.values()].map(t => t.dto.username).filter(Boolean) })
    if (!seen.includes('VassagoBob')) throw new Error(`players seen: ${seen}`)
    if (!Object.keys(bot.players).includes('VassagoOp')) throw new Error('bot does not see the Vassago player')
    return `sees ${seen.join(', ')}`
  })

  await step('chat works in both directions through the chat UI', async () => {
    const got = new Promise((resolve, reject) => { bot.on('messagestr', m => { if (m.includes('hello from the vassago ui')) resolve(m) }); setTimeout(() => reject(new Error('bot never received chat')), 15000) })
    await page.keyboard.press('KeyT')
    await page.waitForSelector('[data-testid="chat-input"]')
    await page.keyboard.type('hello from the vassago ui')
    await sleep(150)
    await shot('11-chat-open.png')
    await page.keyboard.press('Enter')
    await got
    bot.chat('hi vassago, bob here')
    await until(async () => (await page.textContent('[data-testid="chat-log"]')).includes('hi vassago, bob here'), 10000, 'incoming chat line')
    await sleep(300)
    await shot('12-chat.png')
  })

  await step('places and breaks a block (visible to the other player)', async () => {
    await say('/clear VassagoOp')
    await say('/give VassagoOp minecraft:oak_planks 64')
    await until(() => page.evaluate(() => window.__vassago.game.store.get().inventory?.slots.some(s => s?.name === 'oak_planks')), 10000, 'planks in inventory')
    const slot = await page.evaluate(() => window.__vassago.game.store.get().inventory.slots.findIndex(s => s?.name === 'oak_planks'))
    await page.keyboard.press(`Digit${slot - 36 + 1}`)
    // aim at the top face of the platform block two blocks east
    await say(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await sleep(500)
    await game(() => window.__vassago.game.setLook(-Math.PI / 2, -Math.atan2(1.62, 2)))
    const target = await until(async () => { const t = (await state()).target; return t && t.y === py && t.face === 1 ? t : null }, 5000, 'block target')
    const key = [target.x, target.y + 1, target.z]
    const getBlock = () => page.evaluate(k => window.__vassago.game.world.getBlock(k[0], k[1], k[2]), key)
    // At software-rendering frame rates a click can land on a frame where the target is being
    // recomputed; retry like a player would, and report how many clicks it took.
    let clicks = 0
    for (; clicks < 3 && (await getBlock()) === 0; clicks++) {
      if (locked && await page.evaluate(() => document.pointerLockElement != null)) { await page.mouse.down({ button: 'right' }); await sleep(80); await page.mouse.up({ button: 'right' }) } else await game(() => { const g = window.__vassago.game; g.secondaryAction() })
      await until(async () => (await getBlock()) !== 0, 3000, 'placed block in client world').catch(() => {})
    }
    if ((await getBlock()) === 0) throw new Error('block was not placed after 3 clicks')
    const { Vec3 } = require('vec3')
    await until(() => bot.blockAt(new Vec3(...key))?.name === 'oak_planks', 8000, 'placed block seen by second player')
    await sleep(500)
    await shot('13-block-placed.png')
    // now target the new block and break it (creative: instant)
    await until(async () => { const t = (await state()).target; return t && t.y === key[1] }, 5000, 'target on placed block')
    if (locked && await page.evaluate(() => document.pointerLockElement != null)) { await page.mouse.down(); await sleep(80); await page.mouse.up() } else await game(() => { const g = window.__vassago.game; g.primaryAction(); g.stopDig() })
    await until(async () => (await getBlock()) === 0, 8000, 'block broken in client world')
    await until(() => bot.blockAt(new Vec3(...key))?.name === 'air', 8000, 'break seen by second player')
    return `at ${key.join(', ')} via ${locked ? 'real mouse buttons' : 'scripted input'}${clicks > 1 ? ` (${clicks} clicks needed)` : ''}`
  })

  await step('inventory screen: pick up and move an item, 2×2 crafting', async () => {
    await say('/give VassagoOp minecraft:oak_log 2')
    await until(() => page.evaluate(() => window.__vassago.game.store.get().inventory?.slots.some(s => s?.name === 'oak_log')), 10000, 'logs')
    await page.keyboard.press('KeyE')
    await page.waitForSelector('[data-testid="inventory"]')
    await page.click('.slot[data-item="oak_log"]')
    await page.waitForSelector('.cursor-item')
    await page.click('.slot[data-slot="1"]', { button: 'right' }) // one log into the crafting grid
    await page.waitForSelector('.slot[data-slot="0"][data-item="oak_planks"]', { timeout: 8000 })
    await page.click('.slot[data-slot="20"]') // put the remaining log down
    await page.waitForSelector('.slot[data-slot="20"][data-item="oak_log"]', { timeout: 8000 })
    await page.mouse.move(640, 120)
    await sleep(300)
    await shot('14-inventory-crafting.png')
    await page.click('.slot[data-slot="0"]') // take crafted planks
    await page.waitForSelector('.cursor-item')
    await page.click('.slot[data-slot="22"]')
    await page.waitForSelector('.slot[data-slot="22"][data-item="oak_planks"]', { timeout: 8000 })
    await page.keyboard.press('KeyE')
    await page.waitForSelector('[data-testid="inventory"]', { state: 'detached' })
  })

  await step('opens a container (chest) screen', async () => {
    await say(`/setblock ${px + 2} ${py + 1} ${pz} minecraft:chest`)
    await say(`/tp VassagoOp ${px + 0.5} ${py + 1} ${pz + 0.5}`)
    await sleep(600)
    await game(() => window.__vassago.game.setLook(-Math.PI / 2, -Math.atan2(1.2, 1.6)))
    await until(async () => { const t = (await state()).target; return t && t.x === px + 2 && t.y === py + 1 }, 6000, 'target on chest')
    await game(() => { const g = window.__vassago.game; g.secondaryAction() })
    await page.waitForSelector('[data-testid="container-title"]', { timeout: 8000 })
    await sleep(300)
    await shot('15-chest.png')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="inventory"]', { state: 'detached' })
    await say(`/setblock ${px + 2} ${py + 1} ${pz} minecraft:air`)
  })

  await step('survival HUD: health, hunger, damage feedback, death and respawn', async () => {
    await say('/gamemode survival')
    await page.waitForSelector('[data-testid="hearts"]', { timeout: 8000 })
    await say('/damage VassagoOp 5')
    await until(async () => Number(await page.getAttribute('[data-testid="hearts"]', 'data-health')) <= 15, 8000, 'health drop in HUD')
    await game(() => window.__vassago.game.setLook(0.6, -0.25))
    await sleep(400)
    await shot('16-survival-hud.png')
    await say('/kill VassagoOp')
    await page.waitForSelector('[data-testid="respawn"]', { timeout: 8000 })
    await sleep(500)
    await shot('17-death.png')
    await page.click('[data-testid="respawn"]')
    await page.waitForSelector('[data-testid="respawn"]', { state: 'detached', timeout: 15000 })
    await until(async () => Number(await page.getAttribute('[data-testid="hearts"]', 'data-health')) === 20, 10000, 'full health after respawn')
  })

  await step('debug / performance overlay (F3)', async () => {
    await page.keyboard.press('F3')
    await page.waitForSelector('[data-testid="debug"]')
    await sleep(900)
    const text = await page.textContent('[data-testid="debug"]')
    if (!/fps/.test(text) || !/XYZ/.test(text) || !/Chunks/.test(text)) throw new Error(`overlay incomplete: ${text}`)
    await shot('18-debug-overlay.png')
    await page.keyboard.press('F3')
  })

  await step('pause menu, in-game settings and clean disconnect', async () => {
    // leave the world as we found it
    await say(`/spreadplayers ${px} ${pz} 0 3 under ${py} false @a`)
    await sleep(1500)
    await say(`/fill ${px - 6} ${py} ${pz - 6} ${px + 6} ${py + 2} ${pz + 6} minecraft:air`)
    await sleep(500)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="resume"]')
    await sleep(250)
    await shot('19-pause.png')
    await page.click('[data-testid="disconnect"]')
    await page.waitForSelector('.brand-name')
    await page.click('[data-nav="play"]')
    await page.waitForSelector('.recent-card >> text=Local Paper')
    await sleep(500)
    await shot('20-play-recent.png')
  })

  await step('reconnects after being kicked, with the server-provided reason shown', async () => {
    await page.click('[data-testid="play-featured"]')
    await page.waitForSelector('[data-testid="pack-decline"]', { timeout: 30000 })
    await page.click('[data-testid="pack-decline"]')
    await page.waitForSelector('[data-testid="hotbar"]', { timeout: 120000 })
    bot.chat('/kick VassagoOp nope') // not an operator: must have no effect
    await sleep(500)
    if (server) server.command('kick VassagoOp e2e kick test')
    else await say('/kick VassagoOp e2e kick test')
    await page.waitForSelector('[data-testid="disconnected"]', { timeout: 15000 })
    const reason = await page.textContent('[data-testid="disconnect-reason"]')
    if (!/e2e kick test/.test(reason)) throw new Error(`unexpected reason: ${reason}`)
    await sleep(250)
    await shot('21-kicked.png')
    await page.click('[data-testid="reconnect"]')
    await page.waitForSelector('[data-testid="pack-decline"]', { timeout: 30000 })
    await page.click('[data-testid="pack-decline"]')
    await page.waitForSelector('[data-testid="hotbar"]', { timeout: 120000 })
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="disconnect"]')
    await page.click('[data-testid="disconnect"]')
    await page.waitForSelector('.brand-name')
    return reason
  })

  await step('exports diagnostics', async () => {
    await page.click('[data-nav="settings"]')
    await page.click('.segmented >> text=General')
    await page.click('[data-testid="export-diagnostics"]')
    const file = path.join(userData, 'diagnostics.json')
    await until(() => fs.existsSync(file), 10000, 'diagnostics file')
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!d.app?.version || !Array.isArray(d.log) || d.log.length === 0) throw new Error('diagnostics incomplete')
    if (JSON.stringify(d).includes('msa:')) throw new Error('diagnostics must not contain account token entries')
    return `${d.log.length} log lines, gpu: ${d.gpuFeatures?.webgl2 ?? 'n/a'}`
  })
} finally {
  try { bot?.quit() } catch {}
  await app.close().catch(() => {})
  if (server) await server.stop()
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
}

const passed = results.filter(r => r.ok).length
console.log(`\n${passed}/${results.length} end-to-end steps passed`)
process.exit(failed ? 1 : 0)
