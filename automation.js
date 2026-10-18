// Clickwise automation screens: Smart filters, Workflows, and workflow results.
// Users describe outcomes; nothing here asks them for patterns or formulas.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { table, drawTable, TABLES, C, head, stat, ledger, svg, ICON, pctf, posTag, urlCell, serp, gainCell, range, methodNote, tileDelta } = ui;
  const F = window.CW_FILTERS, W = window.CW_WORKFLOWS, CW = window.CW, fmtN = CW.fmtN;

  Object.assign(ICON, {
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    filter: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    play: '<path d="M6 4l14 8-14 8z"/>'
  });

  // ── per-site saved filters and workflows (this browser only) ──
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const siteOf = A => (A.data && A.data.site) || 'site';
  const savedList = A => { const l = store.get('saved:' + siteOf(A)); return Array.isArray(l) ? l : []; };
  function saveItem(A, item) {
    const list = savedList(A).filter(x => !(item.type === 'workflow' && x.type === 'workflow' && x.wf === item.wf));
    list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...item });
    return store.set('saved:' + siteOf(A), list.slice(0, 50));
  }
  const removeItem = (A, id) => store.set('saved:' + siteOf(A), savedList(A).filter(x => x.id !== id));

  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const setParams = (base, obj) => history.replaceState(null, '', '#' + base + (obj ? '?' + new URLSearchParams(obj) : ''));
  const flash = (el, text) => { if (!el) return; const t = el.textContent; el.textContent = text; el.disabled = true; setTimeout(() => { el.textContent = t; el.disabled = false; }, 1600); };
  const dataLabel = D => D.source === 'demo' ? 'Sample data (fictional site)' : D.source === 'api' ? 'Search Console (live)' : 'Search Console export';
  const rangeLabel = D => D.start && D.end ? `${D.start} to ${D.end}` : 'date range not in export';

  // ── shared result rendering ──
  const changeCell = r => r.clickChange == null ? '—' : `<span class="${r.clickChange < 0 ? 'lossv' : 'gainv'}">${r.clickChange > 0 ? '+' : ''}${r.clickChange.toFixed(0)}%</span>`;
  function filterCols(spec) {
    const uses = f => spec.conds.some(c => c.f === f);
    const oppGoal = spec.conds.some(c => ['opp', 'gain', 'confidence'].includes(c.f) && c.op !== 'not');
    // opportunity goals add four columns, so they leave out CTR and page type to keep the table readable
    const clicksCol = { ...C.clicks, f: r => r.uncertain ? `≤ ${fmtN(r.clicks)} <span class="tag watch" title="Not in this period's list, which stops at its row limit: clicks are at most the smallest row listed">upper bound</span>` : fmtN(r.clicks), csv: r => (r.uncertain ? '<=' : '') + Math.round(r.clicks) };
    const cols = [spec.target === 'page' ? { ...C.page, cls: 'u wide' } : { ...C.q, cls: 'q wide' }, clicksCol, C.impr].concat(oppGoal ? [] : [C.ctr]).concat([{ ...C.pos, f: r => r.gone ? '<span class="flat">Gone</span>' : posTag(r.pos) }]);
    if (uses('ctrGap')) cols.push({ k: 'bench', l: 'Expected CTR', r: 1, f: r => r.gone ? '—' : pctf(r.bench) });
    if (uses('clickChange')) cols.push({ k: 'prevClicks', l: 'Clicks before', r: 1, f: r => fmtN(r.prevClicks) }, { k: 'clickChange', l: 'Change', r: 1, f: changeCell });
    if (spec.target === 'page' && spec.group !== 'pageType' && !oppGoal) cols.push({ k: 'pageType', l: 'Page type', f: r => `<span class="tag">${esc(r.pageType)}</span>`, csv: r => r.pageType });
    if ((uses('location') || spec.group === 'location') && spec.group !== 'location') cols.push({ k: 'place', l: 'Place', f: r => r.place ? `<span class="tag">${esc(r.place)}</span>` : '—', csv: r => r.place || '' });
    if (spec.target === 'query' && uses('section')) cols.push({ k: 'landingPath', l: 'Ranking page', cls: 'u', f: r => r.landingPath ? esc(r.landingPath) : '—', csv: r => r.landingPath || '' });
    // goals about opportunities show the engine's estimate, confidence and action next to each row
    if (spec.conds.some(c => ['opp', 'gain', 'confidence'].includes(c.f) && c.op !== 'not')) {
      const kinds = r => [...r.opp].map(k => F.OPP[k] ? F.OPP[k].label : k);
      cols.push({ k: 'oppS', l: 'Opportunity', sort: false, f: r => kinds(r).map(x => `<span class="tag">${esc(x)}</span>`).join(' '), csv: r => kinds(r).join('; ') },
        { k: 'gain', l: 'Clicks / month (est.)', r: 1, f: r => r.gain == null ? '<span class="flat">—</span>' : gainCell({ gainLo: r.gain, gainHi: r.gainHi }), csv: r => r.gain == null ? '' : `${Math.round(r.gain)}–${Math.round(r.gainHi)}` },
        { k: 'confidence', l: 'Confidence', f: r => r.confidence ? `<span class="tag ${r.confidence === 'High' ? 'gain' : r.confidence === 'Medium' ? 'watch' : ''}">${esc(r.confidence)}</span>` : '—', csv: r => r.confidence || '' },
        { k: 'act', l: 'What to do', sort: false, cls: 'act', f: r => r.oppItem ? `<small>${esc(r.oppItem.action)}</small>` : '', csv: r => r.oppItem ? r.oppItem.action : '' });
    }
    return cols;
  }
  function resultBlock(id, spec, res, fileBase) {
    if (res.groups) {
      const gcols = [{ k: 'key', l: 'Group', cls: 'q', f: r => `<b>${esc(r.key)}</b>` }, { k: 'n', l: spec.target === 'page' ? 'Pages' : 'Searches', r: 1, f: r => r.n.toLocaleString() }, C.clicks, C.impr, C.ctr, C.pos];
      const shown = res.groups.slice(0, 20);
      return `<section class="panel"><div class="panel-h"><h2>Groups</h2><p>Open a group to see what is in it.</p></div>${table(id + '-g', gcols, res.groups, { sort: 'clicks', file: fileBase + '-groups', search: false, pageSize: 25 })}</section>
        <section class="panel stack">${shown.map((g, i) => `<details class="acc" data-grp="${id}-${i}" ${i === 0 ? 'open' : ''}><summary><div><h3>${esc(g.key)}</h3><p>${g.n.toLocaleString()} ${spec.target === 'page' ? 'pages' : 'searches'} · ${fmtN(g.clicks)} clicks · ${fmtN(g.impr)} impressions</p></div><svg class="chev" viewBox="0 0 24 24" aria-hidden="true">${ICON.chev}</svg></summary>
          ${table(id + '-' + i, filterCols(spec), g.rows, { sort: res.sortKey, file: fileBase + '-' + g.key.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-'), pageSize: 10, searchKeys: spec.target === 'page' ? ['path'] : ['q'], placeholder: 'Filter this group' })}</details>`).join('')}
          ${res.groups.length > shown.length ? `<p class="empty">Showing the 20 largest of ${res.groups.length} groups. Export the groups table for the full list.</p>` : ''}</section>`;
    }
    return `<section class="panel">${table(id, filterCols(spec), res.rows, { sort: res.sortKey, file: fileBase, pageSize: 25, searchKeys: spec.target === 'page' ? ['path'] : ['q'], placeholder: spec.target === 'page' ? 'Filter these pages' : 'Filter these searches', empty: 'Nothing matches. Try removing a condition.' })}</section>`;
  }
  function mountResult(id, res) {
    if (res.groups) {
      drawTable(id + '-g');
      document.querySelectorAll(`[data-grp^="${id}-"]`).forEach(d => {
        const tid = d.dataset.grp; let drawn = false;
        const go = () => { if (d.open && !drawn) { drawTable(tid); drawn = true; } };
        d.addEventListener('toggle', go); go();
      });
    } else drawTable(id);
  }

  // the Dashboard's question box hands the text to the Goal builder
  document.addEventListener('submit', e => {
    if (!e.target || e.target.id !== 'ov-ask') return;
    e.preventDefault();
    const v = (document.getElementById('ov-ask-in').value || '').trim().slice(0, 300);
    location.hash = v ? '#filters?q=' + encodeURIComponent(v) : '#filters';
  });

  // ════════ Goal builder (Smart filters) ════════
  // Describe → check what was understood (answer any question, edit any condition) → preview → run → save.
  // The parser and engine are deterministic; nothing typed here is ever run as code or as a pattern.
  const FIELD_NAME = { place: 'Place', clicks: 'Clicks', impr: 'Impressions', ctr: 'CTR (%)', pos: 'Position', ctrGap: 'Share of expected clicks (%)', clickChange: 'Change in clicks (%)', words: 'Words in the search', text: null, section: 'Folder', pageType: 'Page type', brand: 'Branded', question: 'Is a question', location: 'Mentions a place', intent: 'Intent', opp: 'Opportunity', gain: 'Estimated clicks a month', confidence: 'Confidence' };
  const OP_NAME = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', between: 'between', contains: 'contains', notContains: "doesn't contain", startsWith: 'starts with', endsWith: 'ends with', equals: 'is exactly', word: 'has the word', is: 'is', not: 'is not' };
  const fieldName = (f, target) => f === 'section' && target === 'query' ? 'Folder of the ranking page' : FIELD_NAME[f] || (target === 'page' ? 'URL' : 'Search text');
  const STATUS = { done: 'Finished', 'needs-data': 'Needs more data', failed: 'Could not run' };
  let CUR = null;

  // run history, per site, in this browser
  const runsOf = A => { const l = store.get('runs:' + siteOf(A)); return Array.isArray(l) ? l : []; };
  // history keeps when a run happened, its status and how many rows matched — never the search data itself
  const addRun = (A, rec) => store.set('runs:' + siteOf(A), [{ goalId: rec.goalId, at: rec.at, status: rec.status, count: rec.count, matched: rec.matched, errors: rec.errors, ms: rec.ms, data: { source: rec.data.source, start: rec.data.start, end: rec.data.end } }].concat(runsOf(A)).slice(0, 100));
  const lastRun = (A, id) => runsOf(A).find(r => r.goalId === id) || null;
  // saved Smart filters from earlier versions become goals
  const goalOf = s => s.type === 'goal' && s.goal ? s.goal : s.type === 'filter' && s.spec ? W.makeGoal(s.name || 'Saved filter', s.text || '', s.spec) : null;

  V.filters = (A) => {
    const html = head('Goal builder', 'Describe an SEO task in plain English. Clickwise turns it into conditions you can check and edit, previews what matches, then runs it — no patterns or formulas needed.') +
      `<section class="panel sf">
        <form class="sf-box" id="sf-form" autocomplete="off">
          ${svg('spark')}<input id="sf-in" type="text" maxlength="300" placeholder="e.g. Which pages should I fix first?" aria-label="Describe what you want to find">
          <button class="btn-primary" type="submit">Interpret</button>
        </form>
        <div class="sf-ex"><span>Try</span>${F.EXAMPLES.map(e => `<button type="button" class="chip-ex" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <p class="sf-or">Prefer to pick options? <button type="button" class="btn-link" id="sf-build">Build it step by step</button></p>
      </section>
      <div id="sf-out" aria-live="polite"></div>`;
    const mount = () => {
      const inp = document.getElementById('sf-in');
      const go = text => { text = text.trim(); if (!text) { inp.focus(); return; } const p = F.parse(text, A); CUR = { spec: p.spec, text, parsed: p, answered: [] }; setParams('filters', { q: text }); render(A); };
      document.getElementById('sf-form').addEventListener('submit', e => { e.preventDefault(); go(inp.value); });
      document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { inp.value = b.dataset.ex; go(b.dataset.ex); }));
      document.getElementById('sf-build').addEventListener('click', () => { CUR = { spec: { target: 'query', conds: [] }, text: '', parsed: null, answered: [] }; setParams('filters'); render(A); setTimeout(() => { const f = document.getElementById('sf-f'); if (f) f.focus(); }, 0); });
      const prm = params();
      if (prm.get('q')) { inp.value = prm.get('q').slice(0, 300); go(inp.value); }
      else if (prm.get('saved')) {
        const s = savedList(A).find(x => x.id === prm.get('saved'));
        const g = s && goalOf(s);
        if (!g) { document.getElementById('sf-out').innerHTML = '<div class="note warn" role="alert">That saved workflow is no longer in this browser.</div>'; return; }
        const ge = W.validateGoal(g);
        if (ge.length) { document.getElementById('sf-out').innerHTML = `<div class="note warn" role="alert"><b>This saved workflow can't be opened.</b><ul>${ge.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`; return; }
        inp.value = g.text || '';
        CUR = { spec: g.spec, text: g.text || '', parsed: null, name: g.name, savedId: s.id, answered: [] };
        if (prm.get('run')) runNow(A);
        render(A);
      } else if (prm.get('spec')) {
        let spec = null; try { spec = JSON.parse(prm.get('spec')); } catch (e) { }
        CUR = spec && typeof spec === 'object' ? { spec: { target: spec.target, conds: Array.isArray(spec.conds) ? spec.conds : [], group: spec.group || undefined, caseSensitive: !!spec.caseSensitive }, text: '', parsed: null, answered: [] } : null;
        if (CUR) render(A);
      } else if (CUR) { inp.value = CUR.text || ''; render(A); }
    };
    return { html, mount };
  };

  const specKey = spec => JSON.stringify(spec);
  function runNow(A) {
    const g = W.makeGoal(CUR.name || CUR.text || F.describe(CUR.spec), CUR.text, CUR.spec);
    const out = W.runGoal(g, A);
    CUR.ran = { key: specKey(CUR.spec), record: out.record, result: out.result };
    if (CUR.savedId) addRun(A, { goalId: CUR.savedId, ...out.record });
  }

  function render(A) {
    const out = document.getElementById('sf-out'); if (!out || !CUR) return;
    const D = A.data || {};
    const R = F.rows(A);
    const spec = CUR.spec, p = CUR.parsed;
    Object.keys(TABLES).filter(k => k.startsWith('t-sf')).forEach(k => delete TABLES[k]);
    const questions = p ? p.questions.map((q, i) => ({ ...q, i })).filter(q => !CUR.answered.includes(q.i)) : [];
    if (p && !p.understood && !questions.length) {
      out.innerHTML = `<div class="note warn"><b>I couldn't turn that into a goal.</b> ${p.unknown.length ? `I didn't recognise: ${p.unknown.slice(0, 8).map(w => `<span class="tag">${esc(w)}</span>`).join(' ')}. ` : ''}Try one of the examples, mention a number (“more than 500 impressions”), a position (“positions 4 to 20”), an outcome (“titles to rewrite”, “pages losing clicks”), or a word to look for in quotes (“containing "price"”).</div>`;
      return;
    }
    const errs = F.validate(spec, R);
    const res = errs.length ? null : F.run(spec, A);
    const fun = errs.length ? null : F.funnel(spec, A);
    const ran = CUR.ran && CUR.ran.key === specKey(spec) ? CUR.ran : null;
    const noun = n => spec.target === 'page' ? (n === 1 ? 'page' : 'pages') : (n === 1 ? 'search' : 'searches');
    const chips = spec.conds.map((c, i) => `<span class="chip${CUR.editing === i ? ' editing' : ''}"><button type="button" class="chip-t" data-ed="${i}" title="Edit this condition">${esc(F.chip(c, spec.target))}</button><button type="button" data-rm="${i}" aria-label="Remove: ${esc(F.chip(c, spec.target))}">${svg('x')}</button></span>`).join('');
    const groupOpts = Object.entries(F.GROUPS).filter(([k]) => spec.target === 'page' ? ['pageType', 'folder', 'location'].includes(k) : ['brand', 'intent', 'location'].includes(k));
    const recipe = F.gscRecipe(spec, A);
    const notes = p ? p.notes : [];
    const info = [
      notes.includes('date-ok') ? `Dates: your request matches the loaded range (${esc(rangeLabel(D))}).` : notes.includes('date') && !(p.issues || []).some(x => x.kind === 'dates') ? `Dates: this uses the range you loaded (${esc(rangeLabel(D))}).` : '',
      notes.includes('device-ok') ? `Device: this analysis already covers ${esc(String(D.filters.device).toLowerCase())} only.` : '',
      notes.includes('place-mention') ? 'Places are matched in the words of the search. Search Console doesn\'t say where the searcher was.' : '',
      notes.includes('content') ? 'Content opportunities here are improvements to pages that already rank (searches close to page one, low CTR, answer boxes). Topics with no good page yet are in <a href="#content?tab=gaps">Content gaps</a>.' : '',
      spec.conds.some(c => c.f === 'opp' && (c.v === 'gap' || c.v === 'link')) ? `From <a href="#content">Content &amp; links</a>, which shows the evidence and drafts briefs.` : '',
      notes.includes('compare') && R.hasPrev ? `Compared with ${esc(D.prevStart || 'the previous period')}${D.prevEnd ? ' to ' + esc(D.prevEnd) : ''}${A.decay && A.decay.scale !== 1 ? `, scaled to ${A.days} days` : ''}.` : '',
            notes.includes('cannibal') ? `Competing pages are listed by the search they compete for${A.cannibalMode === 'stem' ? '; without a Search Console connection they are estimated from similar wording' : ''}.` : '',
      spec.conds.some(c => ['opp', 'gain', 'confidence'].includes(c.f)) ? '<a href="#opps">Opportunity</a> kinds, estimates and confidence come from All opportunities, so the numbers match everywhere.' : ''
    ].filter(Boolean);
    const issues = p ? p.issues : [];
    const actBtn = a => !a ? '' : a.type === 'dates' ? `<button type="button" class="btn-quiet" data-act="dates" data-days="${a.days}">Load the last ${a.days} days</button>` : a.type === 'device' ? `<button type="button" class="btn-quiet" data-act="device" data-device="${esc(a.value)}">Re-run for ${esc(a.value.toLowerCase())} only</button>` : '';
    const preview = res ? res.rows.slice(0, 10) : [];

    out.innerHTML = `
      <section class="panel">
        <div class="panel-h"><h2>${p ? 'What Clickwise understood' : 'Your goal'}</h2><p>Click a condition to change it, remove anything that's wrong, or add one. The preview updates straight away.</p></div>
        <div class="panel-b sf-edit">
          ${issues.length ? `<div class="sf-issues">${issues.map(x => `<div class="note warn sf-issue" data-kind="${esc(x.kind)}"><b>${esc(x.text)}</b> ${esc(x.alternative || '')} ${actBtn(x.action)}</div>`).join('')}</div>` : ''}
          ${questions.length ? `<div class="sf-qs" role="group" aria-label="Questions about your request">${questions.map(q => `<div class="sf-q"><p>${esc(q.text)}</p><div class="sf-qo">${q.options.map((o, j) => `<button type="button" class="${j === 0 ? 'btn-primary sm' : 'btn-quiet'}" data-q="${q.i}" data-o="${j}">${esc(o.label)}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
          <div class="sf-row"><span class="sf-lbl">Look at</span>
            <div class="seg" role="group" aria-label="Look at"><button type="button" data-target="query" class="${spec.target === 'query' ? 'on' : ''}">Searches</button><button type="button" data-target="page" class="${spec.target === 'page' ? 'on' : ''}">Pages</button></div>
            <label class="sf-group"><span class="sf-lbl">Group by</span><select id="sf-grp"><option value="">Nothing</option>${groupOpts.map(([k, l]) => `<option value="${k}" ${spec.group === k ? 'selected' : ''}>${esc(l.charAt(0).toUpperCase() + l.slice(1))}</option>`).join('')}</select></label>
            <label class="sf-group"><span class="sf-lbl">Show</span><select id="sf-lim"><option value="">All matches</option>${[10, 20, 50, 100].map(n => `<option value="${n}" ${spec.limit === n ? 'selected' : ''}>Top ${n}</option>`).join('')}${spec.limit && ![10, 20, 50, 100].includes(spec.limit) ? `<option value="${spec.limit}" selected>Top ${spec.limit}</option>` : ''}</select></label>
          </div>
          <div class="chips">${chips || '<span class="flat">No conditions yet — showing everything.</span>'}</div>
          ${info.map(x => `<p class="sf-info">${x}</p>`).join('')}
          ${(() => { const asked = new Set(p ? p.questions.filter(q => q.word).map(q => q.word) : []); const rest = p ? p.unknown.filter(w => !asked.has(w)) : []; return rest.length ? `<p class="sf-warn">Also not used: ${rest.slice(0, 10).map(w => `<span class="tag">${esc(w)}</span>`).join(' ')}</p>` : ''; })()}
          ${CUR.dropped ? `<p class="sf-info">Removed because they don't apply here: ${esc(CUR.dropped)}.</p>` : ''}
          <div class="builder" id="sf-add">
            <span class="sf-lbl">${CUR.editing != null ? 'Change' : 'Add'}</span>
            <select id="sf-f" aria-label="What to check">${Object.keys(F.FIELDS).filter(f => F.FIELDS[f].on.includes(spec.target) && (F.FIELDS[f].needs !== 'prev' || R.hasPrev) && !(f === 'section' && spec.target === 'query' && !R.hasQP) && !(['opp', 'gain', 'confidence'].includes(f) && !R.hasOpps)).map(f => `<option value="${f}">${esc(fieldName(f, spec.target))}</option>`).join('')}</select>
            <select id="sf-op" aria-label="How to compare"></select>
            <span id="sf-v" class="sf-v"></span>
            <button type="button" class="btn-quiet" id="sf-addbtn">${CUR.editing != null ? 'Update' : svg('plus') + 'Add'}</button>
            ${CUR.editing != null ? '<button type="button" class="btn-link" id="sf-cancel">Cancel</button>' : ''}
            <span class="sf-err" id="sf-adderr" role="alert"></span>
          </div>
          <details class="sf-adv">
            <summary>Advanced</summary>
            <label class="check"><input type="checkbox" id="sf-cs" ${spec.caseSensitive ? 'checked' : ''}> Match capital letters exactly (useful for URLs; Search Console lowercases queries)</label>
            <div class="sf-recipe"><h4>Recreate this in Search Console</h4>
              ${recipe.steps.length ? `<p>Performance › Search results › <b>+ Add filter</b>, then:</p><table><thead><tr><th>Filter</th><th>Choose</th><th>Value</th><th></th></tr></thead><tbody>${recipe.steps.map((s, i) => `<tr><td>${esc(s[0])}</td><td>${esc(s[1])}</td><td><code id="sf-rc-${i}">${esc(s[2])}</code></td><td><button type="button" class="btn-quiet" data-copy="sf-rc-${i}">Copy</button></td></tr>`).join('')}</tbody></table>` : '<p>Nothing to set up: this goal uses only Clickwise calculations.</p>'}
              ${recipe.skipped.length ? `<p class="flat">Search Console can't do these, so they only apply here: ${recipe.skipped.map(esc).join('; ')}.</p>` : ''}
            </div>
          </details>
        </div>
      </section>
      ${errs.length ? `<div class="note warn" role="alert" id="sf-errs"><b>This goal can't run yet.</b><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : `
      <section class="panel" id="sf-preview">
        <div class="panel-h"><h2>Preview</h2><p>${esc(dataLabel(D))} · ${esc(rangeLabel(D))}</p></div>
        <div class="panel-b">
          <p class="sf-say">${esc(F.describe(spec))} <b>${res.rows.length.toLocaleString()} ${noun(res.rows.length)}</b>${spec.limit && res.matched > res.rows.length ? ` (of ${res.matched.toLocaleString()} that match)` : ''}.</p>
          ${fun && fun.length > 1 ? `<ol class="sf-fun" aria-label="How each condition narrows the list">${fun.map((s, i) => `<li><span>${esc(s.label)}</span><b>${s.n.toLocaleString()}</b>${i && s.n === 0 && fun[i - 1].n > 0 ? '<em>removes everything left</em>' : ''}</li>`).join('')}</ol>` : ''}
          ${ran ? '<p class="flat sf-pv-h">Full results are below.</p>' : preview.length ? `<p class="flat sf-pv-h">First ${preview.length} of ${res.rows.length.toLocaleString()}:</p>${table('t-sf-p', filterCols(spec, res), preview, { sort: null, search: false, pageSize: 10, exportable: false })}` : `<p class="empty">Nothing matches. ${fun && fun.length > 1 ? 'The list above shows which condition removes everything; change or remove it.' : 'Try removing a condition.'}</p>`}
          <div class="sf-run">
            <button type="button" class="btn-primary" id="sf-runbtn">${svg('play')}Run workflow</button>
            <input id="sf-name" type="text" maxlength="80" value="${esc((CUR.name || CUR.text || F.describe(spec)).slice(0, 80))}" aria-label="Name for this workflow">
            <button type="button" class="btn-quiet" id="sf-savebtn">${svg('save')}${CUR.savedId ? 'Save changes' : 'Save workflow'}</button>
          </div>
        </div>
      </section>
      ${ran ? `<section class="panel" id="sf-result">
        <div class="panel-h"><h2>Result</h2><p class="sf-status st-${esc(ran.record.status)}">${esc(STATUS[ran.record.status])} at ${esc(new Date(ran.record.at).toLocaleTimeString())} · ${ran.record.count.toLocaleString()} ${noun(ran.record.count)} · ${ran.record.ms} ms${CUR.savedId ? ' · added to this workflow\'s history' : ''}</p></div>
        ${ran.record.errors.length ? `<div class="panel-b"><div class="note warn" role="alert"><ul>${ran.record.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div></div>` : `<div class="panel-b"><div class="strip">${stat(ran.record.count.toLocaleString(), noun(ran.record.count), 'gain')}${stat(fmtN(ran.result.total.clicks), 'clicks')}${stat(fmtN(ran.result.total.impr), 'impressions')}${stat(pctf(ran.result.total.ctr), 'CTR')}${ran.result.lost > 0 && spec.conds.some(c => c.f === 'clickChange') ? stat('−' + fmtN(ran.result.lost), 'clicks lost', 'risk') : ''}</div></div>`}
      </section>${ran.result ? resultBlock('t-sf', spec, ran.result, 'goal') : ''}` : ''}`}`;

    // ── wire up ──
    const changed = () => { CUR.ran = null; CUR.editing = null; setParams('filters', { spec: JSON.stringify(CUR.spec) }); render(A); };
    out.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { CUR.spec = { ...spec, conds: spec.conds.filter((_, i) => i !== +b.dataset.rm) }; CUR.dropped = null; changed(); }));
    out.querySelectorAll('[data-ed]').forEach(b => b.addEventListener('click', () => { CUR.editing = +b.dataset.ed; render(A); const f = document.getElementById('sf-f'); if (f) f.focus(); }));
    out.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      const q = p.questions[+b.dataset.q], o = q.options[+b.dataset.o];
      const r = F.applyPatch(CUR.spec, o.patch);
      CUR.spec = r.spec; CUR.dropped = r.dropped.join('; ') || null; CUR.answered = CUR.answered.concat(+b.dataset.q); changed();
    }));
    out.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cw:change', { detail: b.dataset.act === 'dates' ? { days: +b.dataset.days } : { device: b.dataset.device } }));
    }));
    out.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.target; if (t === spec.target) return;
      const r = F.applyPatch(spec, { target: t }); CUR.spec = r.spec; CUR.dropped = r.dropped.join('; ') || null; changed();
    }));
    document.getElementById('sf-grp').addEventListener('change', e => { CUR.spec = { ...spec, group: e.target.value || undefined }; changed(); });
    document.getElementById('sf-lim').addEventListener('change', e => {
      const n = parseInt(e.target.value, 10), s2 = { ...spec };
      if (n) { s2.limit = n; if (!s2.sort) s2.sort = { f: spec.conds.some(c => ['opp', 'gain', 'confidence'].includes(c.f)) ? 'gain' : 'clicks', dir: 'desc' }; } else { delete s2.limit; }
      CUR.spec = s2; changed();
    });
    document.getElementById('sf-cs').addEventListener('change', e => { CUR.spec = { ...spec, caseSensitive: e.target.checked }; changed(); });
    const cancel = document.getElementById('sf-cancel'); if (cancel) cancel.addEventListener('click', () => { CUR.editing = null; render(A); });
    builder(A, spec, R, CUR.editing != null ? spec.conds[CUR.editing] : null, cond => {
      const conds = spec.conds.slice();
      if (CUR.editing != null) conds[CUR.editing] = cond; else conds.push(cond);
      CUR.spec = { ...spec, conds }; CUR.dropped = null; changed();
    });
    const rb = document.getElementById('sf-runbtn');
    if (rb) rb.addEventListener('click', () => { runNow(A); render(A); const r = document.getElementById('sf-result'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'start' }); });
    const sb = document.getElementById('sf-savebtn');
    if (sb) sb.addEventListener('click', () => {
      const name = document.getElementById('sf-name').value.trim() || F.describe(spec);
      const goal = W.makeGoal(name, CUR.text || '', CUR.spec);
      const ge = W.validateGoal(goal);
      if (ge.length) { flash(sb, ge[0]); return; }
      let ok;
      if (CUR.savedId) { const list = savedList(A).map(x => x.id === CUR.savedId ? { ...x, type: 'goal', name: goal.name, goal, at: new Date().toISOString() } : x); ok = store.set('saved:' + siteOf(A), list); }
      else { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); const list = savedList(A); list.unshift({ id, at: new Date().toISOString(), type: 'goal', name: goal.name, goal }); ok = store.set('saved:' + siteOf(A), list.slice(0, 50)); if (ok) CUR.savedId = id; }
      CUR.name = goal.name;
      flash(sb, ok ? 'Saved — find it under Workflows' : 'Could not save (browser storage is off)');
    });
    if (preview.length && !ran) drawTable('t-sf-p');
    if (ran && ran.result) mountResult('t-sf', ran.result);
  }

  function builder(A, spec, R, editing, onAdd) {
    const fSel = document.getElementById('sf-f'), opSel = document.getElementById('sf-op'), vBox = document.getElementById('sf-v'), err = document.getElementById('sf-adderr');
    if (!fSel) return;
    const enumValues = f => f === 'intent' ? Object.entries(CW.INTENT_LABEL) : f === 'pageType' ? R.types.map(t => [t, t]) : f === 'section' ? R.folders.map(x => [x, x]) : f === 'place' ? R.places[spec.target].map(x => [x, x])
      : f === 'opp' ? Object.entries(F.OPP).filter(([k]) => k === 'any' || k === 'growth' || R.oppKinds[spec.target].includes(k)).map(([k, o]) => [k, o.label]) : f === 'confidence' ? F.LEVELS.map(l => [l, l]) : [];
    const drawOps = () => {
      const f = F.FIELDS[fSel.value];
      opSel.innerHTML = F.OPS[f.kind].filter(o => o !== 'in').map(o => `<option value="${o}">${esc(OP_NAME[o])}</option>`).join('');
      opSel.hidden = f.kind === 'bool';
      drawValue();
    };
    const drawValue = () => {
      const f = F.FIELDS[fSel.value], op = opSel.value; err.textContent = '';
      const unit = f.unit ? `<span class="flat">${f.unit}</span>` : '';
      if (f.kind === 'num') vBox.innerHTML = op === 'between' ? `<input type="number" step="any" id="sf-v1" aria-label="From"> and <input type="number" step="any" id="sf-v2" aria-label="To">${unit}` : `<input type="number" step="any" id="sf-v1" aria-label="Value">${unit}`;
      else if (f.kind === 'text') vBox.innerHTML = `<input type="text" id="sf-v1" maxlength="200" placeholder="${spec.target === 'page' ? 'e.g. /blog/ or pricing' : 'e.g. price'}" aria-label="Text">`;
      else if (f.kind === 'bool') vBox.innerHTML = `<select id="sf-v1" aria-label="Yes or no"><option value="1">Yes</option><option value="0">No</option></select>`;
      else { const vals = enumValues(fSel.value); vBox.innerHTML = vals.length ? `<select id="sf-v1" aria-label="Value">${vals.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select>` : '<span class="flat">No values in this data</span>'; }
    };
    fSel.addEventListener('change', drawOps); opSel.addEventListener('change', drawValue);
    // editing: load the condition's field, comparison and values into the controls
    if (editing && [...fSel.options].some(o => o.value === editing.f)) {
      fSel.value = editing.f; drawOps();
      if ([...opSel.options].some(o => o.value === editing.op)) { opSel.value = editing.op; drawValue(); }
      const v1 = document.getElementById('sf-v1'), v2 = document.getElementById('sf-v2');
      if (v1) v1.value = typeof editing.v === 'boolean' ? (editing.v ? '1' : '0') : Array.isArray(editing.v) ? editing.v.join(', ') : editing.v;
      if (v2 && editing.v2 != null) v2.value = editing.v2;
    } else drawOps();
    const submit = () => {
      const f = fSel.value, kind = F.FIELDS[f].kind, op = kind === 'bool' ? 'is' : opSel.value;
      const v1 = document.getElementById('sf-v1'), v2 = document.getElementById('sf-v2');
      if (!v1) { err.textContent = 'Nothing to choose here.'; return; }
      let cond;
      if (kind === 'num') cond = op === 'between' ? { f, op, v: parseFloat(v1.value), v2: parseFloat(v2.value) } : { f, op, v: parseFloat(v1.value) };
      else if (kind === 'text') cond = { f, op, v: v1.value.trim() };
      else if (kind === 'bool') cond = { f, op, v: v1.value === '1' };
      else cond = { f, op, v: v1.value };
      const errs = F.validate({ ...spec, conds: [cond], limit: undefined, sort: undefined }, R);
      if (errs.length) { err.textContent = errs[0]; return; }
      onAdd(cond);
    };
    document.getElementById('sf-addbtn').addEventListener('click', submit);
    vBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  // ════════ Workflows ════════
  const NEED_ICON = ok => ok ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  V.workflows = (A) => {
    const D = A.data || {};
    const saved = savedList(A);
    const card = w => {
      const miss = W.missing(w, A), weak = W.weaker(w, A);
      return `<article class="wf-card${w.featured ? ' featured' : ''}">
        <div class="wf-top"><span class="ico ${w.tone}">${svg(w.icon)}</span><div><h3>${esc(w.name)}</h3><p>${esc(w.finds)}</p></div></div>
        <div class="wf-needs"><span>Needs</span>${w.needs.map(k => `<span class="need ${W.hasData(k, A) ? 'ok' : 'miss'}">${NEED_ICON(W.hasData(k, A))}${esc(W.DATA[k].label)}</span>`).join('')}${(w.better || []).map(k => `<span class="need ${W.hasData(k, A) ? 'ok' : 'opt'}" title="Optional: makes results more precise">${W.hasData(k, A) ? NEED_ICON(true) : '+'}${esc(W.DATA[k].label)}${W.hasData(k, A) ? '' : ' (optional)'}</span>`).join('')}</div>
        <details class="wf-more"><summary>Conditions and output</summary>
          <ul>${w.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          <p><b>You get:</b> ${esc(w.output)}</p>
          ${w.steps ? `<p><b>Steps:</b> ${w.steps.map(esc).join(' → ')}</p>` : ''}
          <p class="flat">${esc(w.schedule || 'Runs on demand in your browser. Scheduled runs need the Clickwise server, which is not live yet.')}</p>
        </details>
        ${miss.length ? `<p class="wf-miss"><b>Missing:</b> ${miss.map(m => esc(m.label.toLowerCase()) + '. ' + esc(m.how)).join(' ')}</p>` : weak.length ? `<p class="wf-weak">Works now; ${esc(weak.map(m => m.label.toLowerCase()).join(' and '))} would make it more precise.</p>` : ''}
        <div class="wf-actions">
          ${miss.length ? (D.source !== 'demo' ? '<button type="button" class="btn-quiet" data-demo>Try it on sample data</button>' : '') : `<a class="btn-primary sm" href="#wf=${w.id}">${svg('play')}Run</a>`}
          <button type="button" class="btn-quiet" data-savewf="${w.id}">${svg('save')}Save</button>
        </div>
      </article>`;
    };
    const html = head('Workflows', 'Pick the outcome you want. Each workflow checks your data, applies proven thresholds and hands you a prioritised result — nothing to configure.') +
      (saved.length ? `<section class="panel"><div class="panel-h"><h2>Saved for ${esc(D.site)}</h2><p>Kept in this browser. Saved filters re-run on whatever data you load for this site.</p></div>
        <div class="panel-b flush"><table class="saved-t"><thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Last run</th><th scope="col"></th></tr></thead><tbody>${saved.map(s => {
          const isGoal = s.type === 'goal' || s.type === 'filter', lr = isGoal ? lastRun(A, s.id) : null;
          const last = !isGoal ? '<span class="flat">—</span>' : lr ? `<span class="st-${esc(lr.status)}">${esc(STATUS[lr.status] || lr.status)}</span> <small class="flat">${esc(new Date(lr.at).toLocaleString())} · ${lr.status === 'done' ? lr.count.toLocaleString() + ' results' : esc((lr.errors || [])[0] || '')}</small>` : '<span class="flat">Not run yet</span>';
          return `<tr data-row="${esc(s.id)}"><td><span class="tag ${isGoal ? '' : 'gain'}">${isGoal ? 'Your goal' : 'Workflow'}</span></td><td class="nm"><span>${esc(s.name)}</span> <button type="button" class="btn-link" data-rename="${esc(s.id)}" aria-label="Rename ${esc(s.name)}">Rename</button></td><td>${last}</td><td class="r"><a class="btn-quiet" href="${isGoal ? '#filters?saved=' + encodeURIComponent(s.id) + '&run=1' : '#wf=' + encodeURIComponent(s.wf)}">Run</a>${isGoal ? ` <a class="btn-quiet" href="#filters?saved=${encodeURIComponent(s.id)}">Edit</a>` : ''} <button type="button" class="btn-quiet" data-unsave="${esc(s.id)}">Remove</button></td></tr>`;
        }).join('')}</tbody></table></div></section>` : '') +
      `<div class="wf-grid">${W.TEMPLATES.map(card).join('')}</div>
       <div class="note"><b>Need something else?</b> <a href="#filters">Describe it in the Goal builder</a> — for example “which pages should I fix first” — and save it here as your own workflow.</div>`;
    const mount = () => {
      document.querySelectorAll('[data-savewf]').forEach(b => b.addEventListener('click', () => {
        const w = W.byId(b.dataset.savewf);
        flash(b, saveItem(A, { type: 'workflow', wf: w.id, name: w.name }) ? 'Saved' : 'Could not save');
        setTimeout(() => { if (location.hash === '#workflows') window.dispatchEvent(new HashChangeEvent('hashchange')); }, 900);
      }));
      document.querySelectorAll('[data-unsave]').forEach(b => b.addEventListener('click', () => { removeItem(A, b.dataset.unsave); window.dispatchEvent(new HashChangeEvent('hashchange')); }));
      // rename in place: the name is plain text, 1–80 characters
      document.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.rename, cell = b.closest('td'), item = savedList(A).find(x => x.id === id); if (!item) return;
        cell.innerHTML = `<input type="text" maxlength="80" value="${esc(item.name)}" aria-label="New name"> <button type="button" class="btn-quiet" data-ok>Save</button> <button type="button" class="btn-link" data-no>Cancel</button> <span class="sf-err" role="alert"></span>`;
        const inp = cell.querySelector('input'), msg = cell.querySelector('.sf-err');
        inp.focus(); inp.select();
        const done = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
        const save = () => {
          const name = inp.value.trim();
          if (!name) { msg.textContent = 'Enter a name.'; return; }
          const list = savedList(A).map(x => x.id !== id ? x : x.goal ? { ...x, name, goal: { ...x.goal, name } } : { ...x, name });
          if (!store.set('saved:' + siteOf(A), list)) { msg.textContent = 'Could not save (browser storage is off).'; return; }
          done();
        };
        cell.querySelector('[data-ok]').addEventListener('click', save);
        cell.querySelector('[data-no]').addEventListener('click', done);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') done(); });
      }));
    };
    return { html, mount };
  };

  // ── workflow results ──
  const confTag = r => `<span class="tag ${r.confidence === 'High' ? 'gain' : r.confidence === 'Medium' ? 'watch' : ''}">${esc(r.confidence)}</span>`;
  const sevTag = s => `<span class="tag ${s === 'high' ? 'risk' : s === 'medium' ? 'watch' : ''}">${s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'}</span>`;
  const before = { k: 'prevC', l: 'Clicks before', r: 1, f: r => fmtN(r.prevC) }, now = { k: 'curC', l: 'Clicks now', r: 1, f: r => fmtN(r.curC) };
  const chg = { k: 'ch', l: 'Change', r: 1, f: r => `<span class="lossv">${r.ch.toFixed(0)}%</span>` }, cause = { k: 'reason', l: 'Likely cause', sort: false };
  const COLS = {
    quickwins: [{ k: 'kind', l: 'Type', f: r => `<span class="tag">${esc(r.kind)}</span>` }, { k: 'item', l: 'Search or page', cls: 'q', f: r => r.isQuery ? serp(r.item) : urlCell(r.url, r.item), csv: r => r.url || r.item }, { k: 'why', l: 'Why it was picked', sort: false }, { k: 'action', l: 'What to do', sort: false }, { k: 'conf', l: 'Confidence', f: r => confTag(r) + (r.note ? `<br><small class="flat">${esc(r.note)}</small>` : ''), csv: r => r.confidence + (r.note ? ' (' + r.note + ')' : '') }, { k: 'effort', l: 'Effort' }, { k: 'gain', l: 'Clicks / month (est.)', r: 1, f: r => gainCell({ gainLo: r.gainLo, gainHi: r.gainHi }), csv: r => `${Math.round(r.gainLo)}–${Math.round(r.gainHi)}` }],
    decline: [C.page, before, now, chg, cause],
    declineQ: [C.q, before, now, chg, cause],
    cannibal: [C.q, { k: 'pagesN', l: 'Competing pages', sort: false, f: r => r.pages.map(p => `${urlCell(p.p, CW.pathOf(p.p))} <small class="flat">${p.share.toFixed(0)}% · #${p.pos.toFixed(1)}</small>`).join('<br>'), csv: r => r.pages.map(p => p.p).join(' | ') }, C.impr, C.pos, { k: 'loss', l: 'At stake / month (up to)', r: 1, f: r => r.loss >= 1 ? fmtN(r.loss) : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }],
    cannibalEst: [{ k: 'q', l: 'Similar searches', cls: 'q', f: r => (r.variants || []).slice(0, 4).map(v => `${esc(v.q)} <small class="flat">#${v.pos.toFixed(1)}</small>`).join('<br>'), csv: r => (r.variants || []).map(v => v.q).join(' | ') }, C.impr, { k: 'spread', l: 'Position spread', r: 1, f: r => r.spread.toFixed(1) }, { k: 'loss', l: 'At stake / month (up to)', r: 1, f: r => r.loss >= 1 ? fmtN(r.loss) : '—' }, { k: 'sevN', l: 'Severity', f: r => sevTag(r.sev), csv: r => r.sev }],
    links: [{ k: 'path', l: 'Page to strengthen', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p }, C.pos, C.impr, { k: 'anchor', l: 'Suggested anchor text', f: r => r.anchor ? `“${esc(r.anchor)}”` : '<span class="flat">Use the page’s main topic</span>' }, { k: 'src', l: 'Link to it from', sort: false, f: r => r.sources.map(s => `${urlCell(s.p, s.path)}${s.why ? `<br><small class="flat">${esc(s.why)}</small>` : ''}`).join('<br>'), csv: r => r.sources.map(s => s.p).join(' | ') }],
    queries: [C.q, C.clicks, C.impr, C.ctr, C.pos],
    setAside: [C.page, C.impr, C.ctr, C.pos, { k: 'why', l: 'Why it was set aside', sort: false, f: r => `${esc(r.flag.reason)}${r.flag.certain ? '' : ' <span class="tag">unconfirmed</span>'}`, csv: r => r.flag.reason }, { k: 'inc', l: '', sort: false, csv: false, f: r => `<button type="button" class="btn-quiet" data-keep="${esc(r.p)}">Include</button>` }]
  };

  V.wf = (A, D, id) => {
    const w = W.byId(id);
    if (!w) return { html: head('Workflow not found', 'That workflow does not exist.') + '<p><a href="#workflows">Back to workflows</a></p>' };
    Object.keys(TABLES).filter(k => k.startsWith('t-wf')).forEach(k => delete TABLES[k]);
    const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#workflows">Workflows</a><span class="sep">/</span><span>${esc(w.name)}</span></nav>`;
    const top = crumbs + `<header class="v-head wf-head"><div><h1>${esc(w.name)}</h1><p>${esc(w.finds)}</p></div><button type="button" class="btn-quiet no-print" id="wf-save">${svg('save')}Save</button></header>
      <p class="wf-meta no-print">${svg('clock')}${esc(dataLabel(D))} · ${esc(rangeLabel(D))}${A.ignored && A.ignored.length ? ` · ignoring searches with: ${esc(A.ignored.join(', '))}` : ''}</p>`;
    const out = W.run(id, A, { site: D.site, terms: id === 'ignore' ? (params().get('terms') || '').split(',') : null });
    const saveMount = () => { const b = document.getElementById('wf-save'); if (b) b.addEventListener('click', () => flash(b, saveItem(A, { type: 'workflow', wf: w.id, name: w.name }) ? 'Saved' : 'Could not save')); };
    if (out.missing) return {
      html: top + `<div class="note warn"><b>This workflow needs more data.</b><ul>${out.missing.map(m => `<li><b>${esc(m.label)}.</b> ${esc(m.how)}</li>`).join('')}</ul>${D.source !== 'demo' ? '<button type="button" class="btn-quiet" data-demo>Try it on sample data</button>' : ''}</div>`, mount: saveMount
    };
    if (out.error) return { html: top + `<div class="note warn" role="alert">${esc(out.error)}</div>`, mount: saveMount };
    const steps = w.steps ? `<ol class="wf-steps">${w.steps.map(s => `<li>${svg('check')}${esc(s)}</li>`).join('')}</ol>` : '';
    const strip = out.stats && out.stats.length ? `<div class="strip">${out.stats.map(s => stat(String(s.v), s.l, s.tone)).join('')}</div>` : '';
    let body = '', mount = () => { };

    if (out.spec) {
      body = `<p class="wf-sum">${esc(out.summary)}</p>${strip}${resultBlock('t-wf', out.spec, out.result, 'workflow-' + id)}
        ${out.setAside && out.setAside.length ? `<section class="panel"><div class="panel-h"><h2>Set aside (${out.setAside.length})</h2><p>Probably branded sitelinks or utility pages, where a title rewrite rarely helps. Include any that are real landing pages.</p></div>${table('t-wf-sa', COLS.setAside, out.setAside, { sort: 'impr', file: 'workflow-' + id + '-set-aside', search: false, pageSize: 10 })}</section>` : ''}
        <p class="no-print"><a href="#filters?spec=${encodeURIComponent(JSON.stringify(out.spec))}">Adjust these conditions in Smart filters</a></p>`;
      mount = () => { mountResult('t-wf', out.result); if (out.setAside && out.setAside.length) drawTable('t-wf-sa'); };
    } else if (id === 'report') {
      body = reportHtml(A, D, out.report); mount = () => reportMount(A, D);
    } else if (id === 'ignore') {
      const cur = (A.ignored || []).join(', ');
      body = `<section class="panel"><div class="panel-b">
          <label class="field"><span>Words to leave out, separated by commas</span><textarea id="ig-in" rows="2" maxlength="1000" placeholder="e.g. jobs, salary, competitor name">${esc(params().get('terms') || cur)}</textarea></label>
          <p class="sf-or">Common ones: ${['jobs', 'careers', 'salary', 'login', 'free download', 'reddit', 'wikipedia'].map(t => `<button type="button" class="chip-ex" data-ig="${esc(t)}">${esc(t)}</button>`).join('')}</p>
          <div class="wf-actions"><button type="button" class="btn-quiet" id="ig-prev">Preview</button><button type="button" class="btn-primary sm" id="ig-save">Save and recalculate</button>${cur ? '<button type="button" class="btn-quiet" id="ig-clear">Stop ignoring</button>' : ''}</div>
        </div></section>
        <p class="wf-sum">${esc(out.summary)}</p>${strip}
        ${out.table ? `<section class="panel">${table('t-wf', COLS.queries, out.table.rows, { sort: 'impr', file: 'ignored-searches', pageSize: 25 })}</section>` : ''}`;
      mount = () => {
        const ta = document.getElementById('ig-in');
        const terms = () => ta.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
        document.querySelectorAll('[data-ig]').forEach(b => b.addEventListener('click', () => { const t = terms(); if (!t.includes(b.dataset.ig)) ta.value = t.concat(b.dataset.ig).join(', '); }));
        document.getElementById('ig-prev').addEventListener('click', () => { setParams('wf=ignore', { terms: terms().join(',') }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
        document.getElementById('ig-save').addEventListener('click', () => { document.dispatchEvent(new CustomEvent('cw:ignore', { detail: terms() })); });
        const c = document.getElementById('ig-clear'); if (c) c.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('cw:ignore', { detail: [] })); });
        if (out.table) drawTable('t-wf');
      };
    } else {
      const t = out.table;
      body = steps + `<p class="wf-sum">${esc(out.summary)}</p>${strip}` +
        (t ? `<section class="panel">${table('t-wf', COLS[t.cols], t.rows, { sort: t.sort, file: 'workflow-' + id, pageSize: 25, searchKeys: t.cols === 'quickwins' ? ['item'] : t.cols === 'links' || t.cols === 'decline' ? ['path'] : ['q'], empty: 'Nothing found in this data.' })}</section>` : '') +
        (out.extra ? `<section class="panel"><div class="panel-h"><h2>${esc(out.extra.title)}</h2></div>${table('t-wf-x', COLS[out.extra.cols], out.extra.rows, { sort: out.extra.sort, file: 'workflow-' + id + '-searches', pageSize: 25 })}</section>` : '') +
        (out.plan && out.plan.length ? `<section class="panel"><div class="panel-h"><h2>Action plan</h2><p>The same findings grouped into a few bigger tasks.</p></div>${ledger(out.plan)}</section>` : '') +
        (id === 'cannibal' ? '<div class="note"><b>Before you change anything.</b> Search for each query and check whether both pages really serve the same intent. Merge with a 301 only when they do; otherwise make each page target a clearly different angle.</div>' : '') +
        (id === 'quickwins' ? methodNote(A) : '') +
        (id === 'links' ? `<div class="note"><b>How the sources are chosen.</b> ${A.content && A.content.mode === 'search' ? 'Each source already ranks on page one for a search in the same topic as the target, and the anchor text is the target\'s own search.' : 'Without search-to-page data, sources are the strongest pages in the same folder.'} ${A.content && A.content.inlinks ? 'Links that already exist in your crawler export were removed.' : 'Search Console has no link data: <a href="#content?tab=links">upload a crawler export</a> to drop links that already exist.'}</div>` : '');
      mount = () => { if (t) drawTable('t-wf'); if (out.extra) drawTable('t-wf-x'); };
    }
    return { html: top + body, mount: () => { saveMount(); mount(); } };
  };

  // ── white-label report ──
  // Page 1: a summary a manager can read in a minute. Page 2 (optional): details. Branding from CW_REPORT.
  function reportHtml(A, D, r) {
    const RP = window.CW_REPORT, b = RP.load(D.site);
    const st = A.site, ps = A.prevSite, ink = RP.onColor(b.color);
    const client = b.client || D.site;
    const d = (c, p, inv) => { if (!p) return ''; const v = (c - p) / p * 100; const good = inv ? v < 0 : v > 0; return `<span class="rp-d ${Math.abs(v) < 0.5 ? '' : good ? 'up' : 'down'}">${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v).toFixed(1)}%</span>`; };
    const acts = RP.topActions(A);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const by = b.agency ? `Prepared by ${esc(b.agency)}${b.contact ? ` · ${esc(b.contact)}` : ''}` : '';
    const panel = `<details class="panel rp-brand no-print" ${b.agency || b.client ? '' : 'open'}><summary><b>Branding</b> <span class="flat">${b.agency ? esc(b.agency) : 'Add your agency name, logo and colour'}${b.client ? ` · for ${esc(b.client)}` : ''}</span></summary>
      <form class="rp-form" id="rp-form" autocomplete="off">
        <fieldset><legend>Your agency (used for every client)</legend>
          <label class="field"><span>Agency name</span><input id="rp-agency" maxlength="${RP.LIMIT.agency}" value="${esc(b.agency)}" placeholder="e.g. Northstar SEO"></label>
          <label class="field"><span>Contact line</span><input id="rp-contact" maxlength="${RP.LIMIT.contact}" value="${esc(b.contact)}" placeholder="e.g. hello@northstar.in · +91 …"></label>
          <label class="field rp-c"><span>Brand colour</span><input id="rp-color" type="color" value="${esc(b.color)}"></label>
          <div class="field"><span>Agency logo</span><div class="rp-logo">${b.logo ? `<img src="${b.logo}" alt="Agency logo">` : '<span class="flat">None</span>'}<label class="btn-quiet">Choose image<input type="file" id="rp-logo" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${b.logo ? '<button type="button" class="btn-link" id="rp-logo-x">Remove</button>' : ''}</div></div>
          <label class="check"><input type="checkbox" id="rp-cw" ${b.showClickwise ? 'checked' : ''}> Show “Made with Clickwise” in the footer</label>
        </fieldset>
        <fieldset><legend>This client (${esc(D.site)})</legend>
          <label class="field"><span>Client name on the report</span><input id="rp-client" maxlength="${RP.LIMIT.client}" value="${esc(b.client)}" placeholder="${esc(D.site)}"></label>
          <div class="field"><span>Client logo</span><div class="rp-logo">${b.clientLogo ? `<img src="${b.clientLogo}" alt="Client logo">` : '<span class="flat">None</span>'}<label class="btn-quiet">Choose image<input type="file" id="rp-clogo" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${b.clientLogo ? '<button type="button" class="btn-link" id="rp-clogo-x">Remove</button>' : ''}</div></div>
          <label class="field"><span>Your notes for this client (shown on page one)</span><textarea id="rp-notes" rows="3" maxlength="${RP.LIMIT.notes}" placeholder="e.g. This month we rewrote 12 titles and launched the pricing page.">${esc(b.notes)}</textarea></label>
          <label class="check"><input type="checkbox" id="rp-details" ${b.details ? 'checked' : ''}> Add a second page with details</label>
        </fieldset>
        <div class="rp-act"><button type="submit" class="btn-primary sm">Save branding</button><span class="sf-err" id="rp-err" role="alert"></span><span class="flat">Saved in this browser only. Logos are redrawn as small PNG images.</span></div>
      </form></details>`;
    const li = (items, f) => items && items.length ? `<ol class="rep-list">${items.map(f).join('')}</ol>` : '<p class="flat">Nothing to report.</p>';
    const page1 = `<section class="rp-page" style="--rp:${b.color};--rp-ink:${ink}">
        <header class="rp-head"><div class="rp-who">${b.logo ? `<img class="rp-alogo" src="${b.logo}" alt="${esc(b.agency || 'Agency')} logo">` : b.agency ? `<b class="rp-aname">${esc(b.agency)}</b>` : ''}</div>
          <div class="rp-title"><h2>SEO report: ${esc(client)}</h2><p>${esc(rangeLabel(D))}${ps && D.prevStart ? ` · compared with ${esc(D.prevStart)}${D.prevEnd ? ' – ' + esc(D.prevEnd) : ''}` : ''}${r.sample ? ' · Sample data, fictional site' : ''}</p></div>
          <div class="rp-who r">${b.clientLogo ? `<img class="rp-clogo" src="${b.clientLogo}" alt="${esc(client)} logo">` : ''}</div></header>
        <div class="rp-kpis">
          <div><b>${fmtN(st.clicks)}</b><span>Clicks from Google</span>${d(st.clicks, ps && ps.clicks)}</div>
          <div><b>${fmtN(st.impr)}</b><span>Times shown in Google</span>${d(st.impr, ps && ps.impr)}</div>
          <div><b>${pctf(st.ctr, 2)}</b><span>Click-through rate</span>${ps ? `<span class="rp-d ${st.ctr >= ps.ctr ? 'up' : 'down'}">${st.ctr >= ps.ctr ? '▲' : '▼'} ${Math.abs(st.ctr - ps.ctr).toFixed(2)} pts</span>` : ''}</div>
          <div><b>${st.pos.toFixed(1)}</b><span>Average position</span>${ps && ps.pos ? `<span class="rp-d ${st.pos <= ps.pos ? 'up' : 'down'}">${st.pos <= ps.pos ? '▲ better' : '▼ worse'} by ${Math.abs(st.pos - ps.pos).toFixed(1)}</span>` : ''}</div>
        </div>
        <div class="rp-cols">
          <div><h3>What changed</h3><ul>${RP.changed(A).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <h3>Where the growth is</h3><p>${r.potential.hi >= 1 ? `Searches the site already ranks for could bring roughly <b>${fmtN(r.potential.lo)}–${fmtN(r.potential.hi)} more clicks a month</b>.` : 'No clear click opportunities in searches the site already ranks for.'}${r.recovery && r.recovery.n ? ` Pages that lost clicks could win back about <b>${fmtN(r.recovery.lo)}–${fmtN(r.recovery.hi)} a month</b>.` : ''}</p>
            ${b.notes ? `<h3>Notes from ${esc(b.agency || 'us')}</h3><p class="rp-notes">${esc(b.notes)}</p>` : ''}</div>
          <div><h3>Top 5 things to do next</h3>${acts.length ? `<ol class="rp-acts">${acts.map(it => `<li><b>${esc(it.subject.label)}</b> <span class="flat">${esc(it.typeLabel)} · ${esc(it.effort.level.toLowerCase())} effort${it.impact.hi >= 1 ? ` · ${range(it.impact.lo, it.impact.hi)} clicks/month` : ''}</span><br>${esc(it.action)}</li>`).join('')}</ol>` : '<p class="flat">No actions with enough confidence in this data.</p>'}
            <h3>Results of recent changes</h3><div id="rp-fixes"><p class="flat">Checking tracked changes…</p></div></div>
        </div>
        <footer class="rp-foot">${by ? `<span>${by}</span>` : ''}<span>${esc(today)}</span><span>Click figures for the future are estimates for prioritising, not guarantees.</span>${b.showClickwise ? '<span>Made with Clickwise</span>' : ''}</footer>
      </section>`;
    const page2 = !b.details ? '' : `<section class="rp-page rp-p2" style="--rp:${b.color};--rp-ink:${ink}">
        <header class="rp-head slim"><div class="rp-title"><h2>Details: ${esc(client)}</h2><p>${esc(rangeLabel(D))}</p></div></header>
        <div class="rp-cols">
          <div><h3>Biggest declines</h3>${r.declines ? li(r.declines, x => `<li>${esc(x.path)}: ${fmtN(x.prev.clicks)} → ${fmtN(x.cur.clicks)} clicks <span class="flat">(${esc(x.reason)})</span></li>`) : '<p class="flat">Needs a comparison period.</p>'}
            <h3>Closest to the top 3</h3>${li(r.quick, x => `<li>${esc(x.q)}: position ${x.pos.toFixed(1)}, ${fmtN(x.impr)} impressions, ${range(x.gainLo, x.gainHi)} clicks a month</li>`)}</div>
          <div>${r.content && r.content.nGaps ? `<h3>Content gaps (${r.content.nGaps})</h3>${li(r.content.gaps, g => `<li>${esc(g.label)}: ${fmtN(g.impr)} impressions <span class="flat">(${esc(g.evidence[0])})</span></li>`)}` : ''}
            ${r.content && r.content.nLinks ? `<h3>Internal links to add (${r.content.nLinks})</h3>${li(r.content.links, l => `<li>${esc(l.path)} ← ${l.sources.map(x => esc(x.path)).join(', ')}${l.anchor ? ` <span class="flat">anchor “${esc(l.anchor)}”</span>` : ''}</li>`)}` : ''}
            ${A.titles && A.titles.rows.length ? `<h3>Titles and descriptions</h3><p>${A.titles.rows.length} of ${A.titles.pages} crawled pages need attention${A.titles.kinds['title-query'] ? `; on ${A.titles.kinds['title-query']} the main search is missing from the title` : ''}${A.titles.dupTitles.length ? `; ${A.titles.dupTitles.length} groups of pages share a title` : ''}.</p>` : ''}
            <h3>AI search</h3><p>${r.ai.overview} top-5 searches get far fewer clicks than usual for their position (possible answer boxes or AI Overviews).</p></div>
        </div>
        <p class="rp-method">How the estimates work: expected clicks at each position come from this site's own click-through rates where there is enough data, and an industry curve elsewhere; each search is counted once; branded searches are left out. ${A.coverage && A.coverage.rowLimit ? 'This export lists only its top 1,000 searches and pages.' : ''}</p>
        <footer class="rp-foot">${by ? `<span>${by}</span>` : ''}<span>${esc(today)}</span>${b.showClickwise ? '<span>Made with Clickwise</span>' : ''}</footer>
      </section>`;
    return `<div class="rp-bar no-print"><p>${b.agency ? 'Your branded report.' : 'Add your branding below, then print or save as PDF.'} In the print dialog choose <b>Save as PDF</b>, A4, and turn on <b>Background graphics</b> to keep the colours.</p><button type="button" class="btn-primary sm" id="rep-print">Print or save as PDF</button></div>${panel}<div class="report rp" id="report">${page1}${page2}</div>`;
  }
  function reportMount(A, D) {
    const RP = window.CW_REPORT;
    const b0 = RP.load(D.site), err = document.getElementById('rp-err');
    const pending = { logo: b0.logo, clientLogo: b0.clientLogo };
    const val = id => (document.getElementById(id) || {}).value || '';
    const collect = () => ({ agency: val('rp-agency'), contact: val('rp-contact'), color: val('rp-color'), client: val('rp-client'), notes: val('rp-notes'), logo: pending.logo, clientLogo: pending.clientLogo, showClickwise: document.getElementById('rp-cw').checked, details: document.getElementById('rp-details').checked });
    const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    const form = document.getElementById('rp-form');
    if (form) {
      form.addEventListener('submit', e => { e.preventDefault(); if (!RP.save(D.site, collect())) { err.textContent = 'Could not save (browser storage is off or full).'; return; } rerender(); });
      [['rp-logo', 'logo'], ['rp-clogo', 'clientLogo']].forEach(([id, key]) => {
        const inp = document.getElementById(id);
        inp.addEventListener('change', () => RP.readLogo(inp.files[0]).then(dataUrl => { pending[key] = dataUrl; if (!RP.save(D.site, collect())) { err.textContent = 'Could not save the logo (browser storage is full).'; return; } rerender(); }).catch(x => { err.textContent = x.message; }));
        const x = document.getElementById(id + '-x'); if (x) x.addEventListener('click', () => { pending[key] = null; RP.save(D.site, collect()); rerender(); });
      });
    }
    const p = document.getElementById('rep-print'); if (p) p.addEventListener('click', () => window.print());
    // tracked fixes and their measured results (the same numbers as the Fix tracker)
    const box = document.getElementById('rp-fixes'), S = window.CW_SOURCE, FV = window.CW_FIXVIEW;
    if (!box) return;
    if (!S || !FV) { box.innerHTML = '<p class="flat">No tracked changes.</p>'; return; }
    const fixes = FV.load(D.site).list.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    if (!fixes.length) { box.innerHTML = '<p class="flat">No changes tracked yet. Log them in the Fix tracker to show their results here.</p>'; return; }
    Promise.all(fixes.map(f => FV.measureFix(f, S).catch(e => ({ fix: f, error: e.message })))).then(rs => {
      if (!box.isConnected) return;
      box.innerHTML = `<ul class="rp-fx">${rs.map(r => `<li><b>${esc(r.fix.scope === 'site' ? 'Whole site' : r.fix.path)}</b> <span class="flat">changed ${esc(r.fix.date)}${r.fix.note ? ': ' + esc(r.fix.note) : ''}</span><br>${r.error ? `<span class="flat">${esc(r.error)}</span>` : `${esc(window.CW_FIXES.label(r))}${r.before ? ` · ${r.before.perDay.toFixed(1)} → ${r.after.perDay.toFixed(1)} clicks a day${r.relative != null ? ` (${r.relative > 0 ? '+' : ''}${r.relative.toFixed(0)}% against the site)` : ''}` : ''}`}</li>`).join('')}</ul>`;
    });
  }
})();
