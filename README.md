# Clickwise

Search Console intelligence: ranks SEO, AEO and GEO fixes by the clicks they could add.
Generic for any website — no site-specific logic.

## Files

| File | What it is |
|---|---|
| `index.html` + `landing.css` | Marketing site (hero, features, AI search, pricing, FAQ) |
| `app.html` | The audit tool |
| `styles.css` | Shared design tokens + app styles (light/dark) |
| `config.js` | **Edit this**: app name, Google OAuth client ID, row limits |
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

No build step. The checks used during development are plain Node scripts (parser and filter unit tests, plus a Playwright smoke test that opens every screen on sample data). Scheduled workflows, email alerts and an AI fallback for the filter parser need the backend below; nothing in the app pretends otherwise.

## Roadmap (paid tier)

Backend (e.g. Next.js + Supabase) for refresh tokens and daily sync → history beyond 16 months, weekly email digest, GA4 join, multi-property, team seats, white-label PDF, billing (Razorpay / Stripe).
