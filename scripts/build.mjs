#!/usr/bin/env node
// Builds main/preload/session (esbuild, CommonJS, node_modules external) and the renderer (Vite).
import { build } from 'esbuild'
import { build as viteBuild } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const watchless = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'warning', packages: 'external' }

if (!fs.existsSync(path.join(root, 'resources', 'gamedata', 'index.json'))) {
  await import('./gen-blockdata.mjs')
}

await build({ ...watchless, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(root, 'dist/main/main.js'), external: ['electron'] })
await build({ ...watchless, entryPoints: [path.join(root, 'src/main/preload.ts')], outfile: path.join(root, 'dist/main/preload.js'), external: ['electron'], packages: undefined })
await build({ ...watchless, entryPoints: [path.join(root, 'src/session/worker.ts')], outfile: path.join(root, 'dist/session/worker.js') })

await viteBuild({
  configFile: false,
  root: path.join(root, 'src/renderer'),
  base: './',
  logLevel: 'warn',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [(await import('@vitejs/plugin-react')).default()],
  worker: { format: 'es' },
  build: { outDir: path.join(root, 'dist/renderer'), emptyOutDir: true, target: 'chrome130', sourcemap: true, chunkSizeWarningLimit: 2500 }
})
console.log('build complete')
