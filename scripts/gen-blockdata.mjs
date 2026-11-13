#!/usr/bin/env node
// Generates the compact per-version game data tables the renderer needs
// (block states, collision shapes, item and entity names) from minecraft-data.
// Output: resources/gamedata/<version>.json
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mcDataLoader = require('minecraft-data')
const mineflayer = require('mineflayer')
const mc = require('minecraft-protocol')

// `--if-missing` makes this a no-op when the tables already exist (used by pretest/prebuild hooks).
if (process.argv.includes('--if-missing') && fs.existsSync(path.join(root, 'resources', 'gamedata', 'index.json'))) process.exit(0)

const versions = mineflayer.testedVersions.filter(v => mc.supportedVersions.includes(v) && mcDataLoader(v)?.isNewerOrEqualTo('1.20.2'))
const outDir = path.join(root, 'resources', 'gamedata')
fs.mkdirSync(outDir, { recursive: true })

const round = n => Math.round(n * 10000) / 10000

for (const version of versions) {
  const d = mcDataLoader(version)
  if (!d.blockCollisionShapes) { console.warn(`skip ${version}: no collision shapes`); continue }
  const shapeIndex = new Map()
  const shapes = []
  const internShape = boxes => {
    const key = JSON.stringify(boxes)
    let i = shapeIndex.get(key)
    if (i === undefined) { i = shapes.length; shapes.push(boxes.map(b => b.map(round))); shapeIndex.set(key, i) }
    return i
  }
  const blocks = d.blocksArray.map(b => {
    const raw = d.blockCollisionShapes.blocks[b.name]
    const toIdx = id => internShape(d.blockCollisionShapes.shapes[id] ?? [])
    const s = Array.isArray(raw) ? raw.map(toIdx) : toIdx(raw ?? 0)
    return {
      n: b.name,
      d: b.displayName,
      min: b.minStateId,
      max: b.maxStateId,
      def: b.defaultState,
      tr: b.transparent ? 1 : 0,
      el: b.emitLight,
      fl: b.filterLight,
      bb: b.boundingBox,
      h: b.hardness,
      p: (b.states ?? []).map(st => [st.name, st.type === 'bool' ? ['true', 'false'] : st.values.map(String)]),
      s
    }
  })
  const items = d.itemsArray.map(i => ({ id: i.id, n: i.name, d: i.displayName, ss: i.stackSize }))
  const entities = d.entitiesArray.map(e => ({ id: e.id, n: e.name, d: e.displayName, w: e.width, h: e.height, t: e.type }))
  const out = { version, protocol: d.version.version, blocks, shapes, items, entities }
  fs.writeFileSync(path.join(outDir, `${version}.json`), JSON.stringify(out))
  console.log(`gamedata ${version}: ${blocks.length} blocks, ${shapes.length} shapes, ${items.length} items`)
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ versions }))
