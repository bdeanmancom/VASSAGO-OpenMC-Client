#!/usr/bin/env node
// Downloads and launches a local PaperMC server for compatibility testing.
//
//   node scripts/test-server.mjs --version 1.21.11 --port 25570 --accept-eula
//   node scripts/test-server.mjs --online        (online-mode=true profile)
//   node scripts/test-server.mjs --version 26.3 --build 244 --via   (Paper 26.3 + ViaVersion/ViaBackwards)
//
// Options: --version <v>  --build <n|latest>  --port <n>  --online  --flat  --seed <s>  --gamemode <m>
//          --resource-pack <url>  --via (latest ViaVersion + ViaBackwards CI builds)  --plugin <jar path or https url> (repeatable)
//          --java <path to a java binary> (or VASSAGO_JAVA). Paper 26.x needs Java 25: when the Java on PATH is
//          older, a Temurin JDK 25 is downloaded once into .test-server/jdk/.
//
// The server binds to 127.0.0.1 only. Offline-mode servers must never be exposed
// publicly without safeguards against username impersonation.
//
// Running a Minecraft server requires agreeing to the Minecraft EULA
// (https://aka.ms/MinecraftEULA). This script only writes eula=true when you pass
// --accept-eula or set MC_EULA=true.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function parseArgs (argv) {
  const out = { version: '1.21.11', build: 'latest', port: 25570, online: false, acceptEula: process.env.MC_EULA === 'true', levelType: 'minecraft:normal', seed: 'vassago', gamemode: 'survival', plugins: [], via: false, java: process.env.VASSAGO_JAVA || null }
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
    else if (a === '--build') out.build = argv[++i]
    else if (a === '--via') out.via = true
    else if (a === '--plugin') out.plugins.push(argv[++i])
    else if (a === '--java') out.java = argv[++i]
  }
  return out
}

const UA = { 'User-Agent': 'vassago-client-test-harness' }

async function fetchJson (url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  return await res.json()
}

async function download (url, dest, sha256) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`Download failed (${url}): HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256 && createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error(`Checksum mismatch for ${url}`)
  fs.writeFileSync(dest + '.part', buf)
  fs.renameSync(dest + '.part', dest)
}

async function downloadPaper (version, build, dest) {
  const info = await fetchJson(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/${build}`)
  const dl = info.downloads['server:default']
  await download(dl.url, dest, dl.checksums.sha256)
}

/** Latest CI builds of ViaVersion and ViaBackwards (lets older clients join newer servers). */
async function viaPluginUrls () {
  const out = []
  for (const job of ['ViaVersion', 'ViaBackwards']) {
    const j = await fetchJson(`https://ci.viaversion.com/job/${job}/lastSuccessfulBuild/api/json`)
    const art = j.artifacts.find(x => /^Via\w+-[\w.-]+\.jar$/.test(x.fileName) && !/sources|javadoc/.test(x.fileName))
    if (!art) throw new Error(`No jar artifact found for ${job}`)
    out.push(`https://ci.viaversion.com/job/${job}/${j.number}/artifact/${art.relativePath}`)
  }
  return out
}

function javaMajor (bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' })
  const m = /version "(\d+)/.exec(`${r.stderr ?? ''}${r.stdout ?? ''}`)
  return m ? Number(m[1]) : 0
}

/** Java major version a Paper release needs. */
export function requiredJava (version) {
  const major = Number(String(version).split('.')[0])
  return major >= 26 ? 25 : 21
}

/** Find (or download) a Java runtime new enough for the given Paper version. Returns the java binary path. */
export async function ensureJava (version, preferred) {
  const need = requiredJava(version)
  for (const cand of [preferred, 'java'].filter(Boolean)) {
    if (javaMajor(cand) >= need) return cand
  }
  const home = path.join(root, '.test-server', 'jdk', `jdk-${need}`)
  const bin = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (javaMajor(bin) >= need) return bin
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  if (os === 'windows') throw new Error(`Paper ${version} needs Java ${need}. Install a JDK ${need} and pass --java <path> (or set VASSAGO_JAVA).`)
  console.log(`[test-server] Paper ${version} needs Java ${need}; downloading Temurin JDK ${need} (one time)…`)
  const assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${need}/hotspot?architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`)
  const pkg = assets[0]?.binary?.package
  if (!pkg) throw new Error(`No Temurin JDK ${need} found for ${os}/${arch}; install one and pass --java <path>.`)
  const cache = path.join(root, '.test-server', 'cache')
  fs.mkdirSync(cache, { recursive: true })
  const tgz = path.join(cache, pkg.name)
  if (!fs.existsSync(tgz)) await download(pkg.link, tgz, pkg.checksum)
  const tmp = home + '.tmp'
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const tar = spawnSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' })
  if (tar.status !== 0) throw new Error('Could not unpack the JDK archive (tar failed).')
  const top = path.join(tmp, fs.readdirSync(tmp)[0])
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(home), { recursive: true })
  fs.renameSync(os === 'mac' ? path.join(top, 'Contents', 'Home') : top, home)
  fs.rmSync(tmp, { recursive: true, force: true })
  if (javaMajor(bin) < need) throw new Error(`The downloaded JDK did not work; install a JDK ${need} and pass --java <path>.`)
  return bin
}

/** Prepare (download + configure) a server directory. Returns { dir, jar }. */
export async function prepareServer (opts) {
  const dir = path.join(root, '.test-server', `${opts.version}-${opts.online ? 'online' : 'offline'}-${opts.port}`)
  fs.mkdirSync(dir, { recursive: true })
  const cache = path.join(root, '.test-server', 'cache')
  fs.mkdirSync(cache, { recursive: true })
  const build = opts.build ?? 'latest'
  const jar = path.join(cache, build === 'latest' ? `paper-${opts.version}.jar` : `paper-${opts.version}-${build}.jar`)
  if (!fs.existsSync(jar)) {
    console.log(`[test-server] downloading Paper ${opts.version} (build ${build})…`)
    await downloadPaper(opts.version, build, jar)
  }
  // plugins: wipe previously installed jars so the directory always matches the requested set
  const pluginDir = path.join(dir, 'plugins')
  fs.mkdirSync(pluginDir, { recursive: true })
  for (const f of fs.readdirSync(pluginDir)) if (f.endsWith('.jar')) fs.rmSync(path.join(pluginDir, f))
  const wanted = [...(opts.plugins ?? [])]
  if (opts.via) wanted.push(...await viaPluginUrls())
  for (const src of wanted) {
    const name = path.basename(new URL(src, 'file:///').pathname)
    if (/^https:\/\//.test(src)) {
      const cached = path.join(cache, name)
      if (!fs.existsSync(cached)) { console.log(`[test-server] downloading plugin ${name}…`); await download(src, cached) }
      fs.copyFileSync(cached, path.join(pluginDir, name))
    } else fs.copyFileSync(path.resolve(src), path.join(pluginDir, name))
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
  const java = await ensureJava(opts.version, opts.java)
  const child = spawn(java, ['-Xms512M', '-Xmx2G', '-Dpaper.disableChannelLimit=true', ...(opts.jvmArgs ?? []), '-jar', jar, '--nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
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
