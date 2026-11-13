/**
 * Plain-language guidance shown when a connection is refused for account reasons.
 * Kept free of UI code so the wording can be unit-tested and reused by the CLI server check.
 */
import type { DisconnectKind } from './protocol'

/** Steps for someone who runs the server and wants private-server (offline-mode) profiles to join. */
export const OWNER_STEPS: readonly string[] = [
  'Stop the server.',
  'Open server.properties and set online-mode=false. If players reach the server through a proxy, change the proxy’s setting instead (velocity.toml: online-mode, BungeeCord config.yml: online_mode). Hosting panels and containers often overwrite the file — change it there if yours does (for example an ONLINE_MODE variable or a “cracked” switch).',
  'Start the server again. It has to be a full restart; a reload does not apply this setting. The console then prints “SERVER IS RUNNING IN OFFLINE/INSECURE MODE”.',
  'Keep the server restricted. With online mode off nothing proves who a player is — anyone who can reach the server can join under any name, including an operator’s, and a name whitelist does not prevent that. Use a firewall / IP allow-list or a login plugin.'
]

export const OWNER_NOTE = 'Players get different internal IDs in offline mode, so existing inventories, operator status and whitelist entries will not carry over automatically — add the names to the whitelist and operator list again after the switch.'

/** Shown with the steps: the one case where the server is already in offline mode and still asks. */
export const NAME_RESERVED_NOTE = 'Already off? Then a login plugin or the proxy is treating this name as a paid account’s and asking that account to prove itself. Join under a different name.'

export function ownerStepsText (server: string): string {
  return [
    `Letting private-server (offline-mode) profiles join ${server}`,
    '',
    ...OWNER_STEPS.map((s, i) => `${i + 1}. ${s}`),
    '',
    `Note: ${OWNER_NOTE}`
  ].join('\n')
}

export interface DisconnectCopy {
  title: string
  /** extra sentence(s) shown under the reason, or '' */
  more: string
  /** which guided layout to use */
  layout: 'server-wants-account' | 'account-cannot-join' | 'simple'
  tone: 'warn' | 'error'
}

export function disconnectCopy (kind: DisconnectKind | undefined, o: { kicked: boolean, wasInWorld: boolean }): DisconnectCopy {
  switch (kind) {
    case 'auth-required':
      return { title: 'This server asks for a verified account', more: 'That is the server’s rule, not a Vassago setting — and Vassago does not get around it.', layout: 'server-wants-account', tone: 'warn' }
    case 'ms-not-owned':
      return { title: 'This Microsoft account can’t join', more: 'Online-mode servers only admit accounts that own the game.', layout: 'account-cannot-join', tone: 'warn' }
    case 'ms-no-java-profile':
      return { title: 'This Microsoft account can’t join yet', more: 'That usually means the account does not own Java Edition, or it owns it but has never opened the official launcher to create its player name.', layout: 'account-cannot-join', tone: 'warn' }
    case 'ms-profile-missing':
      return { title: 'Finish setting up your Java Edition profile', more: '', layout: 'simple', tone: 'warn' }
    case 'ms-xbox':
      return { title: 'Xbox Live turned this account away', more: '', layout: 'account-cannot-join', tone: 'warn' }
    case 'ms-signin':
      return { title: 'Microsoft sign-in didn’t finish', more: '', layout: 'simple', tone: 'warn' }
    case 'whitelist': return { title: 'Not on the whitelist', more: '', layout: 'simple', tone: 'warn' }
    case 'banned': return { title: 'Banned from this server', more: '', layout: 'simple', tone: 'warn' }
    case 'full': return { title: 'Server is full', more: '', layout: 'simple', tone: 'warn' }
    case 'version': return { title: 'Version mismatch', more: '', layout: 'simple', tone: 'warn' }
    case 'proxy': return { title: 'Wrong address for this server', more: '', layout: 'simple', tone: 'warn' }
    default:
      if (o.kicked) return { title: 'Disconnected by server', more: '', layout: 'simple', tone: 'warn' }
      return { title: o.wasInWorld ? 'Connection lost' : 'Couldn’t connect', more: '', layout: 'simple', tone: 'error' }
  }
}
