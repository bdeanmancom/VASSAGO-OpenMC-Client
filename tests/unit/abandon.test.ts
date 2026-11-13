import { describe, expect, it, vi } from 'vitest'
import { neutralize, stopSignIn, type Attempt } from '../../src/session/session'

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
