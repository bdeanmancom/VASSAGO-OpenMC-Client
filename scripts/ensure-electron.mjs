#!/usr/bin/env node
// Makes sure the Electron runtime binary is present before launching.
//
// Electron's npm package downloads its binary in a post-install step. That step can be
// skipped (npm `ignore-scripts`, package managers that block dependency install scripts)
// or interrupted (network drop), which leaves node_modules/electron without a binary and
// makes `electron .` fail with "Electron failed to install correctly". This script detects
// that state and runs the download on demand, so `npm start` heals itself.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')

function installed () {
  try {
    const rel = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim()
    return rel.length > 0 && fs.existsSync(path.join(electronDir, 'dist', rel))
  } catch { return false }
}

if (!fs.existsSync(path.join(electronDir, 'install.js'))) {
  console.error('Electron is not installed. Run `npm install` in the project folder first.')
  process.exit(1)
}

if (!installed()) {
  console.log('Electron runtime not found — downloading it now (one-time, about 100 MB)…')
  const env = { ...process.env }
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  const res = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit', env })
  if (res.status !== 0 || !installed()) {
    console.error([
      '',
      'Could not download the Electron runtime.',
      '  • Check your internet connection (the download comes from github.com) and run `npm start` again.',
      '  • Behind a proxy or firewall? Set HTTPS_PROXY, or use a mirror: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/',
      '  • Last resort: delete the node_modules folder and run `npm install` again.'
    ].join('\n'))
    process.exit(1)
  }
  console.log('Electron runtime installed.')
}
