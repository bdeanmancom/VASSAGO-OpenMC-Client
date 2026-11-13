import { describe, expect, it } from 'vitest'
import { defaultConfig, isValidUsername, parseAddress, sanitizeConfig } from '../../src/shared/config'
import { describeDisconnect } from '../../src/session/errors'
import { titleText } from '../../src/session/session'

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
