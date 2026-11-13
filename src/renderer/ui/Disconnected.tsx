import { useState } from 'react'
import type { AuthMode, ConnectOptions, DisconnectKind } from '../../shared/protocol'
import { OWNER_NOTE, OWNER_STEPS, disconnectCopy, ownerStepsText } from '../../shared/guidance'
import { Icon } from './components'
import type { Target } from './App'

export interface DisconnectInfo { reason: string, kicked: boolean, kind?: DisconnectKind, detail?: string, auth?: AuthMode }

interface Props {
  info: DisconnectInfo
  target: Target
  opts: ConnectOptions
  wasInWorld: boolean
  onReconnect: () => void
  onExit: () => void
  /** Connect again as a different kind of profile. `fresh` signs the Microsoft account out first. */
  onRetryAs: (mode: AuthMode, fresh?: boolean) => void
}

function OwnerSteps ({ server }: { server: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const text = ownerStepsText(server)
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2500) }
    try { void navigator.clipboard.writeText(text).then(done, () => {}) } catch {}
  }
  return (
    <>
      <ol className="dc-steps" data-testid="owner-steps">
        {OWNER_STEPS.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <p className="dc-note">{OWNER_NOTE}</p>
      <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy these steps'}</button>
    </>
  )
}

export function Disconnected ({ info, target, opts, wasInWorld, onReconnect, onExit, onRetryAs }: Props) {
  const copy = disconnectCopy(info.kind, { kicked: info.kicked, wasInWorld })
  const address = `${opts.host}${opts.port !== 25565 ? `:${opts.port}` : ''}`
  const serverLine = target.name === opts.host ? address : `${target.name} · ${address}`
  const identity = opts.auth === 'microsoft' ? `Microsoft account “${opts.username}”` : `private-server name “${opts.username}”`
  const details = info.detail && info.detail !== info.reason
    ? <details className="dc-details"><summary>Technical details</summary><code data-testid="disconnect-detail">{info.detail}</code></details>
    : null

  if (copy.layout === 'simple') {
    return (
      <div className="overlay solid">
        <div className="disconnect-card" data-testid="disconnected" data-kind={info.kind ?? 'other'}>
          <div className={`dc-icon ${copy.tone === 'warn' ? 'kick' : ''}`}><Icon name={copy.tone === 'warn' ? 'warn' : 'x'} size={30} /></div>
          <h2>{copy.title}</h2>
          <p className="dc-reason" data-testid="disconnect-reason">{info.reason}</p>
          <div className="dc-server">{serverLine} · as {identity}</div>
          <div className="dc-actions">
            <button className="btn primary big" data-testid="reconnect" onClick={onReconnect}><Icon name="refresh" />{info.kind === 'ms-signin' || info.kind === 'ms-profile-missing' ? 'Try again' : 'Reconnect'}</button>
            <button className="btn big" data-testid="back-to-menu" onClick={onExit}>Back to menu</button>
          </div>
          {details}
        </div>
      </div>
    )
  }

  const serverWantsAccount = copy.layout === 'server-wants-account'
  return (
    <div className="overlay solid scroll">
      <div className="disconnect-card guided" data-testid="disconnected" data-kind={info.kind ?? 'other'}>
        <div className="dc-icon kick"><Icon name="shield" size={30} /></div>
        <h2>{copy.title}</h2>
        <p className="dc-reason" data-testid="disconnect-reason">{info.reason}</p>
        {copy.more && <p className="dc-more">{copy.more}</p>}
        <div className="dc-server">{serverLine} · tried as {identity}</div>

        <div className="dc-options">
          <section className="dc-option">
            <h3><Icon name="ms" size={16} />{serverWantsAccount ? 'I have an account that owns Java Edition' : info.kind === 'ms-xbox' ? 'Fix the account, or use another one' : 'Use a different Microsoft account'}</h3>
            {serverWantsAccount
              ? <p>Sign in with Microsoft and join as that account. You enter a short code on microsoft.com in your own browser; Vassago never sees your password.</p>
              : info.kind === 'ms-xbox'
                ? <p>Follow the instruction above for this account and try again — or sign out and sign in with a different Microsoft account.</p>
                : <p>If you signed in with the wrong account, sign out of it here and sign in with the one that owns Minecraft: Java Edition.</p>}
            <div className="dc-option-actions">
              {serverWantsAccount
                ? <button className="btn primary" data-testid="retry-microsoft" onClick={() => onRetryAs('microsoft')}><Icon name="ms" size={16} />Sign in with Microsoft</button>
                : <>
                  {info.kind === 'ms-xbox' && <button className="btn primary" data-testid="reconnect" onClick={onReconnect}><Icon name="refresh" size={16} />Try again</button>}
                  <button className={`btn ${info.kind === 'ms-xbox' ? '' : 'primary'}`} data-testid="retry-microsoft-fresh" onClick={() => onRetryAs('microsoft', true)}>Sign out and use another account</button>
                  </>}
            </div>
          </section>

          <section className="dc-option">
            <h3><Icon name="servers" size={16} />This is my own server</h3>
            <p>{serverWantsAccount
              ? 'You can let private-server profiles in by turning online mode off on the server:'
              : 'An online-mode server always needs an account that owns the game. On a server you run, you can turn online mode off and join with a private-server profile instead:'}</p>
            <OwnerSteps server={address} />
            <div className="dc-option-actions">
              {serverWantsAccount
                ? <button className="btn primary" data-testid="reconnect" onClick={onReconnect}><Icon name="refresh" size={16} />I’ve restarted the server — try again</button>
                : <button className="btn primary" data-testid="retry-offline" onClick={() => onRetryAs('offline')}><Icon name="user" size={16} />Join with a private-server profile</button>}
            </div>
          </section>
        </div>

        <div className="dc-actions">
          <button className="btn big" data-testid="back-to-menu" onClick={onExit}>Back to menu</button>
        </div>
        {details}
      </div>
    </div>
  )
}
