import { describe, expect, it, vi } from 'vitest'
import { describeAccountState, javaAccountState, neutralize, stopSignIn, type Attempt } from '../../src/session/session'
import { createAttemptGate, newAttemptId } from '../../src/shared/attempt'
import type { SessionEvent } from '../../src/shared/protocol'

describe('a torn-down client', () => {
  it('destroys any socket it is handed later instead of using it', () => {
    const used = vi.fn()
    const client: any = { setSocket: used }
    neutralize(client)
    const socket = { on: vi.fn(), destroy: vi.fn() }
    client.setSocket(socket)
    expect(used).not.toHaveBeenCalled()
    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(() => client.setSocket(undefined)).not.toThrow()
    expect(() => neutralize(null)).not.toThrow()
  })
})

describe('an abandoned Microsoft sign-in', () => {
  it('can no longer connect and its polling is stopped, also after the library re-arms it', async () => {
    vi.useFakeTimers()
    try {
      const connect = vi.fn()
      const attempt: Attempt = { abandoned: true, options: { connect } }
      const msa = { polling: true }
      stopSignIn(attempt, { authflow: { msa } })
      expect(msa.polling).toBe(false)
      // what the protocol library calls when sign-in completes
      attempt.options.connect({})
      expect(connect).not.toHaveBeenCalled()

      // the library issues a new code and starts polling again; the guarded callback stops it again
      msa.polling = true
      stopSignIn(attempt)
      msa.polling = true // set by the library right after the code callback returns
      vi.advanceTimersByTime(300)
      expect(msa.polling).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('copes with a sign-in that has not started or has no stop flag', () => {
    expect(() => stopSignIn({ abandoned: true, options: null })).not.toThrow()
    expect(() => stopSignIn({ abandoned: true, options: {} }, { authflow: {} })).not.toThrow()
  })
})

describe('events of a shared session', () => {
  const disconnect: SessionEvent = { t: 'disconnect', reason: 'Disconnected', kicked: false, canReconnect: true }
  it('a new screen ignores what the previous connection still had to say', () => {
    const mine = createAttemptGate(7)
    // the previous screen closed its connection; its farewell arrives after we started listening
    expect(mine(disconnect)).toBe(false)
    expect(mine({ t: 'phase', phase: 'disconnected' })).toBe(false)
    expect(mine({ t: 'phase', phase: 'connecting', attempt: 6 })).toBe(false) // someone else's opening event
    expect(mine({ t: 'msaCode', userCode: 'X', verificationUri: 'https://example.invalid', expiresIn: 900 })).toBe(false)
    // our own attempt opens; from here on everything is ours, including a real disconnect
    expect(mine({ t: 'phase', phase: 'connecting', attempt: 7 })).toBe(true)
    expect(mine({ t: 'phase', phase: 'login' })).toBe(true)
    expect(mine(disconnect)).toBe(true)
  })
  it('always hears that the session itself stopped', () => {
    const mine = createAttemptGate(1)
    expect(mine({ ...disconnect, engineStopped: true })).toBe(true)
  })
  it('hands out distinct ids', () => {
    const a = newAttemptId(); const b = newAttemptId()
    expect(b).not.toBe(a)
    expect(Number.isSafeInteger(a) && Number.isSafeInteger(b)).toBe(true)
  })
})

describe('what a Microsoft account without a returned profile is told', () => {
  const flow = (o: { items?: unknown, profile?: () => Promise<unknown>, fail?: boolean }) => ({
    getMinecraftJavaToken: async () => { if (o.fail) throw new Error('network'); return { token: 'tok', entitlements: o.items === undefined ? undefined : { items: o.items } } },
    mca: { fetchProfile: async (token: string) => { expect(token).toBe('tok'); return await (o.profile ?? (async () => { throw new Error('503 Service Unavailable') }))() } }
  })
  const owned = [{ name: 'product_minecraft' }, { name: 'game_minecraft' }]
  const notFound = async () => { throw new Error('404 Not Found {"error":"NOT_FOUND"}') }

  it('reports a missing profile only when the service says 404', async () => {
    expect(await javaAccountState(flow({ items: owned, profile: notFound }))).toEqual({ owns: true, profile: 'missing' })
    expect(await javaAccountState(flow({ items: [], profile: notFound }))).toEqual({ owns: false, profile: 'missing' })
    expect(await javaAccountState(flow({ items: owned, profile: async () => { throw new Error('429 Too Many Requests') } }))).toEqual({ owns: true, profile: 'unknown' })
    expect(await javaAccountState(flow({ items: owned, profile: async () => ({ id: 'x', name: 'Steve' }) }))).toEqual({ owns: true, profile: 'present' })
    expect(await javaAccountState(flow({ fail: true }))).toEqual({ owns: null, profile: 'unknown' })
    expect(await javaAccountState(null)).toEqual({ owns: null, profile: 'unknown' })
  })
  it('chooses the message from what is actually known', () => {
    expect(describeAccountState({ owns: true, profile: 'missing' })).toMatchObject({ kind: 'ms-profile-missing' })
    expect(describeAccountState({ owns: false, profile: 'missing' })).toMatchObject({ kind: 'ms-not-owned' })
    // a rate limit or server error is not "you have no player name"
    expect(describeAccountState({ owns: true, profile: 'unknown' })).toEqual({})
    expect(describeAccountState({ owns: false, profile: 'unknown' })).toEqual({})
    expect(describeAccountState({ owns: null, profile: 'missing' })).toEqual({})
    // the profile exists after all: the first request just failed
    expect(describeAccountState({ owns: true, profile: 'present' })).toMatchObject({ kind: 'ms-signin' })
  })
})
