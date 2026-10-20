# Private homepage analytics

Cloudflare Workers + D1; the homepage stays on GitHub Pages. `public/visitor.js` in the repository root sends pageview events only on `lingyao-kong.github.io`.

## Owner use

Dashboard: https://lingyao-visitor-stats.lingyao-visitor-analytics.workers.dev/

Additional free Pages entry: https://lingyao-visitor-stats.pages.dev/ . It uses a service binding to the same Worker, so it shares the database and administration key. Browsers connect to `pages.dev`; this is not a redirect to `workers.dev`. Reachability still depends on the visitor's network and must be tested from an affected device before changing the homepage's collector URL.

Additional Deno entry: https://visitor-stats.lingyao-kong.deno.net/ . It forwards only the dashboard's fixed routes to the existing Worker, preserving its D1 history, collector origin checks, signed sessions and rate limits. The `lingyao-kong` organization uses the free plan. Both Cloudflare default domains failed the owner's phone-network test; the Deno entry has passed desktop browser and API checks, but its phone-network test is pending. The homepage collector stays unchanged until that test succeeds.

The Deno entry does not need a database secret or administrator key in its deployment. Requests through it leave country blank because Cloudflare sees the relay server's location. Device, browser, source and visit time remain available. IP-based rate limits apply to the Deno egress address, so many simultaneous visitors may share a limit; visitor-ID throttles still apply separately. Platform quotas and network availability remain relevant.

Open the deployed Worker's URL and enter the administration key from the private local file on the owner's desktop. The key is stored as the `ADMIN_KEY` Worker secret; it is never embedded in the tracker, dashboard source or Git repository. Login lasts seven days and uses a Secure, HttpOnly, SameSite=Strict HMAC-signed cookie. Rotate the key with `wrangler secret put ADMIN_KEY`; existing sessions then become invalid.

The dashboard defaults to **all history**, supports inclusive date ranges in Asia/Shanghai, lists individual pageviews and exports the selected range as UTF-8 CSV. CSV export follows cursor pagination until every matching row has been downloaded, rather than exporting only the visible page.

## Retention and collection

There is no TTL, scheduled cleanup, or automatic deletion. Rows persist until deliberately deleted or the database/account is removed. Free-tier storage and daily quotas still apply (at setup: 500 MB per D1 database). Export backups regularly. Platform recovery windows are separate from live data retention.

Each visit records a random pageview ID, pseudonymous browser visitor ID, server arrival time, page pathname, referring hostname, coarse country, device/browser category and best-effort foreground duration. Raw IPs, exact user agents, query strings, fragments and names are not stored in the database. The visitor ID is kept in localStorage, so clearing browser storage or changing device produces a new visitor. Global Privacy Control requests are honored. Unknown/withheld referrers are shown as direct/unknown. Initial collection can be blocked by privacy tools or network failures. This service cannot recover traffic from before installation or promise to capture every visit.

Duration heartbeats and pagehide updates use the same pageview ID and update only the maximum duration; they do not add pageviews. Client-side path navigation is tracked. Login and collection have rate limits. Origin checks reduce casual cross-site submissions but are not proof of a human visitor; submitted pageviews should be treated as approximate telemetry.

## Development and deployment

Use a current Node.js release and Wrangler 4. From this directory:

```sh
node --test test/*.test.mjs
npx wrangler d1 migrations apply lingyao-visitor-history --local
npx wrangler dev
```

For local login, keep `ADMIN_KEY="a-random-key-with-at-least-32-characters"` in the Git-ignored `.dev.vars`. Local preview data is separate from production.

```sh
npx wrangler login
npx wrangler d1 migrations apply lingyao-visitor-history --remote
npx wrangler deploy
npx wrangler secret put ADMIN_KEY
```

The Worker and GitHub Pages deploy separately. Changes to the Worker require `wrangler deploy`; homepage changes use the existing GitHub Actions workflow. No paid plan, card, domain purchase, or automatic billing upgrade is required by this setup.

To redeploy the optional Pages gateway, run from this directory:

```sh
node pages/build.mjs
cd pages
npx wrangler pages deploy --project-name lingyao-visitor-stats --branch main
```

The Pages project already exists. Its build output is Git-ignored and contains only the forwarding Worker and a static failure message. It receives no administration secret or database credentials; existing Worker authentication and throttling remain in effect.

To redeploy the Deno entry, authenticate with a short-lived token using the official CLI's `DENO_DEPLOY_TOKEN` environment variable, then run from `relay/`:

```sh
deno run -A jsr:@deno/deploy . --org lingyao-kong --app visitor-stats --prod --non-interactive
```

Use only `relay/` as the upload root. Never upload the surrounding analytics directory, `.dev.vars`, or desktop credentials. The Deno CLI stores the public organization and app names in `relay/deno.json`. Its production entrypoint is `main.mjs` with a dynamic runtime. The gateway asks its upstream for identity encoding and removes upstream compression and connection metadata, so fetch decompression cannot corrupt downstream pages. Browser state-changing API calls must match the relay's own Origin before it translates that Origin for the Worker.

## Complete database backup

The dashboard CSV contains visit records. For a complete SQL database backup, run:

```sh
npx wrangler d1 export lingyao-visitor-history --remote --output /absolute/private/path/visitor-history.sql
```

Store exports outside the public repository and keep a second copy. Restore into a separate D1 database first and verify its row count before changing production. Consult Cloudflare's current quotas before large exports or queries.
