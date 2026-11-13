// Boots real PaperMC servers for the integration suite (or reuses already-running
// ones when VASSAGO_TEST_PORT / VASSAGO_TEST_ONLINE_PORT are set).
import type { GlobalSetupContext } from 'vitest/node'

export default async function setup ({ provide }: GlobalSetupContext) {
  // @ts-expect-error plain JS module
  const { startServer, parseArgs } = await import('../../scripts/test-server.mjs')
  const version = process.env.VASSAGO_TEST_VERSION ?? '1.21.11'
  // Version the client is expected to speak. Differs from the server version when the server
  // admits older clients through ViaVersion/ViaBackwards (VASSAGO_TEST_VIA=1).
  const clientVersion = process.env.VASSAGO_TEST_CLIENT_VERSION ?? version
  const via = process.env.VASSAGO_TEST_VIA === 'latest' ? 'latest' : process.env.VASSAGO_TEST_VIA === '1'
  const build = process.env.VASSAGO_TEST_BUILD ?? 'latest'
  const started: any[] = []
  let port = Number(process.env.VASSAGO_TEST_PORT ?? 0)
  let onlinePort = Number(process.env.VASSAGO_TEST_ONLINE_PORT ?? 0)
  const boots: Promise<void>[] = []
  if (!port) {
    port = 25580
    boots.push(startServer({ ...parseArgs([]), difficulty: 'peaceful', version, build, via, port, resourcePack: 'http://127.0.0.1:9/vassago-test-pack.zip', acceptEula: process.env.MC_EULA === 'true' }, { quiet: true }).then((s: any) => { started.push(s) }))
  }
  if (!onlinePort) {
    onlinePort = 25581
    boots.push(startServer({ ...parseArgs([]), difficulty: 'peaceful', version, build, via, port: onlinePort, online: true, levelType: 'minecraft:flat', acceptEula: process.env.MC_EULA === 'true' }, { quiet: true }).then((s: any) => { started.push(s) }))
  }
  await Promise.all(boots)
  provide('port', port)
  provide('onlinePort', onlinePort)
  provide('version', version)
  provide('clientVersion', clientVersion)
  return async () => { await Promise.all(started.map(s => s.stop())) }
}

declare module 'vitest' {
  export interface ProvidedContext { port: number, onlinePort: number, version: string, clientVersion: string }
}
