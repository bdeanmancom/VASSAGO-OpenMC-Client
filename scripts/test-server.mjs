#!/usr/bin/env node
// Downloads and launches a local PaperMC server for compatibility testing.
//
//   node scripts/test-server.mjs --version 1.21.11 --port 25570 --accept-eula
//   node scripts/test-server.mjs --online        (online-mode=true profile)
//
// The server binds to 127.0.0.1 only. Offline-mode servers must never be exposed
// publicly without safeguards against username impersonation.
//
// Running a Minecraft server requires agreeing to the Minecraft EULA
// (https://aka.ms/MinecraftEULA). This script only writes eula=true when you pass
// --accept-eula or set MC_EULA=true.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function parseArgs (argv) {
  const out = { version: '1.21.11', port: 25570, online: false, acceptEula: process.env.MC_EULA === 'true', levelType: 'minecraft:normal', seed: 'vassago', gamemode: 'survival' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version') out.version = argv[++i]
    else if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--online') out.online = true
    else if (a === '--accept-eula') out.acceptEula = true
    else if (a === '--flat') out.levelType = 'minecraft:flat'
    else if (a === '--seed') out.seed = argv[++i]
    else if (a === '--gamemode') out.gamemode = argv[++i]
    else if (a === '--resource-pack') out.resourcePack = argv[++i]
  }
  return out
}

async function downloadPaper (version, dest) {
  const api = `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`
  const res = await fetch(api, { headers: { 'User-Agent': 'vassago-client-test-harness' } })
  if (!res.ok) throw new Error(`Paper build lookup failed for ${version}: HTTP ${res.status}`)
  const build = await res.json()
  const dl = build.downloads['server:default']
  const jar = await fetch(dl.url)
  if (!jar.ok) throw new Error(`Paper download failed: HTTP ${jar.status}`)
  const buf = Buffer.from(await jar.arrayBuffer())
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== dl.checksums.sha256) throw new Error('Paper jar checksum mismatch')
  fs.writeFileSync(dest, buf)
}

/** Prepare (download + configure) a server directory. Returns { dir, jar }. */
export async function prepareServer (opts) {
  const dir = path.join(root, '.test-server', `${opts.version}-${opts.online ? 'online' : 'offline'}-${opts.port}`)
  fs.mkdirSync(dir, { recursive: true })
  const cache = path.join(root, '.test-server', 'cache')
  fs.mkdirSync(cache, { recursive: true })
  const jar = path.join(cache, `paper-${opts.version}.jar`)
  if (!fs.existsSync(jar)) {
    console.log(`[test-server] downloading Paper ${opts.version}…`)
    await downloadPaper(opts.version, jar)
  }
  if (!opts.acceptEula) {
    throw new Error('Refusing to start: pass --accept-eula (or MC_EULA=true) to confirm you agree to the Minecraft EULA https://aka.ms/MinecraftEULA')
  }
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n')
  const props = {
    'online-mode': String(opts.online),
    'server-ip': '127.0.0.1',
    'server-port': String(opts.port),
    'level-type': opts.levelType,
    'level-seed': opts.seed,
    gamemode: opts.gamemode,
    difficulty: 'easy',
    'spawn-protection': '0',
    'view-distance': '8',
    'simulation-distance': '5',
    'max-players': '10',
    motd: `Vassago test server (${opts.online ? 'online' : 'offline'} mode)`,
    'enforce-secure-profile': 'false',
    'network-compression-threshold': '256',
    'allow-flight': 'true',
    'sync-chunk-writes': 'false',
    'enable-command-block': 'false'
  }
  if (opts.resourcePack) props['resource-pack'] = opts.resourcePack
  fs.writeFileSync(path.join(dir, 'server.properties'), Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  // Operators for automated tests (offline-mode UUIDs are derived from the username).
  if (!opts.online) {
    const ops = (opts.ops ?? ['VassagoOp']).map(name => ({ uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: true }))
    fs.writeFileSync(path.join(dir, 'ops.json'), JSON.stringify(ops, null, 2))
  }
  return { dir, jar }
}

export function offlineUuid (name) {
  const h = createHash('md5').update('OfflinePlayer:' + name).digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

/** Start the server; resolves once it accepts connections. */
export async function startServer (opts, { quiet = false } = {}) {
  const { dir, jar } = await prepareServer(opts)
  const child = spawn('java', ['-Xms512M', '-Xmx2G', '-Dpaper.disableChannelLimit=true', '-jar', jar, '--nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = []
  let ready
  const done = new Promise((resolve, reject) => {
    ready = resolve
    child.once('exit', code => reject(new Error(`server exited early (code ${code})\n${lines.slice(-30).join('\n')}`)))
    setTimeout(() => reject(new Error('server start timeout\n' + lines.slice(-30).join('\n'))), 300000).unref()
  })
  const onData = d => {
    for (const line of d.toString().split('\n')) {
      if (!line.trim()) continue
      lines.push(line)
      if (lines.length > 2000) lines.shift()
      if (!quiet) console.log('[server] ' + line)
      if (/Done \(.*\)! For help/.test(line)) ready()
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  await done
  return {
    child,
    dir,
    port: opts.port,
    lines,
    command (cmd) { child.stdin.write(cmd + '\n') },
    async stop () {
      if (child.exitCode !== null) return
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.stdin.write('stop\n')
      const t = setTimeout(() => child.kill('SIGKILL'), 20000)
      await exited
      clearTimeout(t)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  startServer(opts).then(s => {
    console.log(`[test-server] ready on 127.0.0.1:${s.port} (online-mode=${opts.online})`)
    process.stdin.pipe(s.child.stdin)
    process.on('SIGINT', () => s.stop().then(() => process.exit(0)))
    process.on('SIGTERM', () => s.stop().then(() => process.exit(0)))
  }).catch(e => { console.error(String(e.message || e)); process.exit(1) })
}
