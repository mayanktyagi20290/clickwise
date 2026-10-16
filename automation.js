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
    const cols = [spec.target === 'page' ? C.page : C.q, C.clicks, C.impr, C.ctr, { ...C.pos, f: r => r.gone ? '<span class="flat">Gone</span>' : posTag(r.pos) }];
    if (uses('ctrGap')) cols.push({ k: 'bench', l: 'Expected CTR', r: 1, f: r => r.gone ? '—' : pctf(r.bench) });
    if (uses('clickChange')) cols.push({ k: 'prevClicks', l: 'Clicks before', r: 1, f: r => fmtN(r.prevClicks) }, { k: 'clickChange', l: 'Change', r: 1, f: changeCell });
    if (spec.target === 'page' && spec.group !== 'pageType') cols.push({ k: 'pageType', l: 'Page type', f: r => `<span class="tag">${esc(r.pageType)}</span>`, csv: r => r.pageType });
    if ((uses('location') || spec.group === 'location') && spec.group !== 'location') cols.push({ k: 'place', l: 'Place', f: r => r.place ? `<span class="tag">${esc(r.place)}</span>` : '—', csv: r => r.place || '' });
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

  // ════════ Smart filters ════════
  const FIELD_NAME = { place: 'Place', clicks: 'Clicks', impr: 'Impressions', ctr: 'CTR (%)', pos: 'Position', ctrGap: 'Share of expected clicks (%)', clickChange: 'Change in clicks (%)', words: 'Words in the search', text: null, section: 'Folder', pageType: 'Page type', brand: 'Branded', question: 'Is a question', location: 'Mentions a place', intent: 'Intent' };
  const OP_NAME = { gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', between: 'between', contains: 'contains', notContains: "doesn't contain", startsWith: 'starts with', endsWith: 'ends with', equals: 'is exactly', word: 'has the word', is: 'is', not: 'is not' };
  const fieldName = (f, target) => FIELD_NAME[f] || (target === 'page' ? 'URL' : 'Search text');
  let CUR = null;

  V.filters = (A) => {
    const html = head('Smart filters', 'Describe what you want to find in plain English. Clickwise turns it into a filter, checks it, and shows the matching searches or pages — no patterns or formulas needed.') +
      `<section class="panel sf">
        <form class="sf-box" id="sf-form" autocomplete="off">
          ${svg('spark')}<input id="sf-in" type="text" maxlength="300" placeholder="e.g. Pages with high impressions but not enough clicks" aria-label="Describe what you want to find">
          <button class="btn-primary" type="submit">Find</button>
        </form>
        <div class="sf-ex"><span>Try</span>${F.EXAMPLES.map(e => `<button type="button" class="chip-ex" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <p class="sf-or">Prefer to pick options? <button type="button" class="btn-link" id="sf-build">Build a filter step by step</button></p>
      </section>
      <div id="sf-out" aria-live="polite"></div>`;
    const mount = () => {
      const inp = document.getElementById('sf-in');
      const go = text => { text = text.trim(); if (!text) { inp.focus(); return; } const p = F.parse(text, A); CUR = { spec: p.spec, text, parsed: p }; setParams('filters', { q: text }); render(A); };
      document.getElementById('sf-form').addEventListener('submit', e => { e.preventDefault(); go(inp.value); });
      document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { inp.value = b.dataset.ex; go(b.dataset.ex); }));
      document.getElementById('sf-build').addEventListener('click', () => { CUR = { spec: { target: 'query', conds: [], group: null }, text: '', parsed: null }; setParams('filters'); render(A); setTimeout(() => { const f = document.getElementById('sf-f'); if (f) f.focus(); }, 0); });
      const prm = params();
      if (prm.get('q')) { inp.value = prm.get('q').slice(0, 300); go(inp.value); }
      else if (prm.get('saved')) {
        const s = savedList(A).find(x => x.id === prm.get('saved'));
        if (s && s.spec) { inp.value = s.text || ''; CUR = { spec: s.spec, text: s.text || '', parsed: null, name: s.name }; render(A); }
      } else if (prm.get('spec')) {
        let spec = null; try { spec = JSON.parse(prm.get('spec')); } catch (e) { }
        CUR = spec && typeof spec === 'object' ? { spec: { target: spec.target, conds: Array.isArray(spec.conds) ? spec.conds : [], group: spec.group || null, caseSensitive: !!spec.caseSensitive }, text: '', parsed: null } : null;
        if (CUR) render(A);
      } else if (CUR) { inp.value = CUR.text || ''; render(A); }
    };
    return { html, mount };
  };

  function render(A) {
    const out = document.getElementById('sf-out'); if (!out || !CUR) return;
    const D = A.data || {};
    const R = F.rows(A);
    const spec = CUR.spec, p = CUR.parsed;
    Object.keys(TABLES).filter(k => k.startsWith('t-sf')).forEach(k => delete TABLES[k]);
    if (p && !p.understood) {
      out.innerHTML = `<div class="note warn"><b>I couldn't turn that into a filter.</b> ${p.unknown.length ? `I didn't recognise: ${p.unknown.slice(0, 8).map(w => `<span class="tag">${esc(w)}</span>`).join(' ')}. ` : ''}Try one of the examples, mention a number (“more than 500 impressions”), a position (“positions 4 to 20”), or a word to look for in quotes (“containing "price"”).</div>`;
      return;
    }
    const errs = F.validate(spec, R);
    const res = errs.length ? null : F.run(spec, A);
    const chips = spec.conds.map((c, i) => `<span class="chip">${esc(F.chip(c, spec.target))}<button type="button" data-rm="${i}" aria-label="Remove: ${esc(F.chip(c, spec.target))}">${svg('x')}</button></span>`).join('');
    const groupOpts = Object.entries(F.GROUPS).filter(([k]) => spec.target === 'page' ? ['pageType', 'folder', 'location'].includes(k) : ['brand', 'intent', 'location'].includes(k));
    const recipe = F.gscRecipe(spec, A);
    out.innerHTML = `
      <section class="panel">
        <div class="panel-h"><h2>${p ? 'What Clickwise understood' : 'Your filter'}</h2><p>Remove anything that's wrong or add a condition. Results update straight away.</p></div>
        <div class="panel-b sf-edit">
          <div class="sf-row"><span class="sf-lbl">Look at</span>
            <div class="seg" role="group" aria-label="Look at"><button type="button" data-target="query" class="${spec.target === 'query' ? 'on' : ''}">Searches</button><button type="button" data-target="page" class="${spec.target === 'page' ? 'on' : ''}">Pages</button></div>
            <label class="sf-group"><span class="sf-lbl">Group by</span><select id="sf-grp"><option value="">Nothing</option>${groupOpts.map(([k, l]) => `<option value="${k}" ${spec.group === k ? 'selected' : ''}>${esc(l.charAt(0).toUpperCase() + l.slice(1))}</option>`).join('')}</select></label>
          </div>
          <div class="chips">${chips || '<span class="flat">No conditions yet — showing everything.</span>'}</div>
          ${p && p.unknown.length ? `<p class="sf-warn">Ignored words I didn't recognise: ${p.unknown.slice(0, 8).map(w => `<span class="tag">${esc(w)}</span>`).join(' ')}</p>` : ''}
          ${p && p.notes.includes('date') ? `<p class="sf-info">Dates: this uses the range you loaded (${esc(rangeLabel(D))}). To look at a different period, start a new analysis with that range.</p>` : ''}
          ${CUR.dropped ? `<p class="sf-info">Removed because they don't apply here: ${esc(CUR.dropped)}.</p>` : ''}
          <div class="builder" id="sf-add">
            <span class="sf-lbl">Add</span>
            <select id="sf-f" aria-label="What to check">${Object.keys(F.FIELDS).filter(f => F.FIELDS[f].on.includes(spec.target) && (F.FIELDS[f].needs !== 'prev' || R.hasPrev)).map(f => `<option value="${f}">${esc(fieldName(f, spec.target))}</option>`).join('')}</select>
            <select id="sf-op" aria-label="How to compare"></select>
            <span id="sf-v" class="sf-v"></span>
            <button type="button" class="btn-quiet" id="sf-addbtn">${svg('plus')}Add</button>
            <span class="sf-err" id="sf-adderr" role="alert"></span>
          </div>
          <details class="sf-adv">
            <summary>Advanced</summary>
            <label class="check"><input type="checkbox" id="sf-cs" ${spec.caseSensitive ? 'checked' : ''}> Match capital letters exactly (useful for URLs; Search Console lowercases queries)</label>
            <div class="sf-recipe"><h4>Recreate this in Search Console</h4>
              ${recipe.steps.length ? `<p>Performance › Search results › <b>+ Add filter</b>, then:</p><table><thead><tr><th>Filter</th><th>Choose</th><th>Value</th><th></th></tr></thead><tbody>${recipe.steps.map((s, i) => `<tr><td>${esc(s[0])}</td><td>${esc(s[1])}</td><td><code id="sf-rc-${i}">${esc(s[2])}</code></td><td><button type="button" class="btn-quiet" data-copy="sf-rc-${i}">Copy</button></td></tr>`).join('')}</tbody></table>` : '<p>Nothing to set up: this filter uses only Clickwise calculations.</p>'}
              ${recipe.skipped.length ? `<p class="flat">Search Console can't do these, so they only apply here: ${recipe.skipped.map(esc).join('; ')}.</p>` : ''}
            </div>
          </details>
        </div>
      </section>
      ${errs.length ? `<div class="note warn" role="alert"><b>This filter can't run yet.</b><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : `
        <p class="sf-say">${esc(F.describe(spec))} <b>${res.rows.length.toLocaleString()} ${spec.target === 'page' ? (res.rows.length === 1 ? 'page' : 'pages') : (res.rows.length === 1 ? 'search' : 'searches')}</b> in ${esc(dataLabel(D).toLowerCase())}.</p>
        <div class="strip">${stat(res.rows.length.toLocaleString(), spec.target === 'page' ? 'pages' : 'searches', 'gain')}${stat(fmtN(res.total.clicks), 'clicks')}${stat(fmtN(res.total.impr), 'impressions')}${stat(pctf(res.total.ctr), 'CTR')}${res.lost > 0 && spec.conds.some(c => c.f === 'clickChange') ? stat('−' + fmtN(res.lost), 'clicks lost', 'risk') : ''}</div>
        <div class="sf-save"><input id="sf-name" type="text" maxlength="80" value="${esc((CUR.name || CUR.text || F.describe(spec)).slice(0, 80))}" aria-label="Name for this filter"><button type="button" class="btn-quiet" id="sf-savebtn">${svg('save')}Save to workflows</button></div>
        ${resultBlock('t-sf', spec, res, 'smart-filter')}`}`;

    // ── wire up ──
    const rerender = () => { setParams('filters', { spec: JSON.stringify(CUR.spec) }); CUR.parsed = CUR.parsed && { ...CUR.parsed, unknown: [], notes: CUR.parsed.notes }; render(A); };
    out.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { CUR.spec = { ...spec, conds: spec.conds.filter((_, i) => i !== +b.dataset.rm) }; CUR.dropped = null; rerender(); }));
    out.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.target; if (t === spec.target) return;
      const keep = spec.conds.filter(c => F.FIELDS[c.f].on.includes(t));
      const drop = spec.conds.filter(c => !F.FIELDS[c.f].on.includes(t)).map(c => F.chip(c, spec.target));
      CUR.spec = { ...spec, target: t, conds: keep, group: null }; CUR.dropped = drop.join('; ') || null; rerender();
    }));
    document.getElementById('sf-grp').addEventListener('change', e => { CUR.spec = { ...spec, group: e.target.value || null }; rerender(); });
    document.getElementById('sf-cs').addEventListener('change', e => { CUR.spec = { ...spec, caseSensitive: e.target.checked }; rerender(); });
    builder(A, spec, R, cond => { CUR.spec = { ...spec, conds: spec.conds.concat([cond]) }; CUR.dropped = null; rerender(); });
    const sb = document.getElementById('sf-savebtn');
    if (sb) sb.addEventListener('click', () => {
      const name = document.getElementById('sf-name').value.trim() || F.describe(spec);
      const ok = saveItem(A, { type: 'filter', name: name.slice(0, 80), text: CUR.text || '', spec: CUR.spec });
      flash(sb, ok ? 'Saved — find it under Workflows' : 'Could not save (browser storage is off)');
    });
    if (res) mountResult('t-sf', res);
  }

  function builder(A, spec, R, onAdd) {
    const fSel = document.getElementById('sf-f'), opSel = document.getElementById('sf-op'), vBox = document.getElementById('sf-v'), err = document.getElementById('sf-adderr');
    if (!fSel) return;
    const enumValues = f => f === 'intent' ? Object.entries(CW.INTENT_LABEL) : f === 'pageType' ? R.types.map(t => [t, t]) : f === 'section' ? R.folders.map(x => [x, x]) : f === 'place' ? R.places[spec.target].map(x => [x, x]) : [];
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
    drawOps();
    const submit = () => {
      const f = fSel.value, kind = F.FIELDS[f].kind, op = kind === 'bool' ? 'is' : opSel.value;
      const v1 = document.getElementById('sf-v1'), v2 = document.getElementById('sf-v2');
      if (!v1) { err.textContent = 'Nothing to choose here.'; return; }
      let cond;
      if (kind === 'num') cond = op === 'between' ? { f, op, v: parseFloat(v1.value), v2: parseFloat(v2.value) } : { f, op, v: parseFloat(v1.value) };
      else if (kind === 'text') cond = { f, op, v: v1.value.trim() };
      else if (kind === 'bool') cond = { f, op, v: v1.value === '1' };
      else cond = { f, op, v: v1.value };
      const errs = F.validate({ ...spec, conds: [cond] }, R);
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
        <div class="panel-b flush"><table><tbody>${saved.map(s => `<tr><td><span class="tag ${s.type === 'filter' ? '' : 'gain'}">${s.type === 'filter' ? 'Smart filter' : 'Workflow'}</span></td><td>${esc(s.name)}</td><td class="r"><a class="btn-quiet" href="${s.type === 'filter' ? '#filters?saved=' + encodeURIComponent(s.id) : '#wf=' + encodeURIComponent(s.wf)}">Run</a> <button type="button" class="btn-quiet" data-unsave="${esc(s.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div></section>` : '') +
      `<div class="wf-grid">${W.TEMPLATES.map(card).join('')}</div>
       <div class="note"><b>Need something else?</b> <a href="#filters">Describe it in Smart filters</a> — for example “commercial keywords on page two” — and save it here as your own workflow.</div>`;
    const mount = () => {
      document.querySelectorAll('[data-savewf]').forEach(b => b.addEventListener('click', () => {
        const w = W.byId(b.dataset.savewf);
        flash(b, saveItem(A, { type: 'workflow', wf: w.id, name: w.name }) ? 'Saved' : 'Could not save');
        setTimeout(() => { if (location.hash === '#workflows') window.dispatchEvent(new HashChangeEvent('hashchange')); }, 900);
      }));
      document.querySelectorAll('[data-unsave]').forEach(b => b.addEventListener('click', () => { removeItem(A, b.dataset.unsave); window.dispatchEvent(new HashChangeEvent('hashchange')); }));
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
    links: [{ k: 'path', l: 'Page to strengthen', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p }, C.pos, C.impr, { k: 'anchor', l: 'Suggested anchor text', f: r => r.anchor ? `“${esc(r.anchor)}”` : '<span class="flat">Use the page’s main topic</span>' }, { k: 'src', l: 'Link to it from', sort: false, f: r => r.sources.map(s => urlCell(s.p, s.path)).join('<br>'), csv: r => r.sources.map(s => s.p).join(' | ') }],
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
      body = reportHtml(A, D, out.report); mount = () => { const b = document.getElementById('rep-print'); if (b) b.addEventListener('click', () => window.print()); };
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
        (id === 'links' ? '<div class="note"><b>How the sources are chosen.</b> Your best-ranking pages in the same folder, or the strongest pages on the site when the folder has none. Search Console has no link data, so check what already links to each page before adding more.</div>' : '');
      mount = () => { if (t) drawTable('t-wf'); if (out.extra) drawTable('t-wf-x'); };
    }
    return { html: top + body, mount: () => { saveMount(); mount(); } };
  };

  function reportHtml(A, D, r) {
    const li = (items, f) => items && items.length ? `<ol class="rep-list">${items.map(f).join('')}</ol>` : '<p class="flat">Nothing to report.</p>';
    const st = r.site, cov = r.coverage, nb = A.totNB;
    return `<section class="panel report" id="report">
      <div class="rep-h"><div><h2>SEO opportunity report</h2><p>${esc(D.site)} · ${esc(rangeLabel(D))}${r.sample ? ' · <b>Sample data, fictional site</b>' : ''}</p></div><button type="button" class="btn-primary sm no-print" id="rep-print">Print or save as PDF</button></div>
      ${cov ? `<section class="tiles" aria-label="Whole-site performance">
        <div class="tile t-blue"><div class="tile-v">${fmtN(st.clicks)}</div><div class="tile-l">Clicks, all searches</div></div>
        <div class="tile t-green"><div class="tile-v">${fmtN(st.impr)}</div><div class="tile-l">Impressions, all searches</div></div>
        <div class="tile t-amber"><div class="tile-v">${pctf(st.ctr, 2)}</div><div class="tile-l">CTR</div></div>
        <div class="tile t-red"><div class="tile-v">${st.pos.toFixed(1)}</div><div class="tile-l">Avg. position</div></div>
      </section>` : ''}
      <div class="rep-b">
        <p>Non-branded searches${cov ? ` in this data (query rows cover ${cov.q.clicks.toFixed(1)}% of clicks${cov.rowLimit ? `; the export lists the top ${cov.rowsQ.toLocaleString()} queries` : ''})` : ''}: <b>${fmtN(nb.clicks)}</b> clicks, ${fmtN(nb.impr)} impressions, ${pctf(nb.ctr, 2)} CTR, position ${nb.pos.toFixed(1)}${A.prev ? `; clicks ${tileDelta(nb.clicks, A.prev.nb.clicks).replace(/<[^>]+>/g, '').trim()}` : ''}.</p>
        <p class="rep-lead">${r.potential.hi >= 1 ? `Searches already ranking could bring roughly <b>${fmtN(r.potential.lo)}–${fmtN(r.potential.hi)} more clicks a month</b> (estimate; each search counted once; branded searches, ${r.brandShare.toFixed(0)}% of query clicks, excluded).` : 'No clear click opportunities in searches already ranking.'}</p>
        ${r.recovery && r.recovery.n ? `<p>Pages that lost clicks since the previous period could recover roughly <b>${fmtN(r.recovery.lo)}–${fmtN(r.recovery.hi)} clicks a month</b> if the decline is reversed (assumes 30–80% come back; ${r.recovery.n} page${r.recovery.n === 1 ? '' : 's'}).</p>` : ''}
        <h3>Top actions</h3>${ledger(r.plan)}
        ${r.top && r.top.length ? `<h3>Ten highest-value opportunities</h3><div class="tw"><table class="rep-t"><thead><tr><th scope="col">Opportunity</th><th scope="col" class="r">Clicks / month (est.)</th><th scope="col">Confidence</th><th scope="col">Effort</th><th scope="col">What to do</th></tr></thead><tbody>${r.top.map(it => `<tr><td><small class="flat">${esc(it.typeLabel)}</small><br>${esc(it.subject.label)}</td><td class="r">${range(it.impact.lo, it.impact.hi)}<br><small class="flat">${it.impact.kind === 'recovery' ? 'recovery' : 'growth'}${it.impact.counted ? '' : ', not in total'}</small></td><td>${esc(it.confidence.level)}</td><td>${esc(it.effort.level)}</td><td><small>${esc(it.action)}</small></td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="grid-2 even">
          <div><h3>Biggest declines</h3>${r.declines ? li(r.declines, x => `<li>${urlCell(x.p, x.path)} — ${fmtN(x.prev.clicks)} → ${fmtN(x.cur.clicks)} clicks <span class="flat">(${esc(x.reason)})</span></li>`) : '<p class="flat">Needs a comparison period.</p>'}</div>
          <div><h3>Closest to the top 3</h3>${li(r.quick, x => `<li>${esc(x.q)} — position ${x.pos.toFixed(1)}, ${fmtN(x.impr)} impressions, ${range(x.gainLo, x.gainHi)} clicks a month</li>`)}</div>
        </div>
        <h3>AI search</h3>
        <p>${r.ai.overview} top-5 searches get far fewer clicks than this site usually earns at that position (possible answer boxes or AI Overviews); ${r.ai.aiMode} top-3 searches get almost none. Directional AI-search readiness: <b>${r.ai.readiness}%</b>.</p>
        ${methodNote(A)}
        <p class="flat rep-foot">Generated by Clickwise from Search Console data. Estimates show priority, not guaranteed results.</p>
      </div>
    </section>`;
  }
})();
