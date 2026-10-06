# dsh-copilot-quota

GitHub Copilot quota indicator for the [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) web GUI.

DeepSeek Harness has no Copilot quota surface of its own: the
[`dsh-oauth-copilot`](https://www.npmjs.com/package/dsh-oauth-copilot) plugin stores the grant and the
account-enabled model list, and the harness only reacts once a limit is already exhausted (a
`QUOTA` / `RATE_LIMIT` failure notice). This plugin fills the gap with a live badge in the composer
row, next to the send button.

```
Copilot 200/200      ← green dot, click to refresh
```

## What it shows

| Element | Meaning |
|---|---|
| Dot | Worst remaining percentage across the metered buckets: green, amber at ≤ 40 %, red at ≤ 15 % |
| Number | The `chat` bucket as `remaining/total` (falls back to the first metered bucket) |
| Hover | Login, plan and SKU, every bucket, the quota reset date and the time of the last refresh |
| Click | Force a refresh, bypassing the server cache |

The badge is hidden entirely when no Copilot grant exists, so it never claims a meter that is not there.
Buckets that report `0 of 0` are dropped for the same reason — a free plan has no AI-credit pool.

## Requirements

- DeepSeek Harness `>= 0.1.0-rc.6 < 0.3.0`, profile `web` (verified on `0.2.0-rc.2`).
- A signed-in Copilot grant:
  ```sh
  npx -y dsh-oauth-copilot login
  ```
  Sign-in is a human-only terminal operation by design; see that package's README.
- github.com only — GitHub Enterprise is not supported, matching `dsh-oauth-copilot`.

## Install

From GitHub (no clone or build step):

```sh
dsh plugin --profile web add github:vowa-antilamer/dsh-copilot-quota
```

From a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-copilot-quota
```

A live profile recomposes itself (the server half starts serving immediately and the client bundle
starts being served); **reload the browser page** to load the client module. Restart `dsh web` only if
the badge does not appear after a reload.

Remove:

```sh
dsh plugin --profile web remove dsh-copilot-quota
```

## Configuration

Optional entry config (profile patch or the plugin row in the GUI):

```yaml
- id: copilot-quota
  config:
    cacheMs: 300000   # GitHub response cache, ms (0 disables caching)
```

## How it works

| Half | File | Responsibility |
|---|---|---|
| Server | `index.js` | Reads the `llm-pi-ai/github-copilot` record through `ctx.credentials`, calls GitHub, serves `GET /copilot-quota/api` |
| Client | `client.js` | Slot `conversation.input.right`; polls the route every 2 minutes and on window focus |

The server half asks the same client endpoint VS Code uses:

```
GET https://api.github.com/copilot_internal/user
Authorization: Bearer <token>
```

Both response shapes are supported: `quota_snapshots` (current accounts) and `monthly_quotas` +
`limited_user_quotas` (older ones). The answer is cached server-side (5 minutes by default) and the
last good reading is kept on screen if a refresh fails.

**Tokens never reach the browser.** The grant stays in the harness credential store; only derived
numbers cross the route. The badge talks to the same origin that served the page (`/copilot-quota/api`).

## Verify without the GUI

```sh
curl http://127.0.0.1:3080/copilot-quota/api
```

## Limitations

- `copilot_internal/user` is not a public GitHub API. If GitHub changes the response shape, the badge
  reports the error in its tooltip instead of breaking the UI.
- GitHub Enterprise is unsupported (the grant whitelist in `dsh-oauth-copilot` accepts only the
  official `proxy.individual.githubcopilot.com` endpoint).
- The badge reflects the signed-in account, not the model currently selected: it is the account's
  quota, visible with any model.
- Quota is refetched on a timer, so the number lags real usage by up to the cache window.

## License

MIT — see [LICENSE](LICENSE).

Русская версия: [README.ru.md](README.ru.md).
