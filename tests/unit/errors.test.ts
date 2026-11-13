import { describe, expect, it } from 'vitest'
import { classifyError, classifyKick, describeDisconnect, translationKey } from '../../src/session/errors'
import { javaLicenceState, titleText } from '../../src/session/session'
import { OWNER_STEPS, disconnectCopy, ownerStepsText } from '../../src/shared/guidance'

describe('classifyError — network', () => {
  it('maps socket failures', () => {
    expect(classifyError({ code: 'ECONNREFUSED' }).kind).toBe('network')
    expect(classifyError({ code: 'ENOTFOUND' }).reason).toMatch(/unknown host/i)
    expect(classifyError(new Error('connect ETIMEDOUT 1.2.3.4:25565')).reason).toMatch(/timed out/i)
    expect(classifyError('socketClosed').reason).toMatch(/connection lost/i)
  })
  it('passes unknown messages through untouched instead of guessing', () => {
    expect(classifyError('something odd')).toEqual({ kind: 'other', reason: 'something odd', detail: 'something odd' })
    // a word like "profile" alone must never be read as an ownership problem
    expect(classifyError(new Error('could not read profile cache file'), 'microsoft').kind).toBe('other')
    expect(classifyError(new Error('Failed to fetch profile keys'), 'microsoft').kind).toBe('other')
  })
})

describe('classifyError — Microsoft sign-in', () => {
  const noProfile = new Error('Failed to obtain profile data for someone@example.com, does the account own minecraft?')
  it('reports a missing Java Edition profile without claiming to know why', () => {
    const c = classifyError(noProfile, 'microsoft')
    expect(c.kind).toBe('ms-no-java-profile')
    expect(c.reason).toMatch(/signed in to Microsoft/)
    expect(c.reason).toMatch(/no Minecraft: Java Edition profile/)
    expect(c.detail).toContain('Failed to obtain profile data')
  })
  it('does not call an Xbox account problem a missing game licence (regression)', () => {
    const c = classifyError(new Error('Your account currently does not have an Xbox profile. Please create one at https://signup.live.com/signup'), 'microsoft')
    expect(c.kind).toBe('ms-xbox')
    expect(c.reason).toMatch(/no Xbox profile/i)
    expect(c.reason).not.toMatch(/own Minecraft/i)
  })
  it('recognises the other Xbox Live refusals', () => {
    expect(classifyError(new Error('The account date of birth is under 18 years and cannot proceed unless the account is added to a family by an adult.'), 'microsoft').reason).toMatch(/child account/i)
    expect(classifyError(new Error('Your account resides in a region that Xbox has not authorized use from.'), 'microsoft').kind).toBe('ms-xbox')
    expect(classifyError(new Error('Xbox Live authentication failed to obtain a XSTS token. XErr: 123'), 'microsoft').kind).toBe('ms-xbox')
  })
  it('recognises an unfinished or stale sign-in', () => {
    expect(classifyError(new Error('Authentication failed, timed out'), 'microsoft').kind).toBe('ms-signin')
    expect(classifyError(new Error('Failed to acquire authorization code from device token (authorization_declined) - x'), 'microsoft').kind).toBe('ms-signin')
    expect(classifyError(new Error('Cannot refresh without refresh token'), 'microsoft').reason).toMatch(/no longer valid/i)
    expect(classifyError(new Error('403 Forbidden {"errorMessage":"Invalid app registration"}'), 'microsoft').reason).toMatch(/application ID/i)
  })
  it('never produces Microsoft diagnoses for a private-server connection', () => {
    for (const e of [noProfile, new Error('403 Forbidden'), new Error('Invalid credentials'), new Error('Your account currently does not have an Xbox profile.')]) {
      expect(classifyError(e, 'offline').kind).toBe('other')
    }
  })
  it('describeDisconnect returns the sentence', () => {
    expect(describeDisconnect(noProfile, 'microsoft')).toBe(classifyError(noProfile, 'microsoft').reason)
  })
})

describe('version mismatch', () => {
  it('explains a connection made with the wrong fixed version', () => {
    const c = classifyError(new Error('This server is version 1.21.11, you are using version 1.21.4, please specify the correct version in the options.'))
    expect(c.kind).toBe('version')
    expect(c.reason).toBe('Version mismatch — the server runs 1.21.11, but this connection was made as 1.21.4.')
  })
})

describe('classifyKick', () => {
  it('reads translation keys from JSON, objects and NBT-style components', () => {
    expect(translationKey('{"translate":"multiplayer.disconnect.unverified_username"}')).toBe('multiplayer.disconnect.unverified_username')
    expect(translationKey({ translate: 'a.b' })).toBe('a.b')
    expect(translationKey({ type: 'compound', value: { translate: { type: 'string', value: 'x.y' } } })).toBe('x.y')
    expect(translationKey('plain words')).toBeNull()
    expect(translationKey(null)).toBeNull()
  })
  it('recognises an online-mode rejection from vanilla, Paper, Velocity and BungeeCord', () => {
    expect(classifyKick({ translate: 'multiplayer.disconnect.unverified_username' }, 'Failed to verify username!').kind).toBe('auth-required')
    expect(classifyKick('Failed to verify username!', 'Failed to verify username!').kind).toBe('auth-required')
    expect(classifyKick({ translate: 'velocity.error.online-mode-only' }, 'You are not logged into your Minecraft account.').kind).toBe('auth-required')
    expect(classifyKick({ text: 'Not authenticated with Minecraft.net' }, 'Not authenticated with Minecraft.net').kind).toBe('auth-required')
    const c = classifyKick({ translate: 'multiplayer.disconnect.unverified_username' }, 'Failed to verify username!')
    expect(c.reason).toMatch(/online mode/)
    expect(c.detail).toBe('Failed to verify username!')
  })
  it('recognises whitelist, ban, full, version and proxy refusals; everything else is a plain kick', () => {
    expect(classifyKick({ translate: 'multiplayer.disconnect.not_whitelisted' }, 'You are not white-listed on this server!').kind).toBe('whitelist')
    expect(classifyKick({ translate: 'multiplayer.disconnect.banned' }, 'You are banned from this server').kind).toBe('banned')
    expect(classifyKick({ translate: 'multiplayer.disconnect.server_full' }, 'The server is full!').kind).toBe('full')
    expect(classifyKick({ translate: 'multiplayer.disconnect.outdated_client' }, 'Outdated client! Please use 1.21.11').kind).toBe('version')
    expect(classifyKick('x', 'If you wish to use IP forwarding, please enable it in your BungeeCord config as well!').kind).toBe('proxy')
    const plain = classifyKick('x', 'integration test kick')
    expect(plain).toEqual({ kind: 'kicked', reason: 'integration test kick', detail: 'integration test kick' })
    expect(classifyKick(null, '').reason).toBe('Kicked by server')
  })
})

describe('classifyKick with connection context', () => {
  const offline = (askedToVerify: boolean, loggedIn = false) => ({ auth: 'offline' as const, askedToVerify, loggedIn })
  const microsoft = { auth: 'microsoft' as const, askedToVerify: false, loggedIn: false }

  it('decides "needs a verified account" from the handshake, whatever the wording or language', () => {
    // a proxy set to German, a plugin with its own text, the auth-servers-down message, no text at all
    for (const text of ['Du bist nicht in deinem Minecraft-Konto angemeldet.', 'Premium only!', 'Authentication servers are down. Please try again later. Sorry!', '']) {
      const c = classifyKick({ text }, text, offline(true))
      expect(c.kind).toBe('auth-required')
      expect(c.reason).toMatch(/online mode/)
    }
    expect(classifyKick({ text: 'Premium only!' }, 'Premium only!', offline(true)).detail).toBe('Premium only!')
  })
  it('does not blame accounts when the server never asked to verify one', () => {
    // 'Failed to verify username' is what the session's own text for this key reads
    const c = classifyKick({ translate: 'multiplayer.disconnect.unverified_username' }, 'Failed to verify username', offline(false))
    expect(c.kind).toBe('kicked')
    expect(c.reason).toMatch(/did not ask for account verification/)
    expect(c.reason).toContain('“Failed to verify username”')
    expect(c.reason).not.toMatch(/Microsoft/)
  })
  it('keeps specific refusals as they are', () => {
    expect(classifyKick({ translate: 'multiplayer.disconnect.not_whitelisted' }, 'You are not white-listed on this server!', offline(true)).kind).toBe('whitelist')
    expect(classifyKick({ translate: 'multiplayer.disconnect.server_full' }, 'The server is full!', offline(true)).kind).toBe('full')
    expect(classifyKick({ translate: 'multiplayer.disconnect.ip_banned' }, 'You have been IP banned from this server', offline(false)).kind).toBe('banned')
  })
  it('leaves kicks in the world alone', () => {
    const c = classifyKick({ text: 'Invalid move player packet received' }, 'Invalid move player packet received', offline(true, true))
    expect(c).toEqual({ kind: 'kicked', reason: 'Invalid move player packet received', detail: 'Invalid move player packet received' })
  })
  it('tells a Microsoft profile that its session was not verified, not that it needs an account', () => {
    const c = classifyKick({ translate: 'multiplayer.disconnect.unverified_username' }, 'Failed to verify username', microsoft)
    expect(c.kind).toBe('kicked')
    expect(c.reason).toMatch(/could not verify this Microsoft session \(“Failed to verify username”\)/)
    expect(c.reason).not.toMatch(/requires a signed-in/)
    expect(classifyKick({ text: 'x' }, 'Authentication servers are down. Please try again later. Sorry!', microsoft).reason).toMatch(/Authentication servers are down/)
  })
})

describe('javaLicenceState', () => {
  const flow = (entitlements: unknown, fail = false) => ({ getMinecraftJavaToken: async (o: any) => { if (fail) throw new Error('network'); expect(o.fetchEntitlements).toBe(true); return { token: 't', entitlements } } })
  it('says owned / not owned only when the licence list is clear', async () => {
    expect(await javaLicenceState(flow({ items: [{ name: 'product_minecraft' }, { name: 'game_minecraft' }] }))).toBe(true)
    expect(await javaLicenceState(flow({ items: [] }))).toBe(false)
    expect(await javaLicenceState(flow({ items: [{ name: 'product_minecraft_bedrock' }] }))).toBe(false)
  })
  it('returns null on any doubt', async () => {
    expect(await javaLicenceState(flow(undefined))).toBeNull()
    expect(await javaLicenceState(flow({}))).toBeNull()
    expect(await javaLicenceState(flow(null, true))).toBeNull()
    expect(await javaLicenceState(null)).toBeNull()
    expect(await javaLicenceState({})).toBeNull()
  })
})

describe('guidance', () => {
  it('uses the guided layouts for account problems and the simple one otherwise', () => {
    expect(disconnectCopy('auth-required', { kicked: true, wasInWorld: false }).layout).toBe('server-wants-account')
    expect(disconnectCopy('ms-not-owned', { kicked: false, wasInWorld: false }).layout).toBe('account-cannot-join')
    expect(disconnectCopy('ms-no-java-profile', { kicked: false, wasInWorld: false }).more).toMatch(/usually means/)
    expect(disconnectCopy('ms-signin', { kicked: false, wasInWorld: false }).layout).toBe('simple')
    expect(disconnectCopy('kicked', { kicked: true, wasInWorld: true }).title).toBe('Disconnected by server')
    expect(disconnectCopy(undefined, { kicked: false, wasInWorld: true }).title).toBe('Connection lost')
    expect(disconnectCopy('network', { kicked: false, wasInWorld: false }).title).toBe('Couldn’t connect')
  })
  it('owner steps name the setting, the restart and the safeguard', () => {
    const text = ownerStepsText('play.example.net')
    expect(OWNER_STEPS.length).toBe(4)
    expect(text).toContain('play.example.net')
    expect(text).toContain('online-mode=false')
    expect(text).toMatch(/full restart/)
    expect(text).toMatch(/whitelist does not prevent/)
    expect(text).toMatch(/firewall \/ IP allow-list or a login plugin/)
  })
})

describe('the text the session produces for well-known kicks', () => {
  it('does not put an explanation into the quoted server text (classifyKick supplies it)', () => {
    const said = titleText({ translate: 'multiplayer.disconnect.unverified_username' })
    expect(said).toBe('Failed to verify username')
    for (const ctx of [{ auth: 'offline' as const, askedToVerify: false, loggedIn: false }, { auth: 'microsoft' as const, askedToVerify: false, loggedIn: false }]) {
      const c = classifyKick({ translate: 'multiplayer.disconnect.unverified_username' }, said, ctx)
      expect(c.reason).not.toMatch(/requires a signed-in Microsoft account/)
    }
  })
})
