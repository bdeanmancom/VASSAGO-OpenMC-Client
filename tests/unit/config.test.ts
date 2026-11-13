import { describe, expect, it } from 'vitest'
import { defaultConfig, fallbackProfile, isValidUsername, parseAddress, sanitizeConfig } from '../../src/shared/config'
import { describeDisconnect } from '../../src/session/errors'
import { titleText } from '../../src/session/session'
import { negotiate, readStatusVersion, translatedServerVersion, versionForProtocol } from '../../src/session/versions'
import { VERIFIED_TRANSLATED, VERIFIED_VERSIONS, isVerified } from '../../src/shared/protocol'

describe('parseAddress', () => {
  it('parses hosts with and without ports', () => {
    expect(parseAddress('play.example.net')).toEqual({ host: 'play.example.net', port: 25565 })
    expect(parseAddress(' 192.168.1.20:25570 ')).toEqual({ host: '192.168.1.20', port: 25570 })
    expect(parseAddress('[::1]:25566')).toEqual({ host: '::1', port: 25566 })
    expect(parseAddress('localhost')).toEqual({ host: 'localhost', port: 25565 })
  })
  it('rejects malformed input', () => {
    for (const bad of ['', '   ', 'host:99999', 'host:0', 'ho st', 'host:abc', 'http://x/y', 'a:b:c']) expect(parseAddress(bad)).toBeNull()
  })
})

describe('usernames', () => {
  it('accepts valid offline usernames only', () => {
    expect(isValidUsername('Steve_01')).toBe(true)
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('this_name_is_way_too_long')).toBe(false)
    expect(isValidUsername('bad name')).toBe(false)
    expect(isValidUsername('héllo')).toBe(false)
  })
})

describe('sanitizeConfig', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeConfig(null)).toEqual(defaultConfig())
    expect(sanitizeConfig('nope')).toEqual(defaultConfig())
    expect(sanitizeConfig({ profiles: 'x', servers: 3 }).profiles.length).toBe(1)
  })
  it('keeps valid data, drops invalid entries and clamps settings', () => {
    const c = sanitizeConfig({
      profiles: [{ id: 'a', username: 'Alice', auth: 'microsoft' }, { nope: true }],
      activeProfileId: 'missing',
      servers: [{ id: 's', name: 'Home', host: '10.0.0.2', port: 25565 }, { host: 5 }],
      settings: { renderDistance: 999, fov: 5, sensitivity: 'fast', clouds: false }
    })
    expect(c.profiles).toEqual([{ id: 'a', name: 'Alice', username: 'Alice', auth: 'microsoft' }])
    expect(c.activeProfileId).toBe('a')
    expect(c.servers.length).toBe(1)
    expect(c.settings.renderDistance).toBe(32)
    expect(c.settings.fov).toBe(30)
    expect(c.settings.sensitivity).toBe(1)
    expect(c.settings.clouds).toBe(false)
  })
})

describe('describeDisconnect', () => {
  it('maps socket errors to actionable messages', () => {
    expect(describeDisconnect({ code: 'ECONNREFUSED' })).toMatch(/refused/i)
    expect(describeDisconnect({ code: 'ENOTFOUND' })).toMatch(/unknown host/i)
    expect(describeDisconnect(new Error('connect ETIMEDOUT 1.2.3.4:25565'))).toMatch(/timed out/i)
    expect(describeDisconnect('socketClosed')).toMatch(/connection lost/i)
    expect(describeDisconnect('something odd')).toBe('something odd')
  })
})

describe('titleText', () => {
  it('flattens JSON, NBT-style and translated components', () => {
    expect(titleText('plain')).toBe('plain')
    expect(titleText('{"text":"a","extra":[{"text":"b"},"c"]}')).toBe('abc')
    expect(titleText({ type: 'compound', value: { text: { type: 'string', value: 'hi' } } })).toBe('hi')
    expect(titleText({ translate: 'multiplayer.disconnect.not_whitelisted' })).toMatch(/white-listed/)
    expect(titleText({ translate: 'some.unknown.key', with: ['x'] })).toBe('some.unknown.key x')
  })
})

describe('server version detection', () => {
  it('maps protocol numbers to the release this client speaks', () => {
    expect(versionForProtocol(774)).toBe('1.21.11')
    expect(versionForProtocol(775)).toBe('26.1')
    expect(versionForProtocol(777)).toBeNull() // 26.3 itself is not spoken natively
  })
  it('notices a server that translates for older clients', () => {
    // Paper 26.3 with ViaVersion echoes the pinging client's protocol (775) but names its own version
    expect(translatedServerVersion('Paper 26.3', '26.1', 775)).toBe('26.3')
    expect(translatedServerVersion('§aPaper 26.3', '1.21.11', 774)).toBe('26.3')
  })
  it('stays quiet for native servers, same-protocol releases and version ranges', () => {
    expect(translatedServerVersion('Paper 1.21.11', '1.21.11', 774)).toBeUndefined()
    expect(translatedServerVersion('Paper 26.1.2', '26.1', 775)).toBeUndefined()
    expect(translatedServerVersion('Velocity 1.7.2-1.21.11', '1.21.11', 774)).toBeUndefined()
    expect(translatedServerVersion('A Minecraft Server', '1.21.11', 774)).toBeUndefined()
    expect(translatedServerVersion(undefined, '1.21.11', 774)).toBeUndefined()
    expect(translatedServerVersion('Paper 26.3', null, 777)).toBeUndefined()
  })
  it('only calls a combination verified when that exact combination passed the suite', () => {
    expect(isVerified('1.21.11')).toBe(true)
    expect(isVerified('1.21.4')).toBe(true)
    expect(isVerified('26.1')).toBe(true) // a native 26.1.x server
    expect(isVerified('1.20.4')).toBe(false)
    expect(isVerified(null)).toBe(false)
    // a 26.3 server that translates for a 26.1 client was tested; other translated pairs were not
    expect(isVerified('26.1', '26.3')).toBe(true)
    expect(isVerified('26.1', '26.2')).toBe(false)
    expect(isVerified('1.21.11', '26.3')).toBe(false)
    expect(VERIFIED_TRANSLATED.every(t => !VERIFIED_VERSIONS.includes(t.server))).toBe(true)
  })
  it('only trusts a status name that states one plain version', () => {
    expect(readStatusVersion('Paper 1.21.11', '1.21.11', 774)).toEqual({ confirmed: true })
    expect(readStatusVersion('Paper 26.1.2', '26.1', 775)).toEqual({ confirmed: true }) // same protocol as 26.1
    expect(readStatusVersion('Paper 26.3', '26.1', 775)).toEqual({ confirmed: false, serverVersion: '26.3' })
    // proxies and renamed servers: nothing can be said, so nothing is claimed
    for (const name of ['Velocity 1.7.2-26.1', 'BungeeCord 1.8.x-1.21.x', 'Paper 1.21.x', 'MyNetwork', 'MyNetwork 2.0', '']) {
      expect(readStatusVersion(name, '26.1', 775)).toEqual({ confirmed: false })
    }
  })
  it('negotiates the version to speak, and whether the result counts as verified', () => {
    // native servers
    expect(negotiate('Paper 1.21.11', 774)).toEqual({ resolved: '1.21.11', serverVersion: undefined, confirmed: true })
    expect(negotiate('Paper 26.1.2', 775)).toEqual({ resolved: '26.1', serverVersion: undefined, confirmed: true })
    // a newer server that translates for us (it echoes our own protocol number)
    expect(negotiate('Paper 26.3', 775)).toEqual({ resolved: '26.1', serverVersion: '26.3', confirmed: false })
    // an older server that translates, but whose own version we speak: use that, without the translation
    expect(negotiate('Paper 1.21.11', 775)).toEqual({ resolved: '1.21.11', confirmed: true })
    // a proxy echoing our protocol: joinable, never "verified"
    expect(negotiate('Velocity 1.7.2-26.1', 775)).toEqual({ resolved: '26.1', serverVersion: undefined, confirmed: false })
    // a protocol we have no data for
    expect(negotiate('Paper 26.3', 777).resolved).toBeNull()
  })
})

describe('profiles in the stored configuration', () => {
  const base = () => {
    const c = defaultConfig()
    const player = c.profiles[0]
    return { c, player }
  }
  it('falls back to a private-server name when the default profile is gone', () => {
    const profiles = [{ id: 'm', name: 'me@example.com', username: 'me@example.com', auth: 'microsoft' as const }, { id: 'o', name: 'Steve', username: 'Steve', auth: 'offline' as const }]
    expect(fallbackProfile(profiles).id).toBe('o')
    expect(fallbackProfile([profiles[0]]).id).toBe('m')
    const { c } = base()
    expect(sanitizeConfig({ ...c, profiles, activeProfileId: 'gone' }).activeProfileId).toBe('o')
  })
  it('turns the per-join profile of 0.1.0 recents into a pin only when it is not the default', () => {
    const { c, player } = base()
    const other = { id: 'brian', name: 'Brian', username: 'Brian', auth: 'offline' as const }
    const raw = {
      ...c,
      profiles: [player, other],
      activeProfileId: player.id,
      recents: [
        { host: 'a.example', port: 25565, name: 'A', at: 1, profileId: other.id }, // joined as someone else
        { host: 'b.example', port: 25565, name: 'B', at: 2, profileId: player.id }, // joined as the default
        { host: 'c.example', port: 25565, name: 'C', at: 3, profileId: 'deleted-profile' },
        { host: 'd.example', port: 25565, name: 'D', at: 4, pinnedProfileId: other.id }
      ]
    }
    const out = sanitizeConfig(raw)
    expect(out.recents.map(r => r.pinnedProfileId)).toEqual([other.id, undefined, undefined, other.id])
    expect(out.recents.every(r => !('profileId' in r))).toBe(true)
  })
})
