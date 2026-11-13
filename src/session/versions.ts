/**
 * Version adapter layer. All per-version protocol knowledge lives in the
 * PrismarineJS data tables; this module decides which game version to speak
 * and whether it is one we have actually verified.
 */
import { VERIFIED_VERSIONS, type PingResult } from '../shared/protocol'

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
    const resolved = protocol != null ? versionForProtocol(protocol) : null
    return {
      online: true,
      latency: res.latency,
      versionName: res?.version?.name ?? String(res?.version ?? ''),
      protocol,
      playersOnline: res?.players?.online,
      playersMax: res?.players?.max,
      motd: motdToString(res?.description),
      favicon: typeof res?.favicon === 'string' && res.favicon.startsWith('data:image/png;base64,') ? res.favicon : undefined,
      resolvedVersion: resolved ?? undefined,
      supported: resolved != null,
      verified: resolved != null && VERIFIED_VERSIONS.includes(resolved)
    }
  } catch (err: any) {
    return { online: false, error: err?.code ?? err?.message ?? String(err) }
  }
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
