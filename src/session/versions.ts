/**
 * Version adapter layer. All per-version protocol knowledge lives in the
 * PrismarineJS data tables; this module decides which game version to speak
 * and whether it is one we have actually verified.
 */
import { isVerified, type PingResult } from '../shared/protocol'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mc = require('minecraft-protocol')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mineflayer = require('mineflayer')

export type { PingResult } from '../shared/protocol'

export function supportedVersions (): string[] {
  const tested: string[] = mineflayer.testedVersions ?? []
  return tested.filter(v => mc.supportedVersions.includes(v))
}

/** Map a protocol number to the newest release we can speak with that protocol. */
export function versionForProtocol (protocol: number): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mcData = require('minecraft-data')
  const candidates: string[] = supportedVersions()
  let best: string | null = null
  for (const v of candidates) {
    const d = mcData.versionsByMinecraftVersion.pc[v]
    if (d && d.version === protocol) best = v
  }
  return best
}

function motdToString (d: any): string {
  if (d == null) return ''
  if (typeof d === 'string') return d
  let s = ''
  if (d.color && typeof d.color === 'string' && d.color.startsWith('#')) s += `§${d.color}`
  if (typeof d.text === 'string') s += d.text
  if (Array.isArray(d.extra)) s += d.extra.map(motdToString).join('')
  if (Array.isArray(d)) s += d.map(motdToString).join('')
  return s
}

export async function pingServer (host: string, port: number, timeoutMs = 6000): Promise<PingResult> {
  try {
    const res: any = await Promise.race([
      mc.ping({ host, port, closeTimeout: timeoutMs, noPongTimeout: timeoutMs }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Timed out')), timeoutMs + 500))
    ])
    const protocol: number | undefined = res?.version?.protocol
    const name = res?.version?.name ?? String(res?.version ?? '')
    const { resolved, serverVersion, confirmed } = negotiate(name, protocol)
    return {
      online: true,
      latency: res.latency,
      versionName: name,
      protocol,
      playersOnline: res?.players?.online,
      playersMax: res?.players?.max,
      motd: motdToString(res?.description),
      favicon: typeof res?.favicon === 'string' && res.favicon.startsWith('data:image/png;base64,') ? res.favicon : undefined,
      resolvedVersion: resolved ?? undefined,
      serverVersion,
      supported: resolved != null,
      // "Verified" needs the status name to say what the server really runs: a proxy or a
      // translating server answers a ping with the pinging client's own protocol number.
      verified: confirmed ? isVerified(resolved) : serverVersion ? isVerified(resolved, serverVersion) : false
    }
  } catch (err: any) {
    return { online: false, error: err?.code ?? err?.message ?? String(err) }
  }
}

export interface StatusVersion {
  /** the status name confirms that the server runs the version we would speak (or one with the same protocol) */
  confirmed: boolean
  /** set when the server names a different version than the one we would speak */
  serverVersion?: string
}

const compareVersions = (a: string, b: string): number => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d }
  return 0
}

/**
 * Read the version a status response names. Only a single, plain version says anything:
 * ranges ("1.8-1.21", "1.21.x") and names without a version leave the question open.
 */
export function readStatusVersion (name: unknown, resolved: string | null, protocol: number | undefined): StatusVersion {
  if (typeof name !== 'string' || !resolved) return { confirmed: false }
  const found = [...name.replace(/§./g, '').matchAll(/\d+\.\d+(?:\.\d+)?(\.x)?/gi)]
  if (found.length !== 1 || found[0][1]) return { confirmed: false }
  const named = found[0][0]
  if (named === resolved) return { confirmed: true }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const known = require('minecraft-data').versionsByMinecraftVersion.pc[named]
  // e.g. 26.1.2 and 26.1 share a protocol; a known release with another protocol is being translated
  if (known) return known.version === protocol ? { confirmed: true } : { confirmed: false, serverVersion: named }
  // A release newer than anything in our data (26.3 today) cannot be what we speak either.
  const newest = supportedVersions().reduce((a, b) => compareVersions(a, b) >= 0 ? a : b, '0.0')
  return compareVersions(named, newest) > 0 ? { confirmed: false, serverVersion: named } : { confirmed: false }
}

/** Kept for callers that only want the translated server's version. */
export function translatedServerVersion (name: unknown, resolved: string | null, protocol: number | undefined): string | undefined {
  return readStatusVersion(name, resolved, protocol).serverVersion
}

/**
 * Decide what to speak from a status response. Normally that is the newest release with the
 * reported protocol. When the server names a version we can speak ourselves but reports another
 * protocol (it echoed ours because it translates), speaking its own version is the better choice:
 * no translation layer in between.
 */
export function negotiate (name: unknown, protocol: number | undefined, pinged: number | null = pingProtocol()): { resolved: string | null, serverVersion?: string, confirmed: boolean } {
  const byProtocol = protocol != null ? versionForProtocol(protocol) : null
  const status = readStatusVersion(name, byProtocol, protocol)
  if (status.serverVersion) {
    // A name that disagrees with the protocol number only means "this server translates" when
    // that number is an echo of the one we pinged with. Otherwise the name is just words
    // ("Paper 1.21", "Requires MC 1.21.4") and the protocol number stands.
    if (protocol !== pinged) return { resolved: byProtocol, serverVersion: undefined, confirmed: false }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const known = require('minecraft-data').versionsByMinecraftVersion.pc[status.serverVersion]
    const own = known ? versionForProtocol(known.version) : null
    if (own) return { resolved: own, confirmed: true }
  }
  return { resolved: byProtocol, serverVersion: status.serverVersion, confirmed: status.confirmed }
}

/** The protocol number a status ping is sent with: the protocol library pings as its newest version. */
export function pingProtocol (): number | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try { return require('minecraft-data')(mc.defaultVersion).version.version } catch { return null }
}

/** Decide which version to use for a connection. Throws a descriptive error when unsupported. */
export async function resolveVersion (host: string, port: number, explicit: string | null): Promise<string> {
  const supported = supportedVersions()
  if (explicit) {
    if (!supported.includes(explicit)) throw new Error(`Version ${explicit} is not supported by this client. Supported: ${supported.join(', ')}`)
    return explicit
  }
  const ping = await pingServer(host, port)
  if (!ping.online) {
    const e: any = new Error(ping.error ?? 'Server unreachable')
    e.code = ping.error
    throw e
  }
  if (!ping.resolvedVersion) {
    throw new Error(`The server runs ${ping.versionName ?? 'an unknown version'} (protocol ${ping.protocol}), which this client does not support yet. Supported: ${supported[0]} – ${supported[supported.length - 1]}`)
  }
  return ping.resolvedVersion
}
