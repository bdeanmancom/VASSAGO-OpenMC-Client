#!/usr/bin/env node
// Renders the original Vassago logo (SVG below) to build/icon.png (1024×1024).
// electron-builder derives the .ico / .icns from this PNG.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171c33"/><stop offset="1" stop-color="#0a0c14"/></linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8dff"/><stop offset="1" stop-color="#9b5cff"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fbaff"/><stop offset="1" stop-color="#5b3fd6"/></linearGradient>
    <radialGradient id="g" cx="0.5" cy="0.35" r="0.6"><stop offset="0" stop-color="#5b6dff" stop-opacity=".45"/><stop offset="1" stop-color="#5b6dff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bg)"/>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/>
  <path d="M32 9 52 20v24L32 55 12 44V20z" fill="#0d1019" stroke="url(#a)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M20.5 22h7l4.5 13 4.5-13h7L34.4 45h-4.8z" fill="url(#b)"/>
  <path d="M32 35l4.5-13h7l-3 6.6z" fill="#fff" opacity=".22"/>
  <circle cx="32" cy="17.4" r="1.9" fill="#a9d4ff"/>
</svg>`
const local = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
const browser = await chromium.launch(fs.existsSync(local) ? { executablePath: local } : {})
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
await page.screenshot({ path: path.join(root, 'build', 'icon.png'), omitBackground: true })
await browser.close()
console.log('wrote build/icon.png')
