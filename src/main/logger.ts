/** Structured (JSON lines) logging to a rotating file in the user data directory. */
import fs from 'node:fs'
import path from 'node:path'

export type Level = 'debug' | 'info' | 'warn' | 'error'

export class Logger {
  private stream: fs.WriteStream | null = null
  private recent: string[] = []
  readonly file: string

  constructor (dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'vassago.log')
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 2 * 1024 * 1024) fs.renameSync(this.file, this.file + '.1')
    } catch {}
    try { this.stream = fs.createWriteStream(this.file, { flags: 'a' }) } catch {}
  }

  log (level: Level, source: string, msg: string, data?: unknown) {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, source, msg }
    if (data !== undefined) entry.data = data
    let line: string
    try { line = JSON.stringify(entry) } catch { line = JSON.stringify({ ...entry, data: String(data) }) }
    this.recent.push(line)
    if (this.recent.length > 500) this.recent.shift()
    this.stream?.write(line + '\n')
    if (level === 'error' || level === 'warn' || process.env.VASSAGO_DEBUG) console.log(`[${level}] ${source}: ${msg}`)
  }

  tail (): string[] { return [...this.recent] }
}
