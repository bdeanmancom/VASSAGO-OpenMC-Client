import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './styles.css'

window.addEventListener('error', e => window.vassago?.app.log('error', `window error: ${e.message}`, { file: e.filename, line: e.lineno }))
window.addEventListener('unhandledrejection', e => window.vassago?.app.log('warn', `unhandled rejection: ${String((e.reason as any)?.stack ?? e.reason)}`))

createRoot(document.getElementById('root')!).render(<App />)
