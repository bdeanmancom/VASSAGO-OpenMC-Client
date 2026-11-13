import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { PingResult } from '../../shared/protocol'

export function Logo ({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f8dff" /><stop offset="1" stopColor="#9b5cff" /></linearGradient>
        <linearGradient id="lg-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fb0ff" /><stop offset="1" stopColor="#5b3fd6" /></linearGradient>
      </defs>
      <path d="M32 3 58 17v30L32 61 6 47V17z" fill="#10131d" stroke="url(#lg-a)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M17 19h9l6 17 6-17h9L35 49h-6z" fill="url(#lg-b)" />
      <path d="M32 36l6-17h9l-4 8.6z" fill="#fff" opacity=".22" />
      <circle cx="32" cy="14.5" r="2.4" fill="#9fd0ff" />
    </svg>
  )
}

const MOTD_COLORS: Record<string, string> = {
  0: '#1a1c24', 1: '#3a55d9', 2: '#2fae4d', 3: '#27b3b3', 4: '#d94a4a', 5: '#b451d6', 6: '#f0a630', 7: '#b4bac8',
  8: '#6b7284', 9: '#6f8dff', a: '#6dee7f', b: '#6ee7f2', c: '#ff7676', d: '#f37df5', e: '#fff275', f: '#ffffff'
}

/** Renders legacy §-formatted text (including §#rrggbb) as styled spans. */
export function MotdText ({ text, className }: { text: string, className?: string }) {
  const parts: ReactNode[] = []
  let style: CSSProperties = {}
  let buf = ''
  let key = 0
  const flush = () => { if (buf) { parts.push(<span key={key++} style={style}>{buf}</span>); buf = '' } }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '§' && i + 1 < text.length) {
      if (text[i + 1] === '#' && /^[0-9a-fA-F]{6}$/.test(text.slice(i + 2, i + 8))) {
        flush(); style = { color: text.slice(i + 1, i + 8) }; i += 7; continue
      }
      const code = text[i + 1].toLowerCase()
      flush()
      if (code in MOTD_COLORS) style = { color: MOTD_COLORS[code] }
      else if (code === 'l') style = { ...style, fontWeight: 700 }
      else if (code === 'o') style = { ...style, fontStyle: 'italic' }
      else if (code === 'n') style = { ...style, textDecoration: 'underline' }
      else if (code === 'm') style = { ...style, textDecoration: 'line-through' }
      else if (code === 'r') style = {}
      i++
      continue
    }
    buf += ch
  }
  flush()
  return <span className={className}>{parts}</span>
}

export function stripMotd (text: string): string { return text.replace(/§#[0-9a-fA-F]{6}|§./g, '') }

export function PingBars ({ ping }: { ping: PingResult | 'loading' | undefined }) {
  if (ping === 'loading' || ping === undefined) return <span className="ping ping-loading" title="Pinging…"><i /><i /><i /><i /></span>
  if (!ping.online) return <span className="ping ping-off" title={ping.error ?? 'Offline'}><i /><i /><i /><i /></span>
  const ms = ping.latency ?? 999
  const level = ms < 80 ? 4 : ms < 160 ? 3 : ms < 300 ? 2 : 1
  return <span className={`ping ping-${level}`} title={`${ms} ms`}><i /><i /><i /><i /></span>
}

export function Toggle ({ value, onChange, label, hint }: { value: boolean, onChange: (v: boolean) => void, label: string, hint?: string }) {
  return (
    <label className="row">
      <span className="row-text"><span className="row-label">{label}</span>{hint && <span className="row-hint">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={value} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><span /></button>
    </label>
  )
}

export function Slider ({ value, min, max, step = 1, onChange, label, hint, format }: { value: number, min: number, max: number, step?: number, onChange: (v: number) => void, label: string, hint?: string, format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="row">
      <span className="row-text"><span className="row-label">{label}</span>{hint && <span className="row-hint">{hint}</span>}</span>
      <span className="slider-wrap">
        <input type="range" className="slider" min={min} max={max} step={step} value={value} style={{ ['--pct' as any]: `${pct}%` }} onChange={e => onChange(Number(e.target.value))} />
        <span className="slider-value">{format ? format(value) : value}</span>
      </span>
    </label>
  )
}

export function Segmented<T extends string> ({ value, options, onChange }: { value: T, options: { value: T, label: string }[], onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(o => <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  )
}

export function Modal ({ title, children, onClose, actions, wide }: { title: string, children: ReactNode, onClose?: () => void, actions?: ReactNode, wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function Icon ({ name, size = 18 }: { name: string, size?: number }) {
  const p: Record<string, ReactNode> = {
    play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />,
    servers: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
    direct: <><path d="M13 3 5 13h6l-1 8 8-10h-6z" /></>,
    profiles: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
    check: <path d="m5 12 5 5 9-10" />,
    shield: <><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z" /></>,
    warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v5M12 17.5h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
    ms: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    x: <path d="M6 6l12 12M18 6 6 18" />
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>
}
