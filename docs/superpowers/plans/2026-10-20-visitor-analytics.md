# Private visitor analytics implementation plan

**Goal:** Retain successfully collected homepage visits without automatic expiry and let the owner query and export history using Cloudflare's free Workers and D1 tiers.

**Architecture:** GitHub Pages sends anonymous pageview events to a separate Worker. D1 stores one row per pageview with a pseudonymous visitor ID, server timestamp, source, page, approximate country and device. The Worker serves a private dashboard whose data endpoints require an HttpOnly signed session cookie. No raw IP addresses, visitor names or page query strings are stored.

**Tech stack:** Workers ES modules, D1/SQLite, static HTML/CSS/JS, Node's test runner, Wrangler.

- [x] Check Wrangler authentication; let the user complete Cloudflare login and authorization.
- [x] Add tests for origin checks, input validation, private API authorization, cookie integrity/expiry and idempotent collection.
- [x] Implement Worker, indexed SQL schema, authenticated dashboard, CSV and full database export instructions.
- [x] Add a tracker supporting initial pageviews, client-side navigation and best-effort active duration; local previews are excluded.
- [x] Test against a local D1 database and check the Next.js production build.
- [x] Create the free D1 database and Worker; store the administration key as a Worker secret and in a private local owner file outside Git.
- [x] Configure the live collection URL, deploy GitHub Pages, and verify collection, authorization, filtering and CSV export.

The design was approved in chat when the user selected Cloudflare's free tier and authorized implementation and deployment. Existing Clarity integration and unrelated local changes are preserved. There is no automatic deletion job. Free quotas, blocked browser requests, unavailable referrers and anonymous visitor IDs remain practical limitations; no claim of complete capture or permanent free capacity is made.

## Verification

- 15 Node tests passed, including SQLite retention/idempotency tests, signed-cookie authorization, bounded scans during a 100,000-row export, trusted-IP throttling and browser navigation/foreground duration.
- Next.js production build, type/lint checks and all static page exports passed.
- Independent code review findings were reproduced and fixed: bounded keyset scans, IP throttling independent of visitor IDs, and applied date ranges preserved during pagination.
- GitHub Pages run 39437316815 succeeded for implementation commit 9a782a3.
- Live homepage collection returned HTTP 204. A real homepage-to-publications navigation created two pageviews for one anonymous visitor, with the default English/light theme preserved.
- Production dashboard login, all-history display and CSV export of those two verification records succeeded. Unauthenticated data requests returned HTTP 401.
- Administration credentials are stored outside Git; no paid plan was enabled.
