/** Loads/saves the launcher configuration atomically; recovers from corrupt files. */
import fs from 'node:fs'
import path from 'node:path'
import { defaultConfig, sanitizeConfig, type AppConfig } from '../shared/config'

export class ConfigStore {
  private file: string
  constructor (dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'config.json')
  }

  /** True when the last load() could not read the stored file and fell back to defaults. */
  unreadable = false

  load (): AppConfig {
    this.unreadable = false
    try {
      if (!fs.existsSync(this.file)) return defaultConfig()
      return sanitizeConfig(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      this.unreadable = true
      try { fs.renameSync(this.file, this.file + '.corrupt') } catch {}
      return defaultConfig()
    }
  }

  save (cfg: AppConfig): void {
    const clean = sanitizeConfig(cfg)
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2))
    fs.renameSync(tmp, this.file)
  }
}
