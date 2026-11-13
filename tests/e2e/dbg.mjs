import { _electron as electron } from 'playwright'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const root = path.resolve('.')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vassago-dbg-'))
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ schema: 1, profiles: [{ id: 'p', name: 'VassagoOp', username: 'VassagoOp', auth: 'offline' }], activeProfileId: 'p', servers: [{ id: 's', name: 'Local Paper', host: '127.0.0.1', port: 25570 }], recents: [], settings: { acceptedOfflineWarning: true, renderDistance: Number(process.env.RD ?? 8) } }))
const app = await electron.launch({ ...(process.env.VASSAGO_APP_PATH ? { executablePath: process.env.VASSAGO_APP_PATH, args: ['--no-sandbox'] } : { args: [root, '--no-sandbox'] }), env: { ...process.env, VASSAGO_E2E: '1', VASSAGO_USER_DATA: userData, VASSAGO_SOFTWARE_GL: '1' } })
const page = await app.firstWindow()
page.on('pageerror', e => console.log('[pageerror]', e.message))
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)) })
await page.click('[data-nav="servers"]'); await page.click('[data-testid="join-server"]')
await page.waitForSelector('[data-testid="pack-decline"]', { timeout: 30000 }); await page.click('[data-testid="pack-decline"]')
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < Number(process.env.N ?? 10); i++) {
  await sleep(2000)
  const s = await page.evaluate(() => { const g = window.__vassago?.game; return g ? { ...g.debugState(), phase: g.store.get().phase, ready: g.store.get().worldReady } : null })
  console.log(JSON.stringify(s))
}
if (process.env.CMD) { for (const c of process.env.CMD.split(';')) { await page.evaluate(t => window.__vassago.game.sendChat(t), c); await sleep(700) } await sleep(2500) }
if (process.env.LOOK) { const [y, p] = process.env.LOOK.split(',').map(Number); await page.evaluate(([y, p]) => window.__vassago.game.setLook(y, p), [y, p]); await sleep(1500) }
await page.screenshot({ path: process.env.OUT ?? 'tests/e2e/artifacts/dbg.png' })
console.log(fs.readFileSync(path.join(userData, 'logs', 'vassago.log'), 'utf8').split('\n').filter(l => /warn|error/.test(l)).slice(-8).join('\n'))
await app.close()
