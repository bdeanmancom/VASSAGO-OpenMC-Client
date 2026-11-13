/**
 * Token storage encrypted with the OS keychain (Electron safeStorage: Keychain on macOS,
 * DPAPI on Windows, libsecret/kwallet on Linux). If no OS encryption is available the
 * tokens are kept in memory only and never written to disk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { accountOfTokenKey } from '../shared/tokens'

export class SecureStore {
  private file: string
  private memory = new Map<string, string>()
  private data: Record<string, string> = {}

  constructor (dir: string) {
    this.file = path.join(dir, 'accounts.bin')
    try { if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { this.data = {} }
  }

  get available (): boolean {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  }

  get (key: string): string | null {
    if (this.memory.has(key)) return this.memory.get(key)!
    const enc = this.data[key]
    if (!enc || !this.available) return null
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { return null }
  }

  set (key: string, value: string): void {
    this.memory.set(key, value)
    if (!this.available) return
    try {
      this.data[key] = safeStorage.encryptString(value).toString('base64')
      fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 })
    } catch {}
  }

  /** Every key currently held (in memory or on disk). */
  keys (): string[] {
    return [...new Set([...this.memory.keys(), ...Object.keys(this.data)])]
  }

  /** Remove every cached token for an account. */
  forget (username: string): void {
    // exact account, not a prefix: "team" must not take "team:alice" with it
    for (const k of [...this.memory.keys()]) if (accountOfTokenKey(k) === username) this.memory.delete(k)
    for (const k of Object.keys(this.data)) if (accountOfTokenKey(k) === username) delete this.data[k]
    try { fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 }) } catch {}
  }
}
