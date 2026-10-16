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
| `content.js` | Content assistant: topic clusters, content gaps, page improvements, internal links, crawler link exports, briefs (pure functions) |
| `content-view.js` | Content & links screen |
| `opportunities.js` | Opportunity engine: one ranked list with evidence, impact, confidence, effort and warnings (pure functions) |
| `filters.js` | Goal builder engine: validated filter specs, plain-English parser with clarifying questions and data checks, safe text matching (pure functions) |
| `workflows.js` | One-click workflow templates and their runners (pure functions) |
| `views.js` | Report screens and shared table/chart helpers |
| `automation.js` | Goal builder, Workflows and workflow-result screens |
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

## Analysing one folder or page

With Search Console connected, type a folder (`/blog/`) or a full URL in **Only a folder or page** on the property screen; tick **Exactly this page** for a single URL. Clickwise sends Google a page filter (built and escaped by the app), so every query, page, daily total and comparison covers only that part of the site. For uploads, set the Page filter in Search Console before exporting; Clickwise reads the export's Filters sheet and shows the scope in the top bar.

## Reports

- **Overview** — headline monthly click potential, non-brand KPIs vs previous period, top 3 actions, trend, brand split, sections
- **All opportunities** — every recommendation in one ranked list: the search or page, what was measured (and against which period), why it was picked, an estimated impact range, a confidence level with every reason behind it, the suggested action and its effort, and data warnings. Filter by type, confidence, effort and impact; export to CSV
- **Content & links** — topics (searches grouped by shared words and, with Search Console connected, by the page they rank with), content gaps (topics with enough impressions where nothing reaches page one, only the homepage ranks, impressions are split across pages about the topic or between the matching page and unrelated ones, or question searches go unanswered), pages to improve (searches each page ranks 4–20 for), internal links (sources already rank on page one for the same topic; anchor text is the target's own search) and briefs drafted by fixed rules from real searches. Upload a crawler's link export (Screaming Frog All Inlinks, or any CSV with source and destination columns) to drop links that already exist; it stays in memory. Nothing is invented: every URL, search and number comes from the data, and impressions are the site's own, not market demand. Without query-page data (an export) it falls back to searches alone and folder-based link sources, and says so
- **Action plan** — every recommendation ranked by clicks/month, printable
- **Almost page one** — non-brand queries at positions 4–20, gain if moved to top 3 / top 7
- **Titles to rewrite** — page-one pages/queries under benchmark CTR, with each page's top searches (API)
- **Competing pages** — exact query × page cannibalisation (API) or stem-based estimate (file)
- **Losing ground** — page/query decay vs previous period with likely cause; gaining pages. Works with Search Console connected, with an Excel export made using Date › Compare, or with two exports (this period and the previous one) uploaded together
- **AEO & GEO signals** — AI Overview suspects, question/conversational/comparison/freshness queries, position-one holders, readiness score
- **Workflows** — one-click templates: quick wins, branded vs non-branded, positions 4–20, high-impression low-CTR pages, traffic declines, questions, page types, location keywords, cannibalisation candidates, internal-link targets, ignored searches, opportunity report. Each lists the data it needs, its thresholds and its output; saved per site in the browser
- **Goal builder** (`#filters`) — describe an SEO task in plain English (“which pages should I fix first”, “quick wins in the blog folder”, “internship keywords in Delhi with more than 1,000 impressions and position 5 to 15”). A deterministic parser turns it into conditions shown as chips; click a chip to change it with normal controls, remove it, or add more. Opportunity goals (quick wins, titles to rewrite, competing pages, answer boxes, losing clicks, early warnings, confidence, estimated clicks a month, top N) use the opportunity engine, so numbers match All opportunities. When a request is ambiguous it asks a short question with one-click answers (a number with no metric, an unrecognised word, searches or pages); when the loaded data cannot answer part of it (one device, searchers' location, a different date range, a comparison period, which page ranks for a search) it says so and offers the alternative instead of dropping it silently. Contradictory conditions are refused. The preview shows the count, how each condition narrows the list, and the first 10 rows; **Run workflow** executes it and reports status; **Save workflow** keeps it under Workflows with its run history. Every text value is matched as plain text; an optional Advanced panel shows how to recreate the filter in Search Console
- **Queries / Pages / Site sections / Search intent**

Old `#regex` links redirect to the Goal builder.

## Tests

```
npm install                 # once: test tools only, nothing is needed to deploy
npx playwright install chromium   # once, if Chromium is not installed
npm test                    # = node tests/run.js  (unit, regression, browser)
npm run test:fast           # unit + regression only, no browser
```

- `tests/unit.test.js` — metrics, monthly scaling, brand matching, CTR calibration, outlier caps, results-page flags, de-duplication, sitelink and utility pages, parser, validation, special characters.
- `tests/opportunities.test.js` — opportunity engine: growth total equals the headline, each search counted once, recovery maths, confidence rules and determinism, period scaling, row-limit bounds, early warnings, ranking-page evidence, data warnings, empty data.
- `tests/goals.test.js` — Goal builder: supported requests (including the brief's example), opportunity goals matching the engine, clarifying questions, data the loaded analysis cannot answer, contradictions and invalid goals, literal text matching, preview vs run, run records, saved goals, comparison scaling.
- `tests/content.test.js` — content assistant: clustering rules, determinism and speed (100,000 searches), each gap rule, page improvements, link sources and anchors, no invented URLs or anchors, crawler exports (Screaming Frog, tab/semicolon, quotes, BOM, wrong files), export-only mode, briefs from real searches, totals unchanged, Goal builder and links workflow.
- `tests/regression.test.js` — an anonymised real 3-month export: site totals, coverage, non-brand figures and estimate sanity checks. The fixture holds a real site's numbers, so it is **gitignored** and the suite skips without it. Create one locally with `node tools/anonymize-export.js <export.xlsx> <brand> tests/fixtures/real-export-anon.json`.
- `tests/browser.test.js` — Playwright: every screen and workflow on sample data, mobile width, Excel and CSV upload, set-aside pages, print, CSV export safety, Forget this site.
- `tools/anonymize-export.js` turns any Performance export into a fixture (numbers kept; query words, URLs and brand replaced).

Scheduled workflows, email alerts and an AI fallback for the filter parser need the backend below; nothing in the app pretends otherwise.

## How estimates work

All opportunity figures are clicks per month, shown as a low–high range. Expected CTR at each position is the site's own impression-weighted CTR where it has at least 30 non-branded queries and 10 clicks (never below 20% of the benchmark), and an industry benchmark elsewhere (never higher than the position above). A query keeps its own click rate relative to its position, so searches answered on the results page are not projected to a full top-3 CTR, and are flagged. No single query may contribute more than 10% of a list. The headline counts each query once; page estimates overlap query estimates and are never added to it. Pages that look like branded sitelinks or utility pages are set aside with the reason, and users can include them again.

**Comparing periods.** When the previous period has a different length, its clicks and impressions are scaled to this period's length before comparing (CTR and position are rates and are not scaled). When a list reached its row limit (1,000 rows in an export), a page or search missing from it is not assumed to have zero clicks: it is counted at the smallest row in that list and marked "upper bound". Pages that lost a quarter of their clicks count as declining; smaller moves in position, impressions or CTR show as early warnings. Recovery estimates assume 30–80% of lost clicks return.

**Confidence.** Every opportunity starts at 50 and gains or loses points for fixed reasons, all shown next to it: days of data; how many clicks were expected at its position (≥100: +20, ≥30: +10, ≥10: 0, fewer: −15, because a CTR gap measured on a few clicks is mostly noise); whether expected CTR comes from the site's own clicks or a benchmark; a likely results-page feature; a capped estimate; for declines, whether the drop is larger than normal variation (about √n clicks), whether periods differ in length, and whether the current figure is only an upper bound. 70+ is High, 45–69 Medium, below 45 Low. Causes that are inferred rather than measured (an answer box or AI Overview guessed from CTR; competing pages guessed from wording) are capped at Medium and Low. The Quick wins workflow and the printed report use the same scores.

## Roadmap (paid tier)

Backend (e.g. Next.js + Supabase) for refresh tokens and daily sync → history beyond 16 months, weekly email digest, GA4 join, multi-property, team seats, white-label PDF, billing (Razorpay / Stripe).
