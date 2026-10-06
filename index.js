// dsh-copilot-quota — server half.
//
// Serves the GitHub Copilot quota that the dsh-oauth-copilot grant unlocks:
//
//   GET /copilot-quota/api            -> cached quota JSON
//   GET /copilot-quota/api?refresh=1  -> bypass the cache
//
// The grant itself never leaves the harness: the record is read through
// ctx.credentials and only the derived numbers are sent to the browser.

export const name = 'copilot-quota'
export const inject = ['webServer', 'credentials']

const RECORD_KEY = 'llm-pi-ai/github-copilot'
const USER_URL = 'https://api.github.com/copilot_internal/user'
const FETCH_TIMEOUT_MS = 15000
const DEFAULT_CACHE_MS = 300000

const BUCKET_TITLES = {
  chat: 'Чат',
  completions: 'Автодополнение',
  premium_interactions: 'Premium-запросы (AI credits)',
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Normalize the two shapes GitHub returns: `quota_snapshots` (current accounts)
 * and `monthly_quotas` + `limited_user_quotas` (older ones).
 */
function normalize(raw) {
  const buckets = []
  const seen = new Set()

  const push = (id, bucket) => {
    if (bucket === null || typeof bucket !== 'object' || seen.has(id)) return
    seen.add(id)
    const entitlement = num(bucket.entitlement)
    const remaining = num(bucket.remaining)
    const unlimited = bucket.unlimited === true
    // A 0-of-0 bucket carries no information: a Free plan simply has no credit
    // pool, and rendering it would suggest a meter that does not exist.
    if (!unlimited && entitlement === 0 && remaining === 0) return
    const percent = num(bucket.percent_remaining)
    buckets.push({
      id,
      title: BUCKET_TITLES[id] ?? id,
      entitlement,
      remaining,
      unlimited,
      percentRemaining:
        percent ?? (entitlement !== undefined && entitlement > 0 && remaining !== undefined ? (remaining / entitlement) * 100 : undefined),
      overageCount: num(bucket.overage_count),
      creditsUsed: num(bucket.credits_used),
    })
  }

  const snapshots = raw.quota_snapshots
  if (snapshots !== null && typeof snapshots === 'object') {
    for (const [id, bucket] of Object.entries(snapshots)) push(id, bucket)
  }

  const totals = raw.monthly_quotas
  const left = raw.limited_user_quotas
  if (totals !== null && typeof totals === 'object') {
    for (const id of new Set([...Object.keys(totals), ...Object.keys(left ?? {})])) {
      push(id, { entitlement: totals[id], remaining: left?.[id] })
    }
  }

  return {
    login: raw.login,
    plan: raw.copilot_plan,
    sku: raw.access_type_sku,
    chatEnabled: raw.chat_enabled,
    resetDate: raw.quota_reset_date ?? raw.limited_user_reset_date,
    buckets,
  }
}

async function fetchQuota(ctx) {
  const record = await ctx.credentials.readRecord(RECORD_KEY)
  if (record === undefined || record === null || record.kind !== 'grant') {
    return { ok: true, signedIn: false, fetchedAt: Date.now() }
  }

  const payload = record.payload ?? {}
  const candidates = [
    ['github', payload.refresh],
    ['copilot', payload.access],
  ].filter(([, token]) => typeof token === 'string' && token.length > 0)

  let lastError = 'в записи нет ни refresh, ни access — выполните logout и login заново'

  for (const [source, token] of candidates) {
    let response
    try {
      response = await fetch(USER_URL, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          'User-Agent': 'GitHubCopilotChat/0.35.0',
          'Editor-Version': 'vscode/1.107.0',
          'Editor-Plugin-Version': 'copilot-chat/0.35.0',
          'X-GitHub-Api-Version': '2025-04-01',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = 'сеть: ' + String(error?.cause ?? error)
      continue
    }

    const text = await response.text()
    if (!response.ok) {
      lastError = 'HTTP ' + response.status + ' ' + response.statusText + ': ' + text.slice(0, 200)
      continue
    }

    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      lastError = 'ответ не является JSON'
      continue
    }

    return { ok: true, signedIn: true, source, fetchedAt: Date.now(), error: null, ...normalize(raw) }
  }

  return { ok: true, signedIn: true, fetchedAt: Date.now(), error: lastError, buckets: [] }
}

export function apply(ctx, config = {}) {
  const configured = Number(config?.cacheMs)
  const cacheMs = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CACHE_MS

  /** @type {{ at: number, data: object } | undefined} */
  let cache
  let inflight

  const load = (force) => {
    if (!force && cache !== undefined && Date.now() - cache.at < cacheMs) {
      return Promise.resolve({ ...cache.data, cached: true })
    }
    if (inflight !== undefined) return inflight
    inflight = fetchQuota(ctx)
      .then((data) => {
        cache = { at: Date.now(), data }
        return { ...data, cached: false }
      })
      .catch((error) => {
        // Keep showing the last good reading rather than blanking the badge.
        if (cache !== undefined) return { ...cache.data, cached: true, stale: true, error: String(error?.message ?? error) }
        return { ok: false, signedIn: false, error: String(error?.message ?? error) }
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: '/copilot-quota',
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(body))
      }
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname !== '/copilot-quota/api') {
        send(404, { ok: false, error: 'not-found' })
        return
      }
      try {
        send(200, await load(url.searchParams.get('refresh') === '1'))
      } catch (error) {
        send(500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}
