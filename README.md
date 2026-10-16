# Clickwise

Search Console intelligence: ranks SEO, AEO and GEO fixes by the clicks they could add.
Generic for any website — no site-specific logic.

## Files

| File | What it is |
|---|---|
| `index.html` + `landing.css` | Marketing site (hero, features, AI search, pricing, FAQ) |
| `app.html` | The audit tool |
| `styles.css` | Shared design tokens + app styles (light/dark) |
| `config.js` | **Edit this**: app name, Google OAuth client ID, row limits, utility-page hints |
| `engine.js` | Analysis engine (pure functions) |
| `filters.js` | Smart filters: validated filter specs, plain-English parser, safe text matching (pure functions) |
| `workflows.js` | One-click workflow templates and their runners (pure functions) |
| `views.js` | Report screens and shared table/chart helpers |
| `automation.js` | Smart filters, Workflows and workflow-result screens |
| `app.js` | Onboarding, file import, Google sign-in, API pulls, routing |
| `demo.js` | Sample data for a fictional site |
| `privacy.html`, `terms.html` | Needed for Google OAuth verification — review before launch |

## Try it locally

```
python3 -m http.server 8080
```
Open `http://localhost:8080` → "See it on sample data", or `app.html?demo`.

## Turn on "Connect Search Console"

1. Google Cloud Console → new project → enable **Google Search Console API**.
2. OAuth consent screen → External → add scope `.../auth/webmasters.readonly`, your domain, privacy and terms URLs.
3. Credentials → OAuth client ID → Web application → Authorized JavaScript origins: `http://localhost:8080` and your live domain.
4. Paste the client ID into `config.js` (`googleClientId`).
5. Until Google verifies the app, add testers under "Test users" (max 100). Submit for verification (`webmasters.readonly` is a sensitive scope: needs a demo video and a verified domain).

## Deploy

Any static host works: GitHub Pages, Netlify, Vercel, Cloudflare Pages. Use your own domain (Google won't verify a `github.io` origin for branding).

## Reports

- **Overview** — headline monthly click potential, non-brand KPIs vs previous period, top 3 actions, trend, brand split, sections
- **Action plan** — every recommendation ranked by clicks/month, printable
- **Almost page one** — non-brand queries at positions 4–20, gain if moved to top 3 / top 7
- **Titles to rewrite** — page-one pages/queries under benchmark CTR, with each page's top searches (API)
- **Competing pages** — exact query × page cannibalisation (API) or stem-based estimate (file)
- **Losing ground** — page/query decay vs previous period with likely cause; gaining pages
- **AEO & GEO signals** — AI Overview suspects, question/conversational/comparison/freshness queries, position-one holders, readiness score
- **Workflows** — one-click templates: quick wins, branded vs non-branded, positions 4–20, high-impression low-CTR pages, traffic declines, questions, page types, location keywords, cannibalisation candidates, internal-link targets, ignored searches, opportunity report. Each lists the data it needs, its thresholds and its output; saved per site in the browser
- **Smart filters** — type what you want in plain English (“blog pages that lost clicks”, “non-branded keywords ranking 5 to 15”). A deterministic parser turns it into a structured filter shown as removable chips; every value is validated and matched as plain text, never as a user-supplied pattern. Step-by-step builder for anything the parser misses; an optional Advanced panel shows how to recreate the filter in Search Console
- **Queries / Pages / Site sections / Search intent**

Old `#regex` links redirect to Smart filters.

## Tests

```
npm install                 # once: test tools only, nothing is needed to deploy
npx playwright install chromium   # once, if Chromium is not installed
npm test                    # = node tests/run.js  (unit, regression, browser)
npm run test:fast           # unit + regression only, no browser
```

- `tests/unit.test.js` — metrics, monthly scaling, brand matching, CTR calibration, outlier caps, results-page flags, de-duplication, sitelink and utility pages, parser, validation, special characters.
- `tests/regression.test.js` — an anonymised real 3-month export: site totals, coverage, non-brand figures and estimate sanity checks. The fixture holds a real site's numbers, so it is **gitignored** and the suite skips without it. Create one locally with `node tools/anonymize-export.js <export.xlsx> <brand> tests/fixtures/real-export-anon.json`.
- `tests/browser.test.js` — Playwright: every screen and workflow on sample data, mobile width, Excel and CSV upload, set-aside pages, print, CSV export safety, Forget this site.
- `tools/anonymize-export.js` turns any Performance export into a fixture (numbers kept; query words, URLs and brand replaced).

Scheduled workflows, email alerts and an AI fallback for the filter parser need the backend below; nothing in the app pretends otherwise.

## How estimates work

All opportunity figures are clicks per month, shown as a low–high range. Expected CTR at each position is the site's own median CTR where it has at least 30 non-branded queries, and an industry benchmark elsewhere (never higher than the position above). A query keeps its own click rate relative to its position, so searches answered on the results page are not projected to a full top-3 CTR, and are flagged. No single query may contribute more than 10% of a list. The headline counts each query once; page estimates overlap query estimates and are never added to it. Pages that look like branded sitelinks or utility pages are set aside with the reason, and users can include them again.

## Roadmap (paid tier)

Backend (e.g. Next.js + Supabase) for refresh tokens and daily sync → history beyond 16 months, weekly email digest, GA4 join, multi-property, team seats, white-label PDF, billing (Razorpay / Stripe).
