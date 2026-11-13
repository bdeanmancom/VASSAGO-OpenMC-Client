/**
 * An abandoned Microsoft sign-in must stay inert — tested on the real GameSession and the real
 * protocol library. Only the two ends are replaced: Microsoft (the sign-in "completes" when the
 * test says so) and the network (connections are counted, never made).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { GameSession } from '../../src/session/session'
import type { SessionEvent } from '../../src/shared/protocol'

const require = createRequire(import.meta.url)
const { Authflow } = require('prismarine-auth')
const net = require('net')
const dns = require('dns')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * `lateCode`: the library issues a second code after the sign-in was released (it does that when
 * it retries). Kept out of the cases that count connections: receiving a late code is itself a
 * moment at which the session shuts the old sign-in down, and those cases must hold without it.
 */
function setup ({ lateCode = false } = {}) {
  const events: SessionEvent[] = []
  const stored = vi.fn(async (_key: string, _value: string) => {})
  const session = new GameSession({ emit: ev => { events.push(ev) }, secureStore: { get: async () => null, set: stored } })

  let finishSignIn!: () => void
  const signedIn = new Promise<void>(resolve => { finishSignIn = resolve })
  vi.spyOn(Authflow.prototype, 'getMinecraftJavaToken').mockImplementation(async function (this: any) {
    // what the library does: show a code, wait for the user, store the tokens, report the profile
    this.codeCallback?.({ user_code: 'FIRST-CODE', verification_uri: 'https://example.invalid/link', expires_in: 900 })
    await signedIn
    await this.mca.cache.setCachedPartial({ mca: { token: 'secret' } })
    if (lateCode) this.codeCallback?.({ user_code: 'LATE-CODE', verification_uri: 'https://example.invalid/link', expires_in: 900 })
    return { token: 'tok', entitlements: {}, profile: { id: '0'.repeat(32), name: 'Steve' }, certificates: {} }
  })
  const sockets: any[] = []
  vi.spyOn(net, 'connect').mockImplementation((() => { const s = new net.Socket(); sockets.push(s); return s }) as any)

  const connect = (auth: 'microsoft' | 'offline') => session.handle({
    t: 'connect',
    opts: { host: '127.0.0.1', port: 25565, username: auth === 'microsoft' ? 'me@example.com' : 'Steve', auth, version: '1.21.11', viewDistance: 4 }
  })
  const codes = () => events.filter(e => e.t === 'msaCode').map(e => (e as any).userCode)
  const codeShown = async () => { for (let i = 0; i < 200 && codes().length === 0; i++) await sleep(10); expect(codes()).toEqual(['FIRST-CODE']) }
  return { session, events, stored, sockets, connect, codes, codeShown, finishSignIn }
}

afterEach(() => { vi.restoreAllMocks() })

describe('a Microsoft sign-in the player walked away from', () => {
  it('normally: finishing the sign-in stores the tokens and opens the connection', async () => {
    const t = setup()
    t.connect('microsoft')
    await t.codeShown()
    t.finishSignIn()
    await sleep(100)
    expect(t.stored).toHaveBeenCalled()
    expect(t.sockets.length).toBe(1)
    t.session.handle({ t: 'disconnect' })
  })

  it('after Cancel: finishing it later opens no connection, shows no code and stores nothing', async () => {
    const t = setup()
    t.connect('microsoft')
    await t.codeShown()
    t.session.handle({ t: 'disconnect' })
    expect(t.events.filter(e => e.t === 'disconnect').length).toBe(1)
    t.finishSignIn() // the player completes the sign-in in the browser anyway
    await sleep(400)
    expect(t.sockets.length).toBe(0)
    expect(t.codes()).toEqual(['FIRST-CODE'])
    expect(t.stored).not.toHaveBeenCalled()
    expect(t.events.filter(e => e.t === 'login').length).toBe(0)
  })

  it('after Cancel: a code the library issues later is not shown', async () => {
    const t = setup({ lateCode: true })
    t.connect('microsoft')
    await t.codeShown()
    t.session.handle({ t: 'disconnect' })
    t.finishSignIn()
    await sleep(400)
    expect(t.codes()).toEqual(['FIRST-CODE'])
    expect(t.sockets.length).toBe(0)
    expect(t.stored).not.toHaveBeenCalled()
  })

  it('after switching to a private-server profile: the old sign-in cannot touch the new connection', async () => {
    const t = setup()
    t.connect('microsoft')
    await t.codeShown()
    t.connect('offline') // "Use a private-server profile instead"
    await sleep(100)
    expect(t.sockets.length).toBe(1) // the private-server connection, and only that
    const before = t.events.length
    t.finishSignIn()
    await sleep(400)
    expect(t.sockets.length).toBe(1)
    expect(t.codes()).toEqual(['FIRST-CODE'])
    expect(t.stored).not.toHaveBeenCalled()
    // nothing from the old attempt reached the new one's event stream
    expect(t.events.slice(before).filter(e => e.t === 'msaCode' || e.t === 'disconnect')).toEqual([])
    t.session.handle({ t: 'disconnect' })
  })
})

describe('a private-server connection cancelled while its address is still being looked up', () => {
  it('destroys the socket the library opens when the lookup returns, instead of logging in with it', async () => {
    const t = setup()
    let answer: ((err: Error | null, addresses?: unknown[]) => void) | undefined
    vi.spyOn(dns, 'resolveSrv').mockImplementation(((_name: string, cb: any) => { answer = cb }) as any)
    t.session.handle({ t: 'connect', opts: { host: 'play.example.invalid', port: 25565, username: 'Steve', auth: 'offline', version: '1.21.11', viewDistance: 4 } })
    await sleep(50)
    expect(answer, 'the library is waiting for the SRV lookup').toBeTypeOf('function')
    expect(t.sockets.length).toBe(0)
    t.session.handle({ t: 'disconnect' })
    answer!(new Error('ENOTFOUND')) // no SRV record: the library now connects to the name directly
    await sleep(50)
    expect(t.sockets.length).toBe(1)
    expect(t.sockets[0].destroyed).toBe(true)
    expect(t.events.filter(e => e.t === 'login').length).toBe(0)
  })
})
