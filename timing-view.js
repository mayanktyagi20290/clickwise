// Clickwise Statistics & Trends › "Best day & time" tab (#stats?tab=timing). Google Search Console only.
// Daily history and page/search rows come from the Statistics & Trends loaders (stats-view.js); hourly rows from
// the Search Analytics API with dataState hourly_all (about the last 10 days, newest hours preliminary).
// An optional, opt-in archive keeps final hourly totals in this browser so hour-of-day patterns can build up
// beyond Search Console's 10 days. Calculations live in timing.js.
(function () {
  'use strict';
  const { esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, chart, cssVar, pctf, urlCell, serp } = ui;
  const T = window.CW_TIMING, ST = window.CW_STATS, CW = window.CW, fmtN = CW.fmtN;
  const SV = () => window.CW_STATSVIEW;
  const src = () => window.CW_SOURCE || { kind: 'file' };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('cw:' + k); } catch (e) { } }
  };
  const params = () => SV().params();
  const go = ch => { const p = params(); p.set('tab', 'timing'); Object.entries(ch).forEach(([k, v]) => v == null ? p.delete(k) : p.set(k, v)); location.hash = '#stats?' + p.toString(); };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();
  const pathOf = u => CW.pathOf(u);
  const hm = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dm = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const wdLong = d => T.WD[T.wdOf(d)];

  // ── hourly data ──
  function hourlyState(D) {
    const S = src();
    if (S.kind === 'demo') { const h = window.CW_SURF.demoHourly(D); return { status: 'done', data: { rows: h.rows, firstIncomplete: h.firstIncomplete, sample: true } }; }
    if (S.kind !== 'api') return { status: 'none' };
    const SURF = window.CW_SURF, tick = HOUR_TICK.get(D.site) || 0;
    return SV().load(SV().baseKey(D) + '|hourly|' + tick, () => S.gsc.query({ startDate: SURF.ptDate(-10), endDate: SURF.ptDate(0), dimensions: ['hour'], dataState: 'hourly_all', type: S.gsc.type, rowLimit: 500 })
      .then(d => ({ rows: (d.rows || []).map(r => ({ h: r.keys[0], clicks: r.clicks, impr: r.impressions, ctr: r.ctr * 100, pos: r.position })), firstIncomplete: (d.metadata || {}).first_incomplete_hour || (d.metadata || {}).firstIncompleteHour || null, requested: [SURF.ptDate(-10), SURF.ptDate(0)] })));
  }
  const HOUR_TICK = new Map();
  // date × page rows for the weekday window (top rows by clicks; capped)
  const DP_LIMIT = 50000;
  function datePages(D, start, end) {
    const S = src();
    if (S.kind !== 'api') return { status: 'none' };
    return SV().load(`${SV().baseKey(D)}|datepage|${start}|${end}`, async () => {
      const out = [];
      for (let startRow = 0; startRow < DP_LIMIT; startRow += 25000) {
        const d = await S.gsc.query({ startDate: start, endDate: end, dimensions: ['date', 'page'], type: S.gsc.type, rowLimit: 25000, startRow });
        const r = (d.rows || []).map(x => ({ d: x.keys[0], p: x.keys[1], clicks: x.clicks, impr: x.impressions, pos: x.position }));
        out.push(...r); if (r.length < 25000) return { rows: out, capped: false };
      }
      return { rows: out, capped: true };
    });
  }

  function render(A, D) {
    const S = src();
    const title = 'Statistics & Trends';
    const sub = 'When Google searchers find you: weekday patterns over recent weeks, recent hour-by-hour search performance, and the days, pages and searches that stood out.';
    const top = head(title, sub) + SV().tabs('timing');
    const H0 = SV().history(D);
    if (H0.status === 'loading') return { html: top + '<section class="panel"><p class="empty sv-loading">Fetching daily totals from Search Console…</p></section>' };
    if (H0.status === 'error') return { html: top + `<div class="note warn">Search Console did not return the daily history: ${esc(H0.err)}</div>` };
    const H = T.index(H0.data.rows);
    if (!H.first) return { html: top + '<section class="panel"><p class="empty">No daily data for this property and filter.</p></section>' };

    const p = params();
    const wks = [8, 12, 26, 52].includes(+p.get('weeks')) ? +p.get('weeks') : 12;
    // the weekday analysis uses 8–12 complete weeks; the calendar and trend charts follow the window chosen
    const WDY = T.weekdays(H, Math.min(12, Math.max(8, wks)));
    const idx = WDY.days.map(d => d.index);
    const W = T.weeks(H, wks);
    const calStart = W.start || H.first, calEnd = H.last;
    const cal = T.calendar(H, calStart, calEnd, idx);
    const anom = T.anomalies(cal), ext = T.extremes(cal, 5);
    const sample = S.kind === 'demo';

    // current vs previous 28 days (final data)
    const cur28 = ST.period(H, ST.add(H.last, -27), H.last), prev28s = ST.add(H.last, -55), prev28 = ST.covered(H, prev28s, ST.add(H.last, -28)) ? ST.period(H, prev28s, ST.add(H.last, -28)) : null;
    const d28 = ST.delta(cur28, prev28);
    // last 7 days vs the 28 days before, for recent spikes
    const r7s = ST.add(H.last, -6), b28e = ST.add(H.last, -7), b28s = ST.add(H.last, -34);

    // page and search rows
    const SVp = SV();
    const pCur = SVp.periodRows(D, 'page', cur28.start, cur28.end), pPrev = prev28 ? SVp.periodRows(D, 'page', prev28.start, prev28.end) : { status: 'none' };
    const qCur = SVp.periodRows(D, 'query', cur28.start, cur28.end), qPrev = prev28 ? SVp.periodRows(D, 'query', prev28.start, prev28.end) : { status: 'none' };
    const api = S.kind === 'api';
    const p7 = api ? SVp.periodRows(D, 'page', r7s, H.last) : { status: 'none' }, pB = api ? SVp.periodRows(D, 'page', b28s, b28e) : { status: 'none' };
    const q7 = api ? SVp.periodRows(D, 'query', r7s, H.last) : { status: 'none' }, qB = api ? SVp.periodRows(D, 'query', b28s, b28e) : { status: 'none' };
    const dp = WDY.start ? datePages(D, WDY.start, WDY.end) : { status: 'none' };
    const ok = x => x.status === 'done';
    // sample and uploads: page and search rows exist only for the loaded period (and its comparison)
    const fallbackRows = !api && D.P && D.P.length;
    const pagesNow = ok(pCur) ? pCur.data.rows : fallbackRows ? D.P : null, pagesBefore = ok(pPrev) ? pPrev.data.rows : !api && D.prevP ? D.prevP : null;
    const queriesNow = ok(qCur) ? qCur.data.rows : !api && D.Q ? D.Q : null, queriesBefore = ok(qPrev) ? qPrev.data.rows : !api && D.prevQ ? D.prevQ : null;
    const rowsPeriod = ok(pCur) ? `${SVp.rng(cur28.start, cur28.end)} vs ${SVp.rng(prev28.start, prev28.end)}` : fallbackRows ? `${SVp.rng(D.start, D.end)}${D.prevStart ? ' vs ' + SVp.rng(D.prevStart, D.prevEnd) : ''} (the loaded data)` : '';
    const movQ = queriesNow && queriesBefore ? ST.movers(queriesNow, queriesBefore, 'q', { n: 10, min: 3, curCapped: ok(qCur) && qCur.data.capped, baseCapped: ok(qPrev) && qPrev.data.capped }) : null;
    const low = pagesNow ? T.lowCtr(pagesNow, 12) : [];
    const ranks = pagesNow && pagesBefore ? T.rankMoves(pagesNow, pagesBefore, 10) : null;
    const spP = ok(p7) && ok(pB) ? T.spikes(p7.data.rows, pB.data.rows, 'p', 8) : null, spQ = ok(q7) && ok(qB) ? T.spikes(q7.data.rows, qB.data.rows, 'q', 8) : null;
    const byWd = ok(dp) ? T.pagesByWeekday(dp.data.rows, WDY, 5) : null;
    const incons = ok(dp) ? T.inconsistent(dp.data.rows, T.weeks(H, WDY.weeks), 50) : [];
    const loading = [pCur, pPrev, qCur, qPrev, p7, pB, q7, qB, dp].some(x => x.status === 'loading');
    const recs = T.recommendations({ anomalies: anom, spikesP: spP, lowCtr: low, inconsistent: incons, rankUp: ranks ? ranks.up : [], pathOf });

    // hourly
    const HS = hourlyState(D);
    let HR = null, hourNote = '', prof = null, arcDays = 0, arcOn = !!store.get('hourly-on:' + D.site);
    if (HS.status === 'done') {
      HR = T.hourly(HS.data.rows, HS.data.firstIncomplete);
      if (arcOn && !HS.data.sample && !HR.empty) { const merged = T.mergeArchive(store.get('hourly:' + D.site), HR); store.set('hourly:' + D.site, merged); }
      const arc = arcOn ? store.get('hourly:' + D.site) : null;
      arcDays = arc ? Math.floor(arc.length / 24) : 0;
      prof = !HR.empty ? T.hourProfile(arcDays >= 28 ? { rows: T.archiveRows(arc) } : HR, tz) : null;
    } else if (HS.status === 'error') hourNote = `Hourly data is not available for this property right now (${HS.err}). The weekday and daily analysis below still works.`;
    else if (HS.status === 'none') hourNote = 'Hourly data comes straight from the Search Console API, so it needs a connected property. This upload has daily data only; the weekday and daily analysis below uses it.';

    // ── coverage strip ──
    const cov = [
      `<b>${sample ? 'Sample data · fictional site' : S.kind === 'api' ? 'Live · Search Console (read-only)' : 'Uploaded export'}</b>${D.scope ? ` · ${esc(D.scope)}` : ''}`,
      `Daily history: ${SVp.rng(H.first, H.last)} (final data${S.latestKnown ? ', latest final day' : ''})`,
      `Weekday analysis: ${WDY.weeks ? `${WDY.weeks} complete weeks, ${SVp.rng(WDY.start, WDY.end)}` : 'not enough complete weeks'}`,
      HR && !HR.empty ? `Hourly: ${dm(HR.first)} ${hm(HR.first)} – ${dm(HR.last)} ${hm(HR.last)} (${Math.round(HR.days * 10) / 10} days${HR.prelimHours ? `, last ${HR.prelimHours} h preliminary` : ''})` : `Hourly: ${HS.status === 'loading' ? 'loading…' : 'not available'}`
    ];
    const warn = [];
    if (!WDY.enough) warn.push(`Only ${WDY.weeks} complete week${WDY.weeks === 1 ? '' : 's'} of daily data: weekday patterns need at least 8 weeks to be dependable.`);
    if (sample) warn.push('Sample data: daily history beyond the loaded 3 months and all hourly data are generated for the fictional site. None of it is real.');

    // ── Best day card ──
    const B = WDY.best, Wk = WDY.weakest;
    const verdict = !WDY.weeks ? 'Not enough complete weeks yet.'
      : WDY.verdict === 'few' ? `Too few weeks to name a best day; so far ${B.name} leads.`
      : WDY.verdict === 'flat' ? 'No weekday stands out: clicks are spread evenly across the week.'
      : WDY.verdict === 'clear' ? `${B.name} is consistently the strongest day.`
      : `No single clear best day: ${B.name} and ${B.runnerUp} are close.`;
    const bestCard = `<section class="panel tm-best"><div class="panel-h"><h2>Best day of the week</h2><p>From ${WDY.weeks} complete Monday–Sunday weeks. Each week is compared with itself (a day's share of that week), so growth, declines and one-off spikes do not decide the answer.</p></div>
      <div class="panel-b tm-best-b">
        <div class="tm-big"><span class="st-kl">Strongest</span><b>${WDY.weeks ? esc(B.name) : '—'}</b><small>${WDY.weeks ? `${Math.round((B.index - 1) * 100) >= 0 ? '+' : ''}${Math.round((B.index - 1) * 100)}% vs an average day · above average in ${B.above} of ${WDY.weeks} weeks · beat ${esc(B.runnerUp)} in ${B.beatsRunnerUp} of ${WDY.weeks}` : ''}</small></div>
        <div class="tm-big weak"><span class="st-kl">Weakest</span><b>${WDY.weeks ? esc(Wk.name) : '—'}</b><small>${WDY.weeks ? `${Math.round((Wk.index - 1) * 100)}% vs an average day · below average in ${Wk.below} of ${WDY.weeks} weeks` : ''}</small></div>
        <div class="tm-verdict"><p><b>${esc(verdict)}</b></p>
          ${WDY.strong.length ? `<p class="flat">Consistently strong (above average in 75%+ of weeks): ${esc(WDY.strong.join(', '))}.</p>` : ''}
          ${WDY.weak.length ? `<p class="flat">Consistently weak: ${esc(WDY.weak.join(', '))}.</p>` : ''}
          ${WDY.days.filter(d => d.spiky).length ? `<p class="flat">${esc(WDY.days.filter(d => d.spiky).map(d => d.name).join(', '))}: the average is lifted by a few unusual days (mean well above median), so medians are used.</p>` : ''}
          <p class="flat tm-disc">Search Console measures when people searched Google and clicked. These are search-demand patterns, not visitor or social-audience activity, and they do not show that publishing on a certain day changes rankings.</p></div>
      </div></section>`;
    const we = WDY.weekend;
    const weekendCard = WDY.weeks ? `<section class="panel"><div class="panel-h"><h2>Weekdays vs weekends</h2></div><div class="panel-b st-sms tm-we">
      <div class="st-sm"><span>Typical day, Mon–Fri (median clicks)</span><b>${fmtN(we.weekdayAvg)}</b></div><div class="st-sm"><span>Typical day, Sat–Sun (median clicks)</span><b>${fmtN(we.weekendAvg)}</b>${SVp.chg(we.diff, '%', false, 'Weekend vs weekday average')}</div>
      <div class="st-sm"><span>CTR, Mon–Fri / Sat–Sun</span><b>${pctf(we.weekdayCtr, 2)} / ${pctf(we.weekendCtr, 2)}</b></div><div class="st-sm"><span>Avg position, Mon–Fri / Sat–Sun</span><b>${we.weekdayPos != null ? we.weekdayPos.toFixed(1) : '—'} / ${we.weekendPos != null ? we.weekendPos.toFixed(1) : '—'}</b></div>
      <div class="st-sm"><span>Avg impressions, Mon–Fri / Sat–Sun</span><b>${fmtN(we.weekdayImpr)} / ${fmtN(we.weekendImpr)}</b></div></div></section>` : '';

    const wdCols = [
      { k: 'k', l: 'Weekday', f: r => `<b>${esc(r.name)}</b>${r.weekend ? ' <span class="tag">weekend</span>' : ''}`, csv: r => r.name },
      { k: 'avgClicks', l: 'Avg clicks', r: 1, f: r => fmtN(r.avgClicks) + (r.spiky ? ' <span class="tag watch" title="Mean far above median: lifted by unusual days">spiky</span>' : '') },
      { k: 'medianClicks', l: 'Median clicks', r: 1, f: r => fmtN(r.medianClicks) },
      { k: 'avgImpr', l: 'Avg impressions', r: 1, f: r => fmtN(r.avgImpr) },
      { k: 'ctr', l: 'CTR', r: 1, f: r => pctf(r.ctr, 2) },
      { k: 'pos', l: 'Avg position', r: 1, f: r => r.pos != null ? r.pos.toFixed(1) : '—' },
      { k: 'index', l: 'vs average day', r: 1, f: r => r.index == null ? '—' : `<b class="${r.index >= 1 ? 'gainv' : 'lossv'}">${r.index >= 1 ? '+' : ''}${Math.round((r.index - 1) * 100)}%</b>`, csv: r => r.index == null ? '' : ((r.index - 1) * 100).toFixed(1) + '%' },
      { k: 'above', l: 'Weeks above average', r: 1, f: r => `${r.above}/${r.n}` },
      { k: 'top', l: 'Best day of its week', r: 1, f: r => `${r.top}×` },
      { k: 'bottom', l: 'Worst day of its week', r: 1, f: r => `${r.bottom}×` }
    ];
    const wdHtml = WDY.weeks ? `<section class="panel"><div class="panel-h"><h2>Weekday performance</h2><p>Bars: average clicks; dots: median clicks (less affected by spikes). CTR = total clicks ÷ total impressions for that weekday; position weighted by impressions.</p></div>
      <div class="panel-b"><div class="chart-box st-cb"><canvas id="tm-ch-wd" aria-label="Clicks by weekday"></canvas></div></div>
      ${table('t-tm-wd', wdCols, WDY.days, { sort: 'k', dir: 1, file: 'weekday-performance', search: false, pageSize: 7 })}</section>` : '';

    // ── hourly ──
    let hourHtml;
    if (HS.status === 'loading') hourHtml = '<p class="empty sv-loading">Fetching hourly data from Search Console…</p>';
    else if (hourNote) hourHtml = `<p class="empty">${esc(hourNote)}</p>`;
    else if (!HR || HR.empty) hourHtml = '<p class="empty">Search Console returned no hourly rows for this property and filter.</p>';
    else {
      const L = window.CW_SURF.hourly(HS.data.rows, HS.data.firstIncomplete);
      const sum24 = !L.empty ? `<div class="st-sms tm-24"><div class="st-sm"><span>Clicks, last 24 h with data</span><b>${fmtN(L.tot.clicks)}</b>${L.prevTot ? SVp.chg(ST.pct(L.tot.clicks, L.prevTot.clicks), '%', false, 'vs the 24 hours before') : ''}</div><div class="st-sm"><span>Impressions</span><b>${fmtN(L.tot.impr)}</b>${L.prevTot ? SVp.chg(ST.pct(L.tot.impr, L.prevTot.impr), '%') : ''}</div><div class="st-sm"><span>CTR</span><b>${pctf(L.tot.ctr, 2)}</b></div><div class="st-sm"><span>Avg position</span><b>${L.tot.pos ? L.tot.pos.toFixed(1) : '—'}</b></div></div>` : '';
      hourHtml = `${sum24}
        <div class="chart-box st-cb"><canvas id="tm-ch-hours" aria-label="Clicks by hour over the available window"></canvas></div>
        <p class="flat">${HR.hours} hours from ${dm(HR.first)} ${hm(HR.first)} to ${dm(HR.last)} ${hm(HR.last)}, shown in your time zone (${esc(tz)}); Search Console reports hours in Pacific time.${HR.incomplete ? ` Hours from ${dm(HR.incomplete)} ${hm(HR.incomplete)} are <b>preliminary</b> (lighter) and can still change.` : ''} Search Console keeps hourly data for about the last 10 days only.</p>
        ${prof ? `<h3 class="st-h3">Hour of day${arcDays >= 28 ? ` (from ${arcDays} archived days)` : ` (from ${prof.days} day${prof.days === 1 ? '' : 's'} of final hours)`}</h3>
          <div class="chart-box sm"><canvas id="tm-ch-hod" aria-label="Average clicks by hour of day"></canvas></div>
          <p class="flat">${(() => { const m = new Date(HR.first).toLocaleTimeString('en-GB', { timeZone: tz, minute: '2-digit' }); return +m ? `Search Console hours are whole Pacific-time hours, which start at :${String(+m).padStart(2, '0')} in your time zone: “10” means 10:${String(+m).padStart(2, '0')}–11:${String(+m).padStart(2, '0')}. ` : ''; })()}${arcDays >= 28 ? 'Average final clicks for each hour across the archived days.' : `Based on only ${prof.days} day${prof.days === 1 ? '' : 's'}: this describes the days observed and is <b>not</b> a reliable long-term best hour. Weekdays and weekends usually differ, and a few days cannot separate them.`}</p>` : ''}
        ${!sample && S.kind === 'api' ? `<div class="tm-arc"><label class="check"><input type="checkbox" id="tm-arc" ${arcOn ? 'checked' : ''}> Keep final hourly totals in this browser so hour-of-day patterns can build up beyond 10 days</label>
          <p class="flat">${arcOn ? `${arcDays} day${arcDays === 1 ? '' : 's'} archived so far for ${esc(D.site)}. New hours are added each time you open this tab; gaps longer than 10 days between visits cannot be filled later. Site-level totals only (clicks, impressions, position per hour); no searches or pages. <button type="button" class="btn-link" id="tm-arc-clear">Delete archive</button>` : 'Off. When on, only site-level hourly totals are kept, in this browser, for this site; nothing is sent anywhere. A long-term hour-of-day view appears after 28 days. A scheduled server job would collect without gaps (needs a backend).'}</p></div>` : ''}`;
    }
    const hourPanel = `<section class="panel"><div class="panel-h"><h2>Recent hourly performance</h2>${S.kind === 'api' ? '<button type="button" class="btn-link" id="tm-h-refresh">Refresh</button>' : ''}<p>Hour-by-hour Google Search clicks and impressions from the Search Analytics API (hourly breakdown).</p></div><div class="panel-b">${hourHtml}</div></section>`;

    // ── calendar ──
    const calHtml = calendarHtml(cal, anom);
    const trendHtml = `<div class="grid-2 even st-charts">
      <section class="panel"><div class="panel-h"><h2>Weekly trend</h2><p>Monday–Sunday weeks; lighter bars are partial weeks.</p></div><div class="panel-b"><div class="chart-box st-cb"><canvas id="tm-ch-week" aria-label="Weekly clicks"></canvas></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Monthly trend</h2><p>Calendar months; lighter bars are partial months.</p></div><div class="panel-b"><div class="chart-box st-cb"><canvas id="tm-ch-month" aria-label="Monthly clicks"></canvas></div></div></section></div>`;
    const dateList = (l, cls) => `<ol class="tm-dates">${l.map(c => `<li><b>${SVp.fmtD(c.d)}</b> <span class="flat">${T.WDS[c.wd]}</span><span class="${cls}">${fmtN(c.clicks)}</span>${c.typical ? `<small class="flat">expected ~${fmtN(c.typical)}</small>` : ''}</li>`).join('')}</ol>`;
    const datesHtml = `<div class="grid-2 even">
      <section class="panel"><div class="panel-h"><h2>Best and weakest dates</h2><p>Within the calendar window.</p></div><div class="panel-b tm-ext"><div><h3 class="st-h3 gainv">Best</h3>${dateList(ext.best, 'gainv')}</div><div><h3 class="st-h3 lossv">Weakest</h3>${dateList(ext.weakest, 'lossv')}</div></div></section>
      <section class="panel"><div class="panel-h"><h2>Spikes and drops</h2><p>Days far from what their weekday and the surrounding days predict, so gradual trends are not flagged.</p></div><div class="panel-b">${anom.length ? `<ul class="tm-anom">${anom.slice(0, 8).map(a => `<li class="${a.kind}"><b>${SVp.fmtD(a.d)}</b> <span class="flat">${T.WD[a.wd]}</span> <span class="${a.kind === 'spike' ? 'gainv' : 'lossv'}">${a.kind === 'spike' ? 'Spike' : 'Drop'} ${a.vsTypical > 0 ? '+' : ''}${Math.round(a.vsTypical)}%</span><small class="flat">${fmtN(a.clicks)} clicks vs ~${fmtN(a.typical)} expected</small></li>`).join('')}</ul>` : '<p class="empty">No unusual days in this window.</p>'}</div></section></div>`;
    const cmpHtml = `<section class="panel"><div class="panel-h"><h2>Last 28 days vs the 28 before</h2><p>${SVp.rng(cur28.start, cur28.end)}${prev28 ? ` vs ${SVp.rng(prev28.start, prev28.end)}` : ' (no earlier 28 days in the history)'}.</p></div>
      <div class="panel-b st-sms tm-cmp"><div class="st-sm"><span>Clicks</span><b>${fmtN(cur28.clicks)}</b>${SVp.chg(d28 && d28.clicks, '%')}</div><div class="st-sm"><span>Impressions</span><b>${fmtN(cur28.impr)}</b>${SVp.chg(d28 && d28.impr, '%')}</div><div class="st-sm"><span>CTR</span><b>${pctf(cur28.ctr, 2)}</b>${SVp.chg(d28 && d28.ctr, 'pt')}</div><div class="st-sm"><span>Avg position</span><b>${cur28.pos != null ? cur28.pos.toFixed(1) : '—'}</b>${SVp.chg(d28 && d28.pos, 'pos', true)}</div></div></section>`;

    // ── pages and searches ──
    const rowsMsg = !pagesNow ? (loading ? '<p class="empty sv-loading">Fetching pages and searches…</p>' : '<p class="empty">Page and search data is not available for these dates.</p>') : '';
    const wdPages = byWd ? `<div class="tm-wdp">${byWd.map(w => `<div><h3 class="st-h3">${esc(w.name)}</h3>${w.top.length ? `<ol>${w.top.map(r => `<li>${urlCell(r.p, pathOf(r.p))}<span class="flat">${fmtN(r.avg)}/day</span></li>`).join('')}</ol>` : '<p class="flat">No data.</p>'}</div>`).join('')}</div><p class="flat">Average clicks per ${'occurrence of that weekday'} over the ${WDY.weeks} weeks${dp.data.capped ? '; from the top 50,000 date × page rows by clicks, so smaller pages may be missing' : ''}.</p>`
      : dp.status === 'loading' ? '<p class="empty sv-loading">Fetching clicks by date and page…</p>' : '<p class="empty">Clicks by weekday per page need a Search Console connection (date × page data).</p>';
    const mq = (list, cls) => list.length ? table(cls, [{ k: 'q', l: 'Search', cls: 'q', f: r => serp(r.q) }, { k: 'prev', l: 'Before', r: 1, f: r => fmtN(r.prev) }, { k: 'clicks', l: 'Now', r: 1, f: r => fmtN(r.clicks) }, { k: 'd', l: 'Change', r: 1, f: r => `<b class="${r.d >= 0 ? 'gainv' : 'lossv'}">${r.d > 0 ? '+' : ''}${fmtN(r.d)}</b>`, csv: r => r.d }, { k: 'why', l: 'What changed', sort: false, f: r => `<small>${esc(ST.moverWhy(r))}</small>`, csv: r => ST.moverWhy(r) }], list, { sort: 'd', dir: cls === 't-tm-ql' ? 1 : -1, search: false, pageSize: 10, file: cls }) : '<p class="flat">None beyond normal variation.</p>';
    const insightsHtml = `<section class="panel"><div class="panel-h"><h2>Pages with the most clicks on each weekday</h2></div><div class="panel-b">${wdPages}</div></section>
      <section class="panel"><div class="panel-h"><h2>Searches gaining and losing clicks</h2><p>${esc(rowsPeriod)}. Changes within normal variation are left out.</p></div><div class="panel-b">${movQ ? `<div class="st-wl"><div><h3 class="st-h3 gainv">Gaining</h3>${mq(movQ.winners, 't-tm-qw')}</div><div><h3 class="st-h3 lossv">Losing</h3>${mq(movQ.losers, 't-tm-ql')}</div></div>` : rowsMsg || '<p class="empty">Needs search data for both periods.</p>'}</div></section>
      <section class="panel"><div class="panel-h"><h2>High impressions, low CTR</h2><p>Pages with plenty of impressions whose CTR is under 60% of what this site's pages earn at a similar position.</p></div><div class="panel-b">${pagesNow ? (low.length ? table('t-tm-low', [{ k: 'p', l: 'Page', cls: 'u', f: r => urlCell(r.p, pathOf(r.p)) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'pos', l: 'Position', r: 1, f: r => r.pos.toFixed(1) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pctf(r.ctr) }, { k: 'expected', l: 'Usual CTR here', r: 1, f: r => pctf(r.expected) }, { k: 'gap', l: 'Clicks missed (approx.)', r: 1, f: r => fmtN(r.gap) }], low, { sort: 'gap', search: false, pageSize: 12, file: 'high-impressions-low-ctr' }) : '<p class="flat">No page is far below the usual CTR for its position.</p>') : rowsMsg}</div></section>
      <section class="panel"><div class="panel-h"><h2>Ranking improvements and declines</h2><p>Pages whose average position moved by a full place or more, with 50+ impressions in both periods. ${esc(rowsPeriod)}.</p></div><div class="panel-b">${ranks ? `<div class="st-wl">${['up', 'down'].map(k => `<div><h3 class="st-h3 ${k === 'up' ? 'gainv' : 'lossv'}">${k === 'up' ? 'Improving' : 'Declining'}</h3>${ranks[k].length ? table('t-tm-r' + k, [{ k: 'p', l: 'Page', cls: 'u', f: r => urlCell(r.p, pathOf(r.p)) }, { k: 'prevPos', l: 'Before', r: 1, f: r => r.prevPos.toFixed(1) }, { k: 'pos', l: 'Now', r: 1, f: r => r.pos.toFixed(1) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'clicks', l: 'Clicks', r: 1, f: r => `${fmtN(r.prevClicks)} → ${fmtN(r.clicks)}` }, { k: 'd', l: 'Position change', r: 1, f: r => `<b class="${r.d < 0 ? 'gainv' : 'lossv'}">${r.d < 0 ? '▲' : '▼'} ${Math.abs(r.d).toFixed(1)}</b>`, csv: r => r.d.toFixed(2) }], ranks[k], { sort: 'd', dir: k === 'up' ? 1 : -1, search: false, pageSize: 10, file: 'ranking-' + k }) : '<p class="flat">None.</p>'}</div>`).join('')}</div>` : rowsMsg || '<p class="empty">Needs page data for both periods.</p>'}</div></section>
      <section class="panel"><div class="panel-h"><h2>Recent traffic spikes</h2><p>Last 7 days of final data (${SVp.rng(r7s, H.last)}) against the daily average of the 28 days before.</p></div><div class="panel-b">${spP ? `<div class="grid-2 even">${spikeList('Pages', spP, 'p')}${spikeList('Searches', spQ, 'q')}</div>` : api ? (loading ? '<p class="empty sv-loading">Fetching the last 7 days…</p>' : '<p class="empty">Not available.</p>') : '<p class="empty">Recent spikes by page and search need a Search Console connection.</p>'}</div></section>`;
    const recHtml = `<section class="panel"><div class="panel-h"><h2>Recommendations</h2><p>Generated by fixed rules from the findings on this tab (no AI model); each states the evidence it is based on.</p></div>
      ${recs.length ? `<ol class="st-recs">${recs.map(r => `<li><div class="st-r1"><span class="tag ${r.priority === 'High' ? 'risk' : r.priority === 'Medium' ? 'watch' : ''}">${r.priority}</span><b>${esc(r.title)}</b></div><p class="flat">${esc(r.evidence)}</p><p>${esc(r.action)}</p></li>`).join('')}</ol>` : `<p class="empty">${loading ? 'More recommendations appear when pages and searches finish loading.' : 'Nothing that needs action in this window.'}</p>`}
      <p class="flat st-pad tm-disc">Timing patterns here describe Google search demand. They are not advice to publish at a particular hour or day: Search Console does not measure that, and publishing time is not a ranking factor it reports.</p></section>`;

    const controls = `<div class="st-bar"><div class="seg" role="group" aria-label="Window">${[8, 12, 26, 52].map(n => `<button type="button" data-tm-w="${n}" class="${wks === n ? 'on' : ''}">${n} weeks</button>`).join('')}</div><span class="flat">Weekday analysis always uses ${Math.min(12, Math.max(8, wks))} complete weeks; the calendar and trend charts use the window.</span></div>`;
    const html = top + controls + `<div class="st-notes">${cov.map(c => `<span>${c}</span>`).join('')}</div>` + (warn.length ? `<div class="note warn st-warn"><ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '') +
      bestCard + `<div class="grid-2 even">${weekendCard}${cmpHtml}</div>` + wdHtml + hourPanel + `<section class="panel"><div class="panel-h"><h2>Daily performance calendar</h2><p>${SVp.rng(cal.start, cal.end)}. Shades split the days into five equal groups by clicks (darker = more). Outlined days are spikes (green) or drops (red). Hover for the numbers.</p></div><div class="panel-b">${calHtml}</div></section>` +
      trendHtml + datesHtml + recHtml + insightsHtml;

    const mount = () => {
      ['t-tm-wd', 't-tm-qw', 't-tm-ql', 't-tm-low', 't-tm-rup', 't-tm-rdown'].forEach(id => drawTable(id));
      document.querySelectorAll('[data-tm-w]').forEach(b => b.addEventListener('click', () => go({ weeks: b.dataset.tmW })));
      const rf = document.getElementById('tm-h-refresh'); if (rf) rf.addEventListener('click', () => { HOUR_TICK.set(D.site, (HOUR_TICK.get(D.site) || 0) + 1); SV().rerender(); });
      const ar = document.getElementById('tm-arc'); if (ar) ar.addEventListener('change', () => { if (ar.checked) store.set('hourly-on:' + D.site, true); else store.del('hourly-on:' + D.site); SV().rerender(); });
      const ac = document.getElementById('tm-arc-clear'); if (ac) ac.addEventListener('click', () => { if (confirm('Delete the hourly archive for ' + D.site + '?')) { store.del('hourly:' + D.site); SV().rerender(); } });
      const sig = cssVar('--signal'), sky = cssVar('--sky'), soft = c => c + '66';
      if (WDY.weeks) chart('tm-ch-wd', { data: { labels: WDY.days.map(d => d.short), datasets: [
        { type: 'bar', label: 'Average clicks', data: WDY.days.map(d => Math.round(d.avgClicks)), backgroundColor: WDY.days.map(d => d.k === B.k ? cssVar('--good') : d.k === Wk.k ? cssVar('--risk') : sig), borderRadius: 6, order: 2 },
        { type: 'line', label: 'Median clicks', data: WDY.days.map(d => Math.round(d.medianClicks)), borderColor: cssVar('--ink'), backgroundColor: cssVar('--ink'), showLine: false, pointRadius: 4, order: 1 }
      ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { footer: it => { const d = WDY.days[it[0].dataIndex]; return [`CTR ${d.ctr.toFixed(2)}% · position ${d.pos != null ? d.pos.toFixed(1) : '—'}`, `Above average in ${d.above}/${d.n} weeks`]; } } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmtN(v) } } } } });
      if (HR && !HR.empty) {
        chart('tm-ch-hours', { type: 'bar', data: { labels: HR.rows.map(r => r.ts), datasets: [
          { label: 'Clicks', data: HR.rows.map(r => r.clicks), backgroundColor: HR.rows.map(r => r.prelim ? soft(sig) : sig), barPercentage: 1, categoryPercentage: 1, yAxisID: 'y' },
          { type: 'line', label: 'Impressions', data: HR.rows.map(r => r.impr), borderColor: sky, pointRadius: 0, borderWidth: 1.5, tension: .25, yAxisID: 'y1' }
        ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: it => { const r = HR.rows[it[0].dataIndex]; return `${dm(r.ts)} ${hm(r.ts)}${r.prelim ? ' (preliminary)' : ''}`; }, footer: it => { const r = HR.rows[it[0].dataIndex]; return r.impr ? `CTR ${(r.clicks / r.impr * 100).toFixed(2)}% · position ${r.pos ? r.pos.toFixed(1) : '—'}` : 'No impressions'; } } } },
          scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => { const t = HR.rows[i].ts, h = +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)); return h === 0 ? dm(t) : ''; } } }, y: { title: { display: true, text: 'Clicks' }, ticks: { callback: v => fmtN(v) } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'Impressions' }, ticks: { callback: v => fmtN(v) } } } } });
        if (prof) chart('tm-ch-hod', { type: 'bar', data: { labels: prof.by.map(b => String(b.h).padStart(2, '0')), datasets: [{ label: 'Average clicks per hour', data: prof.by.map(b => b.avgClicks == null ? null : +b.avgClicks.toFixed(1)), backgroundColor: cssVar('--teal') || sig, borderRadius: 3 }] },
          options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { footer: it => { const b = prof.by[it[0].dataIndex]; return `${b.n} hours observed · CTR ${b.ctr != null ? b.ctr.toFixed(2) + '%' : '—'}`; } } } }, scales: { x: { grid: { display: false }, title: { display: true, text: `Hour (${tz})` } }, y: { ticks: { callback: v => fmtN(v) } } } } });
      }
      const wb = ST.buckets(ST.index(H.rows), { start: cal.start, end: cal.end }, 'week'), mb = ST.buckets(ST.index(H.rows), { start: cal.start, end: cal.end }, 'month');
      const bars = (id, bk, word) => chart(id, { type: 'bar', data: { labels: bk.map(b => b.label), datasets: [{ label: 'Clicks', data: bk.map(b => b.clicks), backgroundColor: bk.map(b => b.partial ? soft(sig) : sig), borderRadius: 4 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { footer: it => { const b = bk[it[0].dataIndex]; if (b.partial) return 'Partial: ' + b.why; const c = b.before ? ST.pct(b.clicks, b.before.clicks) : null; return `${word}: ${c == null ? 'n/a' : (c > 0 ? '+' : '') + c.toFixed(1) + '%'} · CTR ${b.ctr.toFixed(2)}% · position ${b.pos != null ? b.pos.toFixed(1) : '—'}`; } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { ticks: { callback: v => fmtN(v) } } } } });
      bars('tm-ch-week', wb, 'Week on week'); bars('tm-ch-month', mb, 'Month on month');
    };
    return { html, mount };
  }

  function spikeList(label, sp, key) {
    if (!sp) return `<div><h3 class="st-h3">${label}</h3><p class="flat">Loading…</p></div>`;
    const li = (r, cls) => `<li>${key === 'p' ? urlCell(r.p, pathOf(r.p)) : serp(r.q)}<span class="${cls}">${r.perDay.toFixed(1)}/day</span><small class="flat">was ${r.before.toFixed(1)}/day${r.isNew ? ' · new' : ''}</small></li>`;
    return `<div><h3 class="st-h3">${label}</h3>${sp.up.length ? `<p class="flat">Up</p><ul class="tm-sp">${sp.up.map(r => li(r, 'gainv')).join('')}</ul>` : '<p class="flat">No recent spikes.</p>'}${sp.down.length ? `<p class="flat">Down</p><ul class="tm-sp">${sp.down.map(r => li(r, 'lossv')).join('')}</ul>` : ''}</div>`;
  }

  function calendarHtml(cal, anom) {
    if (!cal.cells.length) return '<p class="empty">No days to show.</p>';
    const odd = new Map(anom.map(a => [a.d, a.kind]));
    const first = cal.cells[0], pad = first.wd;
    const cells = Array(pad).fill(null).concat(cal.cells);
    const cols = Math.ceil(cells.length / 7);
        let html = '<div class="tm-cal" role="grid" aria-label="Clicks per day"><div class="tm-cal-l">' + T.WDS.map(w => `<span>${w}</span>`).join('') + '</div><div class="tm-cal-g" style="grid-template-columns:repeat(' + cols + ',1fr)">';
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 7; r++) {
        const x = cells[c * 7 + r];
        html += x ? `<span class="tm-c l${x.level}${odd.has(x.d) ? ' ' + odd.get(x.d) : ''}" style="grid-column:${c + 1};grid-row:${r + 1}" role="gridcell" tabindex="-1" title="${x.d} (${T.WD[x.wd]}): ${Math.round(x.clicks).toLocaleString('en-US')} clicks, ${Math.round(x.impr).toLocaleString('en-US')} impressions, CTR ${x.ctr.toFixed(2)}%${x.pos ? ', position ' + x.pos.toFixed(1) : ''}${x.typical ? `; expected ~${Math.round(x.typical).toLocaleString('en-US')}` : ''}"></span>` : `<span class="tm-c empty" style="grid-column:${c + 1};grid-row:${r + 1}"></span>`;
      }
    }
    html += '</div></div><div class="tm-cal-k"><span class="flat">Fewer</span>' + [0, 1, 2, 3, 4, 5].map(i => `<span class="tm-c l${i}"></span>`).join('') + '<span class="flat">More clicks</span><span class="tm-c l3 spike"></span><span class="flat">spike</span><span class="tm-c l3 drop"></span><span class="flat">drop</span></div>';
    return html;
  }

  window.CW_TIMINGVIEW = { render };
})();
