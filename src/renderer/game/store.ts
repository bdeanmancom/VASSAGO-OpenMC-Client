/** Tiny observable store that feeds the React HUD from the game loop. */
import { useSyncExternalStore } from 'react'
import type { ItemDTO, PlayerListEntry, SessionPhase, WindowDTO } from '../../shared/protocol'

export interface ChatLine { id: number, motd: string, time: number }

export interface HudState {
  phase: SessionPhase
  phaseDetail: string
  worldReady: boolean
  server: string
  username: string
  version: string
  health: number
  food: number
  xpLevel: number
  xpProgress: number
  gameMode: string
  dead: boolean
  window: WindowDTO | null
  inventory: WindowDTO | null
  hotbar: number
  chat: ChatLine[]
  actionBar: { text: string, time: number } | null
  title: { text: string, sub: string, time: number } | null
  players: PlayerListEntry[]
  /** which overlay currently owns input */
  screen: 'none' | 'pause' | 'chat' | 'inventory' | 'settings'
  chatPrefill: string
  showDebug: boolean
  showPlayers: boolean
  hideHud: boolean
  debug: string[]
  fps: number
  resourcePack: { url: string, forced: boolean, prompt?: string } | null
  msaCode: { userCode: string, verificationUri: string } | null
  disconnect: { reason: string, kicked: boolean } | null
  hurtAt: number
  digProgress: number
  target: string
  heldName: { text: string, time: number } | null
  flying: boolean
  pointerLocked: boolean
}

export const initialHud = (): HudState => ({
  phase: 'idle',
  phaseDetail: '',
  worldReady: false,
  server: '',
  username: '',
  version: '',
  health: 20,
  food: 20,
  xpLevel: 0,
  xpProgress: 0,
  gameMode: 'survival',
  dead: false,
  window: null,
  inventory: null,
  hotbar: 0,
  chat: [],
  actionBar: null,
  title: null,
  players: [],
  screen: 'none',
  chatPrefill: '',
  showDebug: false,
  showPlayers: false,
  hideHud: false,
  debug: [],
  fps: 0,
  resourcePack: null,
  msaCode: null,
  disconnect: null,
  hurtAt: 0,
  digProgress: 0,
  target: '',
  heldName: null,
  flying: false,
  pointerLocked: false
})

export class Store<T extends object> {
  private listeners = new Set<() => void>()
  constructor (private state: T) {}
  get = (): T => this.state
  set (patch: Partial<T>) {
    let changed = false
    for (const k in patch) if (patch[k] !== (this.state as any)[k]) { changed = true; break }
    if (!changed) return
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
}

export function useStore<T extends object, R> (store: Store<T>, selector: (s: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}

export function heldItem (s: HudState): ItemDTO | null {
  return s.inventory?.slots[36 + s.hotbar] ?? null
}
