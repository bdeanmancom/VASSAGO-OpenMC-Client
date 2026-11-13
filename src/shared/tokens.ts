/** Keys under which Microsoft sign-in tokens are kept in the secure store: "msa:<account>:<cache>". */
export function tokenKey (account: string, cacheName: string): string {
  return `msa:${account}:${cacheName}`
}

/** The account a stored token key belongs to, or null for any other key. Cache names never contain a colon. */
export function accountOfTokenKey (key: string): string | null {
  const m = /^msa:(.*):[^:]*$/s.exec(key)
  return m ? m[1] : null
}

/** Accounts with stored tokens that are not among the listed ones. */
export function orphanedAccounts (keys: Iterable<string>, listed: Iterable<string>): string[] {
  const keep = new Set(listed)
  const found = new Set<string>()
  for (const key of keys) {
    const account = accountOfTokenKey(key)
    if (account !== null && !keep.has(account)) found.add(account)
  }
  return [...found]
}
