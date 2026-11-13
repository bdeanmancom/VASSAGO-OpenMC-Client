/**
 * Worker-thread entry: hosts a GameSession off the Electron main thread and
 * relays commands/events over the parent port.
 */
import { parentPort } from 'node:worker_threads'
import { GameSession } from './session'
import { pingServer, supportedVersions } from './versions'
import type { SessionCommand } from '../shared/protocol'

if (!parentPort) throw new Error('session worker must be started as a worker thread')
const port = parentPort

const pendingSecure = new Map<number, (v: string | null) => void>()
let secureSeq = 1
function secureCall (op: 'get' | 'set', key: string, value?: string): Promise<string | null> {
  return new Promise(resolve => {
    const id = secureSeq++
    pendingSecure.set(id, resolve)
    port.postMessage({ k: 'secure', id, op, key, value })
  })
}

const session = new GameSession({
  emit: (ev, transfer) => port.postMessage({ k: 'event', ev }, transfer ?? []),
  secureStore: {
    get: key => secureCall('get', key),
    set: async (key, value) => { await secureCall('set', key, value) }
  }
})

port.on('message', (msg: any) => {
  if (msg.k === 'cmd') session.handle(msg.cmd as SessionCommand)
  else if (msg.k === 'secureResult') { pendingSecure.get(msg.id)?.(msg.value ?? null); pendingSecure.delete(msg.id) } else if (msg.k === 'ping') {
    pingServer(msg.host, msg.port).then(result => port.postMessage({ k: 'pingResult', id: msg.id, result }))
  } else if (msg.k === 'versions') {
    port.postMessage({ k: 'versionsResult', id: msg.id, result: supportedVersions() })
  }
})

process.on('uncaughtException', err => {
  port.postMessage({ k: 'event', ev: { t: 'log', level: 'error', msg: `session worker uncaught exception: ${err?.stack ?? err}` } })
})
process.on('unhandledRejection', err => {
  port.postMessage({ k: 'event', ev: { t: 'log', level: 'warn', msg: `session worker unhandled rejection: ${(err as any)?.stack ?? err}` } })
})
