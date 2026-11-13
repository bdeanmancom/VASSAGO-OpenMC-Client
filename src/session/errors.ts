/**
 * Turns low-level socket / protocol / sign-in failures and server kick messages into
 * (a) a category the UI can act on and (b) a sentence a player can understand.
 *
 * Every rule here matches a specific, known message. Nothing is inferred from loose keywords:
 * an unrecognised failure is reported as-is rather than guessed at.
 */
import type { AuthMode, DisconnectKind } from '../shared/protocol'

export interface Classified {
  kind: DisconnectKind
  /** One or two plain sentences for the player. */
  reason: string
  /** The original text from the server or library, kept for the "technical details" view. */
  detail?: string
}

function rawMessage (err: unknown): { code: string, msg: string } {
  const e = err as any
  return {
    code: typeof e?.code === 'string' ? e.code : '',
    msg: typeof err === 'string' ? err : String(e?.message ?? err ?? '')
  }
}

/** Messages produced by the Xbox Live step of Microsoft sign-in (prismarine-auth `xboxLiveErrors`). */
const XBOX_RULES: [RegExp, string][] = [
  [/does not have an Xbox profile/i, 'This Microsoft account has no Xbox profile yet. Create one by signing in once at xbox.com, then try again.'],
  [/banned by Xbox/i, 'This Microsoft account has been banned by Xbox and cannot be used to play online.'],
  [/guardian has not given you permission|added to a family by an adult|under 18 years/i, 'This is a child account. An adult in its Microsoft family group has to allow online play before it can join servers.'],
  [/has not accepted Xbox's Terms of Service/i, "This Microsoft account has not accepted Xbox's Terms of Service. Sign in at xbox.com to accept them, then try again."],
  [/region that Xbox has not authorized/i, 'Xbox Live is not available in the region this Microsoft account is registered in.'],
  [/requires proof of age/i, 'This Microsoft account needs age verification. Sign in at account.microsoft.com to complete it, then try again.'],
  [/limit for playtime/i, 'This Microsoft account has reached its play-time limit.'],
  [/Xbox Live authentication failed|XErr/i, 'Xbox Live refused the sign-in for this Microsoft account.']
]

/**
 * Classify an error thrown by the connection or by Microsoft sign-in.
 * `auth` is the mode the user chose for this connection.
 */
export function classifyError (err: unknown, auth: AuthMode = 'offline'): Classified {
  const { code, msg } = rawMessage(err)
  const detail = msg || code || undefined
  const of = (kind: DisconnectKind, reason: string): Classified => ({ kind, reason, detail })

  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return of('network', 'Connection refused — no server is listening at that address and port, or a firewall is blocking this computer.')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return of('network', 'Unknown host — check the server address.')
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /EHOSTUNREACH|ENETUNREACH/.test(msg)) return of('network', 'Network unreachable — check your internet connection.')

  // --- Microsoft sign-in. These can only happen when the user chose an official-account profile;
  //     a private-server (offline) connection never talks to Microsoft services.
  if (auth === 'microsoft') {
    if (/Failed to obtain profile data for .*does the account own minecraft/i.test(msg)) {
      return of('ms-no-java-profile', 'You are signed in to Microsoft, but this account has no Minecraft: Java Edition profile.')
    }
    for (const [re, text] of XBOX_RULES) if (re.test(msg)) return of('ms-xbox', text)
    if (/Authentication failed, timed out|Failed to acquire authorization code|Failed to request live\.com device code|authorization_declined|expired_token|code_expired/i.test(msg)) {
      return of('ms-signin', 'Microsoft sign-in was not completed — the code expired or the request was declined. Connect again to get a new code.')
    }
    if (/Cannot refresh without refresh token|invalid_grant|AADSTS\d+/i.test(msg)) {
      return of('ms-signin', 'The saved Microsoft sign-in is no longer valid. Remove the account under Profiles, add it again and sign in.')
    }
    if (/Invalid app registration|\b403\b/i.test(msg)) {
      return of('ms-signin', 'Minecraft services refused this sign-in. If you set a custom Microsoft application ID in Settings, it has not been approved for Minecraft sign-in — clear it and try again.')
    }
    if (/\b401\b|invalid.?session|Invalid credentials|Unauthorized/i.test(msg)) {
      return of('ms-signin', 'Authentication failed — sign in again.')
    }
  }

  if (code === 'ETIMEDOUT' || /ETIMEDOUT|\btimed out\b|\btimeout\b/i.test(msg)) return of('network', 'Connection timed out — the server did not respond.')
  if (code === 'ECONNRESET' || /ECONNRESET|socketClosed/.test(msg)) return of('network', 'Connection lost — the server closed the connection.')
  if (/keepAliveError|client timed out/i.test(msg)) return of('network', 'Timed out — lost contact with the server.')
  if (msg === 'disconnect.quitting' || msg === 'Disconnected') return { kind: 'other', reason: 'Disconnected' }
  return { kind: 'other', reason: msg || 'Disconnected', detail }
}

/** Backwards-compatible helper: just the sentence. */
export function describeDisconnect (err: unknown, auth: AuthMode = 'offline'): string {
  return classifyError(err, auth).reason
}

interface KickRule { keys?: string[], text?: RegExp, kind: DisconnectKind, reason?: string }

/**
 * Server kick messages, by translation key and/or literal text. The literal patterns cover
 * servers and proxies that send plain text instead of a translatable component.
 */
const KICK_RULES: KickRule[] = [
  {
    // vanilla / Paper / Spigot / Fabric in online mode; Velocity and BungeeCord with online mode on
    keys: ['multiplayer.disconnect.unverified_username', 'velocity.error.online-mode-only'],
    text: /Failed to verify username|not logged into your Minecraft account|Not authenticated with Minecraft\.net/i,
    kind: 'auth-required',
    reason: 'This server only accepts verified Microsoft accounts (it is running in online mode), so it refused this name.'
  },
  { keys: ['multiplayer.disconnect.not_whitelisted'], text: /not white-?listed/i, kind: 'whitelist', reason: 'You are not on this server’s whitelist. Ask the server owner to add this exact username.' },
  { keys: ['multiplayer.disconnect.banned', 'multiplayer.disconnect.banned_ip', 'multiplayer.disconnect.banned.reason', 'multiplayer.disconnect.banned.expiration', 'multiplayer.disconnect.banned_ip.reason', 'multiplayer.disconnect.banned_ip.expiration'], text: /\bYou are banned\b|\bbanned from this server\b/i, kind: 'banned' },
  { keys: ['multiplayer.disconnect.server_full'], text: /server is full/i, kind: 'full', reason: 'The server is full.' },
  { keys: ['multiplayer.disconnect.outdated_client', 'multiplayer.disconnect.outdated_server', 'multiplayer.disconnect.incompatible'], text: /Outdated (client|server)|Incompatible client/i, kind: 'version' },
  {
    text: /IP forwarding|connect (with|through) Velocity|Unable to verify player details|must connect through the proxy|player info forwarding/i,
    kind: 'proxy',
    reason: 'This server only accepts players who arrive through its proxy. Connect to the proxy’s address instead of this one.'
  },
  { keys: ['multiplayer.disconnect.name_taken', 'multiplayer.disconnect.duplicate_login'], text: /logged in from another location|name is already taken/i, kind: 'kicked' }
]

/** Pull the translation key out of a JSON string / plain object / NBT-style component. */
export function translationKey (component: unknown): string | null {
  let c: any = component
  if (typeof c === 'string') {
    if (!c.startsWith('{')) return /^[a-z0-9_.-]+\.[a-z0-9_.-]+$/i.test(c) ? c : null
    try { c = JSON.parse(c) } catch { return null }
  }
  if (!c || typeof c !== 'object') return null
  if (c.type === 'compound' && c.value && typeof c.value === 'object') c = c.value
  let key = c.translate
  if (key && typeof key === 'object' && 'value' in key) key = key.value
  return typeof key === 'string' ? key : null
}

/**
 * Classify a kick. `component` is the raw reason from the server, `text` the flattened,
 * translated text of it.
 */
export function classifyKick (component: unknown, text: string): Classified {
  const key = translationKey(component)
  for (const rule of KICK_RULES) {
    if ((key && rule.keys?.includes(key)) || (rule.text && rule.text.test(text))) {
      return { kind: rule.kind, reason: rule.reason ?? (text || 'Kicked by server'), detail: text || key || undefined }
    }
  }
  return { kind: 'kicked', reason: text || 'Kicked by server', detail: text || key || undefined }
}
