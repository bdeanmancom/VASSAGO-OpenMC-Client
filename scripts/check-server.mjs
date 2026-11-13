#!/usr/bin/env node
// Server check: tells you whether a server is reachable, which version it runs, and whether it
// accepts private-server (offline-mode) profiles or demands a verified Microsoft account.
//
//   npm run check-server -- play.example.net
//   npm run check-server -- 192.168.1.20:25570
//
// What it does: a status ping (the same thing a server list does), then it STARTS a login with
// the throw-away name "VassagoCheck" only far enough to see how the server answers, and
// disconnects before joining. It never completes a login, sends no account data, and makes no
// attempt to get past account verification. The server may log one short connection attempt.
import { createRequire } from 'node:module'
import dns from 'node:dns/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const mc = require('minecraft-protocol')
const mcData = require('minecraft-data')
const mineflayer = require('mineflayer')

const PROBE_NAME = 'VassagoCheck'
const TIMEOUT_MS = 10000

export function parseTarget (input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  const v6 = s.match(/^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/)
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : 25565, explicitPort: !!v6[2] }
  const idx = s.lastIndexOf(':')
  if (idx > 0 && s.indexOf(':') === idx) return { host: s.slice(0, idx), port: Number(s.slice(idx + 1)), explicitPort: true }
  return { host: s, port: 25565, explicitPort: false }
}

function flatten (c) {
  if (c == null) return ''
  if (typeof c === 'string') {
    if (c.startsWith('{') || c.startsWith('[') || c.startsWith('"')) { try { return flatten(JSON.parse(c)) } catch { return c } }
    return c
  }
  if (Array.isArray(c)) return c.map(flatten).join('')
  if (typeof c === 'object') {
    if ('type' in c && 'value' in c && Object.keys(c).length <= 3) return flatten(c.value)
    let out = ''
    if (c.text != null) out += flatten(c.text)
    else if (c[''] != null) out += flatten(c[''])
    else if (c.translate != null) out += flatten(c.translate) + (c.with ? ' ' + flatten(c.with) : '')
    if (c.extra) out += flatten(c.extra)
    return out
  }
  return String(c)
}

/** Newest release this client can speak for a protocol number, or null. */
export function versionForProtocol (protocol) {
  const supported = (mineflayer.testedVersions ?? []).filter(v => mc.supportedVersions.includes(v))
  let best = null
  for (const v of supported) if (mcData.versionsByMinecraftVersion.pc[v]?.version === protocol) best = v
  return best
}

/**
 * Start a login and report how the server answers.
 * Resolves to { mode: 'online' | 'offline' | 'rejected' | 'error', detail }.
 */
export function probeLogin (host, port, version, timeoutMs = TIMEOUT_MS) {
  return new Promise(resolve => {
    let done = false
    let client
    const finish = (mode, detail = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { client?.end() } catch {}
      resolve({ mode, detail })
    }
    const timer = setTimeout(() => finish('error', 'The server did not answer the login in time.'), timeoutMs)
    try {
      client = mc.createClient({ host, port, username: PROBE_NAME, auth: 'offline', version, hideErrors: true, connectTimeout: timeoutMs })
    } catch (err) {
      finish('error', String(err?.message ?? err))
      return
    }
    // An encryption request during login is the server asking for a verified account session.
    client.on('encryption_begin', () => finish('online'))
    // Any of these means the server accepted an unverified name: stop here, before joining.
    client.on('success', () => finish('offline'))
    client.on('login_acknowledged', () => finish('offline'))
    client.on('state', state => { if (state === 'configuration' || state === 'play') finish('offline') })
    client.on('disconnect', p => finish('rejected', flatten(p.reason)))
    client.on('kick_disconnect', p => finish('rejected', flatten(p.reason)))
    client.on('error', err => finish('error', err?.code ?? err?.message ?? String(err)))
    client.on('end', () => finish('error', 'The server closed the connection without an answer.'))
  })
}

export async function checkServer (target, log = console.log) {
  const { host, port } = target
  const result = { host, port, reachable: false, versionName: null, protocol: null, clientVersion: null, mode: null, detail: '' }

  log(`Checking ${host}${port !== 25565 ? ':' + port : ''} …\n`)
  try {
    const addrs = (await dns.lookup(host, { all: true })).map(a => a.address)
    log(`  Address        ${addrs.join(', ')}`)
  } catch (err) {
    log(`  Address        could not be resolved (${err.code ?? err.message})`)
    result.detail = 'Unknown host — check the spelling of the address.'
    return result
  }
  if (!target.explicitPort) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`)
      if (srv.length > 0) log(`  SRV record     ${srv.map(s => `${s.name}:${s.port}`).join(', ')} (used automatically when no port is given)`)
    } catch {}
  }

  let status
  try {
    status = await Promise.race([
      mc.ping({ host, port, closeTimeout: TIMEOUT_MS, noPongTimeout: TIMEOUT_MS }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS + 500))
    ])
  } catch (err) {
    const code = err?.code ?? err?.message ?? String(err)
    log(`  Status         no answer (${code})`)
    result.detail = code === 'ECONNREFUSED'
      ? 'Connection refused. The server is not running on that port, or a firewall / IP allow-list is blocking this computer.'
      : 'The server did not answer. It may be offline, on another port, or blocked by a firewall / IP allow-list.'
    return result
  }
  result.reachable = true
  result.versionName = String(status?.version?.name ?? '').replace(/§./g, '')
  result.protocol = status?.version?.protocol ?? null
  result.clientVersion = result.protocol != null ? versionForProtocol(result.protocol) : null
  log(`  Status         online — ${status?.players?.online ?? '?'}/${status?.players?.max ?? '?'} players, ${status.latency ?? '?'} ms`)
  log(`  Server version ${result.versionName} (protocol ${result.protocol})`)
  log(`  Vassago speaks ${result.clientVersion ?? 'NOT SUPPORTED by this build'}`)
  const named = (result.versionName.match(/\d+\.\d+(?:\.\d+)?/g) ?? [])
  if (result.clientVersion && named.length === 1 && named[0] !== result.clientVersion && mcData.versionsByMinecraftVersion.pc[named[0]]?.version !== result.protocol) {
    log(`  Note           the server names version ${named[0]} and translates between versions`)
    log('                 (ViaVersion/ViaBackwards); the protocol number above is an echo of what this check sent.')
  }
  if (!result.clientVersion) {
    result.detail = 'This build has no protocol data for that server version, so it cannot join regardless of accounts.'
    return result
  }

  const probe = await probeLogin(host, port, result.clientVersion)
  result.mode = probe.mode
  result.detail = probe.detail
  return result
}

function explain (r) {
  const lines = ['']
  if (!r.reachable || !r.clientVersion) { lines.push(`RESULT: ${r.detail}`); return lines.join('\n') }
  if (r.mode === 'online') {
    lines.push(
      'RESULT: this server is in ONLINE MODE — it asks every player for a verified Microsoft account.',
      '',
      'That is why Vassago says the server needs a Microsoft sign-in. The request comes from the server,',
      'not from the app, and Vassago will not try to get around it. You have two choices:',
      '',
      '  1. Play with your Microsoft account: in Vassago open Profiles → "Microsoft account",',
      '     select it and connect. You need to own Minecraft: Java Edition.',
      '',
      '  2. If this is YOUR server and you want private-server profiles (no Microsoft account):',
      '     • open server.properties on the server and set   online-mode=false',
      '     • restart the server completely (a reload is not enough)',
      '     • if the server sits behind a proxy (Velocity / BungeeCord), the setting that matters is the',
      "       proxy's own online-mode option; the backend servers are already offline behind it",
      '     • some hosting panels overwrite server.properties — change it in the panel if so',
      '',
      '     With online mode off, nothing proves who a player is: anyone who can reach the server can',
      '     join under any name, including an operator\'s. A name whitelist does not help. Keep the',
      '     firewall / IP allow-list in place, or add a login plugin, before letting others in.'
    )
  } else if (r.mode === 'offline') {
    lines.push(
      'RESULT: this server ACCEPTS private-server (offline-mode) profiles — no Microsoft account needed.',
      '',
      'If Vassago still shows a Microsoft sign-in window, the selected profile is a Microsoft profile:',
      'open Profiles, choose (or create) a "Private server profile" and connect again.'
    )
  } else if (r.mode === 'rejected') {
    lines.push(
      'RESULT: the server refused the login before any account check, with this message:',
      '',
      `  "${r.detail || '(no reason given)'}"`,
      '',
      'This is a server rule (whitelist, ban, full server, proxy forwarding, version) rather than a',
      'Microsoft sign-in requirement. The check used the name "VassagoCheck", so a name whitelist',
      'would refuse it even though your own name is allowed.'
    )
  } else {
    lines.push(`RESULT: could not finish the check — ${r.detail}`)
  }
  return lines.join('\n')
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const target = parseTarget(process.argv[2])
  if (!target || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    console.error('Usage: npm run check-server -- <host[:port]>')
    process.exit(2)
  }
  checkServer(target).then(r => {
    console.log(explain(r))
    process.exit(0)
  }).catch(err => { console.error(String(err?.stack ?? err)); process.exit(1) })
}
