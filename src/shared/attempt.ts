/**
 * The session (and its ordered event stream) outlives any one game screen. When a screen closes
 * its connection and another opens one right away, the answer to the first — typically a
 * "Disconnected" — arrives after the second has started listening. Each connect command therefore
 * carries an id, the session echoes it on the event that opens the attempt, and a screen only
 * listens from that event on.
 */
import type { SessionEvent } from './protocol'

/** Returns a filter: true for events that belong to the attempt with this id. */
export function createAttemptGate (attemptId: number): (ev: SessionEvent) => boolean {
  let live = false
  return ev => {
    if (live) return true
    if (ev.t === 'phase' && ev.attempt === attemptId) { live = true; return true }
    // the host reporting that the session itself died concerns whoever is listening
    return ev.t === 'disconnect' && ev.engineStopped === true
  }
}

let next = (Date.now() % 1_000_000_000) * 1000

/** A fresh id; time-based so a reloaded window cannot reuse one that is still in flight. */
export function newAttemptId (): number { return next++ }
