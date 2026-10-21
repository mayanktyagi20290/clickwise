# Clickwise — project context

Search Console intelligence SaaS by Mayank. Turns Google Search Console data into a ranked list of SEO, AEO and GEO fixes, each with an estimated clicks-per-month gain.

## Links
- Live site: https://mayanktyagi20290.github.io/clickwise/
- Audit tool (sample data): https://mayanktyagi20290.github.io/clickwise/app.html?demo
- Repo: https://github.com/mayanktyagi20290/clickwise (branch `main`, GitHub Pages from root)
- Origin: generic rebuild of the internal GSC dashboard (gsc-dashboard repo, `original.html`). All Unstop-specific logic removed.

## Stack
Static site, no backend yet. Vanilla JS + Chart.js + SheetJS from cdnjs, Inter font.
- `index.html` + `landing.css` — marketing site (hero with live engine output, features, AI search, pricing, FAQ)
- `app.html` — audit tool; `app.js` (onboarding, file import, Google sign-in via Google Identity Services, API pulls with pagination, routing), `engine.js` (analysis, pure functions), `forecast.js` (growth forecast and target), `explain.js` (action explanations), `filters.js` (smart filters + plain-English parser), `workflows.js` (workflow templates + runners), `views.js` (screens + table/chart helpers), `automation.js` (Smart filters, Workflows, workflow results), `demo.js` (sample site trailcraft.co), `config.js` (app name, OAuth client ID, row limits)
- `styles.css` — shared tokens and app styles; assets versioned with `?v=N` to bust cache
- `privacy.html`, `terms.html` — needed for Google OAuth verification

## Reports in the audit tool
Overview (headline clicks-to-gain, gradient KPI tiles, Day/Week/Month trend, going well / needs attention / opportunities, top 3 actions, position distribution, CTR by position vs benchmark, top queries and pages, site sections, branded split, anonymous-query share, indexing checklist) · Action plan · Almost page one · Titles to rewrite · Competing pages (exact query×page via API, stem estimate for file uploads) · Losing ground (vs previous period, with likely cause) · AEO & GEO signals (AI Overview, AI Mode, zero-click pages, vs expected, GEO readiness, question / conversational / comparison / freshness / position-one lists) · Queries · Pages (relative tiers) · Site sections (click any folder for a deep dive: sub-folders, URLs, queries, folder-level fixes) · Search intent · Workflows (12 one-click templates, saved per site) · Smart filters (plain English → validated filter chips, step-by-step builder, optional Search Console recipe under Advanced).

Navigation: Dashboard · SEO opportunities (Action plan, Almost page one, Titles to rewrite, Competing pages, Losing ground) · Automation (Workflows, Smart filters) · AI search visibility · Explore (Queries, Pages, Site sections, Search intent) · Settings (brand names, ignored searches, excluded pages).

Data sources: upload of the GSC Performance Excel export, Google sign-in (webmasters.readonly; search type and device filters; compare period), or sample data. Brand terms guessed from the domain, with misspelling suggestions; stored per site in the browser.

## Design decisions
- Product principle: users choose the outcome, Clickwise does the technical work. No user-facing regex; the old Regex library was replaced by Smart filters + Workflows (old `#regex` links redirect).
- Filters are data, never code: parser output is a JSON spec checked by `validate()` before running; text values are matched as plain strings (escaped when used inside internal matchers). Any future AI parsing must emit the same spec and pass the same validation.
- Only working features appear in the UI: no schedule buttons until the backend exists.
- Estimates (since the Oct 2026 audit): clicks per month, low–high ranges; site's own CTR curve (≥30 queries per position) with benchmark fallback; per-query ratio keeps answer-box searches from inflating gains; 10% cap per row; headline counts each query once, page estimates never added. Likely sitelinks and utility URLs set aside with reason + Include override. Dashboard tiles are site totals from daily data; coverage of query/page rows shown; "not represented in this export" replaces "anonymous" for uploads.
- Command Center v2 (Oct 2026): Do today and Growth target above the fold; forecast.js keeps observed / target / opportunity / forecast apart, counts each click once and excludes non-recoverable declines; explain.js gives why/evidence/affected/steps per action; tasks and fixes share one change log; Priorities has an impact × effort matrix; visual direction from the user's reference screenshots (priority bars, KPI tiles, kanban cards).
- UI redesign (Oct 2026, from the user's reference screenshot): white cards on cool-grey, indigo accent; sidebar with logo mark and coloured counts; top bar with connection status, print icon and Ask Clickwise; heading with Top priority for today; KPI cards with sparklines; trend chart with metric tabs and previous-period line; Growth target ring; opportunities table with filter chips; Active tasks; Quick insights; Recent changes & impact; Top winning pages. Presentation only.
- Tests: `npm test` (unit, regression on anonymised real export, Playwright browser). Audit doc: "Clickwise — Application Audit (Oct 2026)".
- Look follows the SemanticsX GSC Audit style the user liked: indigo/slate palette, white rounded cards, gradient KPI tiles, collapsible icon cards with count pills, control bar with date pill. Style patterns only — no logos, names or copy taken.
- Compact type scale (14px base) — user found earlier version too large.
- Features borrowed from SEOSignalX GSC Insights: position distribution, CTR by position, top keywords/pages, anonymous queries, search type and device filters.

## Market and positioning
Competitors on GSC data: SEO Gets ($0/$39/$49, unlimited sites; striking distance, brand split, decay, content groups), SEOTesting ($50–$375; testing, cannibalisation, long history), SEOTalos, SEO Stack, Looker Studio/BigQuery (free, DIY). Quick wins, brand split, cannibalisation and decay are not unique.

Differentiators to build before charging:
1. "Fix-ready" output — AI title/meta rewrites from each page's real GSC queries with CTR gain; one-click briefs for almost-page-one queries; 40–60 word answer drafts for AI Overview queries. Pitch: "Search Console tells you what happened. Clickwise writes the fix."
2. India pricing and agencies — ₹799–1,499/month via Razorpay, white-label PDF, boss-ready summaries.
3. Weekly "what changed" alerts by email or WhatsApp.
Plan: launch free as a lead magnet now; paid tier once #1 and #3 exist (needs a small backend holding the Claude API key, refresh tokens and daily sync).

## To do
- Create Google OAuth client, add `https://mayanktyagi20290.github.io` as an authorized origin, paste ID into `config.js`; later move to an own domain and submit for verification (sensitive scope).
- Replace placeholders: `hello@clickwise.example`, canonical URL, final product name.
- Check the Unstop employment agreement on side projects/IP before launch.
- Backend roadmap: refresh tokens + daily sync (history beyond 16 months), alerts, GA4 join, multi-property, team seats, billing.
