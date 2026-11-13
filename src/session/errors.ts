/** Turn low-level socket / protocol failures into messages a player can act on. */
export function describeDisconnect (err: unknown): string {
  const e = err as any
  const code: string = e?.code ?? ''
  const msg: string = typeof err === 'string' ? err : (e?.message ?? String(err ?? ''))
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'Connection refused — no server is listening at that address and port.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Unknown host — check the server address.'
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|Timed out|timeout/i.test(msg)) return 'Connection timed out — the server did not respond.'
  if (code === 'ECONNRESET' || /ECONNRESET|socketClosed/.test(msg)) return 'Connection lost — the server closed the connection.'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Network unreachable — check your internet connection.'
  if (/does not own|profile|entitlement/i.test(msg)) return 'This Microsoft account does not own Minecraft: Java Edition.'
  if (/invalid.?session|Invalid credentials|401|403/i.test(msg)) return 'Authentication failed — sign in again.'
  if (/keepAliveError|client timed out/i.test(msg)) return 'Timed out — lost contact with the server.'
  if (msg === 'disconnect.quitting' || msg === 'Disconnected') return 'Disconnected'
  return msg || 'Disconnected'
}
