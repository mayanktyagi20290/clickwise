// Clickwise "Content & links" screen: topic clusters, content gaps, page improvements, internal links, briefs.
// Everything shown comes from content.js, which works only from the loaded data.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { table, drawTable, TABLES, C, head, stat, pctf, posTag, urlCell, serp } = ui;
  const CW = window.CW, K = window.CW_CONTENT, fmtN = CW.fmtN;

  const TABS = [['topics', 'Topics'], ['gaps', 'Content gaps'], ['improve', 'Improve pages'], ['titles', 'Titles & metas'], ['links', 'Internal links'], ['briefs', 'Briefs']];
  const ISSUE = { status: 'Not a 200 page', noindex: 'Non-indexable', 'title-missing': 'No title', 'title-long': 'Title too long', 'title-short': 'Title short', 'title-dup': 'Duplicate title', 'title-query': 'Main search not in title', 'meta-missing': 'No meta description', 'meta-long': 'Meta too long', 'meta-short': 'Meta short', 'meta-dup': 'Duplicate meta', 'h1-missing': 'No H1', ctr: 'Low CTR' };
  const KIND = { unranked: 'Not on page one', homepage: 'Only the homepage ranks', scattered: 'Split across pages', diluted: 'Split with unrelated pages', nomatch: 'No matching page', questions: 'Unanswered questions' };
  const params = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  const pathCell = (url, path) => url ? urlCell(url, path) : '<span class="flat">New page</span>';
  let uploadMsg = null;
  document.addEventListener('cw:inlinks-error', e => { uploadMsg = { error: e.detail }; if (location.hash.startsWith('#content')) window.dispatchEvent(new HashChangeEvent('hashchange')); });

  V.content = (A, D) => {
    const K2 = A.content;
    if (!K2) return { html: head('Content & links', '') + (A.contentPending ? `<div class="note" role="status"><b>Grouping ${A.NBQ.length.toLocaleString()} searches into topics…</b> This runs in the background on large sites so the rest of the app stays usable. This page fills in by itself when it finishes.</div>` : '<p class="empty">Not available for this data.</p>') };
    Object.keys(TABLES).filter(k => k.startsWith('t-ct')).forEach(k => delete TABLES[k]);
    const tab = TABS.some(t => t[0] === params().get('tab')) ? params().get('tab') : 'gaps';
    const search = K2.mode === 'search';
    const modeNote = search
      ? 'Built from your searches and which page ranks for each one (Search Console connection).'
      : 'This export has no search-to-page data, so topics and gaps come from searches alone, page advice from each page\'s own position, and link sources from folders. Connect Search Console for page-level evidence.';
    const T = A.titles;
    const counts = { titles: T ? T.rows.length : 0, topics: K2.topics.filter(t => t.n > 1).length, gaps: K2.gaps.length, improve: K2.improvements.length, links: K2.links.length, briefs: K2.briefs.length };
    const nav = `<nav class="ct-tabs" aria-label="Content sections">${TABS.map(([k, l]) => `<a href="#content?tab=${k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-current="page"' : ''}>${esc(l)} <span class="count">${counts[k].toLocaleString()}</span></a>`).join('')}</nav>`;
    const crawl = K2.inlinks
      ? `<div class="note ct-crawl"><b>Existing links loaded:</b> ${K2.inlinks.count.toLocaleString()} link${K2.inlinks.count === 1 ? '' : 's'} between your pages from ${esc(K2.inlinks.name || 'your file')}. ${K2.alreadyLinked ? `${K2.alreadyLinked.toLocaleString()} suggested link${K2.alreadyLinked === 1 ? ' already exists and was' : 's already exist and were'} removed.` : 'None of the suggestions exist yet.'} Kept in this tab only; nothing is stored. <button type="button" class="btn-link" id="ct-clear">Remove the file</button></div>`
      : `<div class="note ct-crawl"><b>Links are not checked against your site yet.</b> Search Console has no link data. To drop links that already exist, upload your crawler's link export (Screaming Frog › Bulk Export › Links › All Inlinks, or any CSV with source and destination columns). It is read in this browser and not stored.
          <label class="btn-quiet ct-up">Upload link export (CSV)<input type="file" id="ct-file" accept=".csv,.tsv,.txt" hidden></label>${uploadMsg && uploadMsg.error ? `<span class="sf-err" role="alert">${esc(uploadMsg.error)}</span>` : ''}</div>`;
    const upMsg = uploadMsg && uploadMsg.error ? `<span class="sf-err" role="alert">${esc(uploadMsg.error)}</span>` : '';
    const pagesNote = T
      ? `<div class="note ct-crawl"><b>Page export loaded:</b> ${T.pages.toLocaleString()} page${T.pages === 1 ? '' : 's'} from ${esc(T.name || 'your file')}. Kept in this tab only; nothing is stored. <button type="button" class="btn-link" id="ct-clear-pages">Remove the file</button></div>`
      : `<div class="note ct-crawl"><b>Upload your crawler's page export</b> to check every title and meta description against the searches each page really gets: Screaming Frog › Internal › HTML › Export (the free version crawls up to 500 URLs), or any CSV with URL and title columns. It is read in this browser and not stored.
          <label class="btn-quiet ct-up">Upload page export (CSV)<input type="file" id="ct-file" accept=".csv,.tsv,.txt" hidden></label>${upMsg}</div>`;
    let body = '', mounts = [];

    if (tab === 'topics') {
      const rows = K2.topics.filter(t => t.n > 1).map(t => ({ ...t, topPath: t.top ? t.top.path : '', topShare: t.top ? t.top.share : null }));
      const cols = [{ k: 'label', l: 'Topic (strongest search)', cls: 'q wide', f: r => `${serp(r.label)}<br><small class="flat">${r.rows.slice(1, 4).map(x => esc(x.q)).join(' · ')}${r.n > 4 ? ` · +${r.n - 4} more` : ''}</small>`, csv: r => r.label },
        { k: 'n', l: 'Searches', r: 1, f: r => r.n.toLocaleString() }, C.clicks, C.impr, C.ctr, { ...C.pos, l: 'Avg. position' }, { k: 'best', l: 'Best position', r: 1, f: r => posTag(r.best) }]
        .concat(search ? [{ k: 'topPath', l: 'Main page', cls: 'u', f: r => r.top ? `${urlCell(r.top.p, r.top.path)}<br><small class="flat">${r.top.share.toFixed(0)}% of impressions${r.pages.length > 1 ? ` · ${r.pages.length} pages` : ''}</small>` : '—', csv: r => r.top ? r.top.p : '' }] : []);
      const sub = r => `<tr class="sub"><td colspan="${cols.length}"><details class="opp-d"><summary>All ${r.n} searches${search && r.pages.length ? ` and ${r.pages.length} page${r.pages.length === 1 ? '' : 's'}` : ''}</summary><div class="ct-sub"><div><h4>Searches</h4><ul>${r.rows.slice(0, 40).map(x => `<li>${esc(x.q)} <span class="flat">${fmtN(x.impr)} impr. · #${x.pos.toFixed(1)}</span></li>`).join('')}${r.n > 40 ? `<li class="flat">and ${r.n - 40} more (export the table for all)</li>` : ''}</ul></div>${search ? `<div><h4>Pages Google shows</h4><ul>${r.pages.slice(0, 10).map(p => `<li>${urlCell(p.p, p.path)} <span class="flat">${p.share.toFixed(0)}% · #${p.pos.toFixed(1)}</span></li>`).join('')}</ul></div>` : ''}</div></details></td></tr>`;
      body = `<p class="ct-lead">Searches grouped by shared words${search ? ' and by the page they rank with' : ''}. ${K2.topics.filter(t => t.n === 1).length.toLocaleString()} searches stand alone and are not listed here.</p>
        <section class="panel">${table('t-ct-t', cols, rows, { sort: 'impr', file: 'topics', searchKeys: ['label'], placeholder: 'Filter topics', pageSize: 25, sub, empty: 'No topics with more than one search.' })}</section>`;
      mounts.push(() => drawTable('t-ct-t'));
    } else if (tab === 'gaps') {
      const cols = [{ k: 'label', l: 'Topic', cls: 'q wide', f: r => `${serp(r.label)}<br><small class="flat">${r.topic.n} search${r.topic.n === 1 ? '' : 'es'}</small>`, csv: r => r.label },
        { k: 'kindsS', l: 'Gap', sort: false, f: r => r.kinds.map(k => `<span class="tag watch">${esc(KIND[k])}</span>`).join(' '), csv: r => r.kinds.map(k => KIND[k]).join('; ') },
        C.impr, { k: 'best', l: 'Best position', r: 1, f: r => posTag(r.best) },
        { k: 'ev', l: 'Evidence', sort: false, cls: 'act', f: r => `<small>${r.evidence.map(esc).join('<br>')}</small>`, csv: r => r.evidence.join(' | ') },
        { k: 'action', l: 'What to do', sort: false, cls: 'act', f: r => `<small>${esc(r.action)}</small><br><a class="btn-link" href="#content?tab=briefs&brief=${esc(r.id)}">Brief</a>`, csv: r => r.action }];
      body = `<p class="ct-lead">Topics your site already gets impressions for (at least ${fmtN(K2.gapFloor)}) where no page serves them well. Demand here is this site's own impressions: topics you get no impressions for are invisible to Search Console and need a keyword research tool.</p>
        <section class="panel">${table('t-ct-g', cols, K2.gaps, { sort: 'impr', file: 'content-gaps', searchKeys: ['label'], placeholder: 'Filter gaps', pageSize: 25, empty: 'No content gaps: every topic with enough impressions already has a page on page one.' })}</section>`;
      mounts.push(() => drawTable('t-ct-g'));
    } else if (tab === 'improve') {
      const rows = K2.improvements.map(x => ({ ...x, impr: x.nearImpr }));
      const cols = [{ ...C.page, cls: 'u wide' }, { k: 'impr', l: search ? 'Impressions on searches close to page one' : 'Impressions', r: 1, f: r => fmtN(r.impr) },
        { k: 'nearS', l: search ? 'Searches to cover better' : 'Position', sort: false, cls: 'act', f: r => r.near.length ? `<small>${r.near.slice(0, 5).map(q => `${esc(q.q)} <span class="flat">#${q.pos.toFixed(1)} · ${fmtN(q.impr)}</span>`).join('<br>')}</small>` : r.page ? posTag(r.page.pos) : '—', csv: r => r.near.map(q => q.q).join(' | ') },
        { k: 'act', l: 'What to do', sort: false, cls: 'act', f: r => `<small>${r.actions.map(esc).join('<br>')}</small>`, csv: r => r.actions.join(' ') }];
      body = `<p class="ct-lead">${search ? 'Pages that rank with searches on positions 4–20: each can usually climb by covering those searches directly.' : 'Pages ranking on positions 4–20 with enough impressions.'} Title and CTR fixes are under <a href="#ctr">Titles to rewrite</a>.</p>
        <section class="panel">${table('t-ct-i', cols, rows, { sort: 'impr', file: 'page-improvements', searchKeys: ['path'], placeholder: 'Filter pages', pageSize: 25, empty: 'No pages with searches close to page one.' })}</section>`;
      mounts.push(() => drawTable('t-ct-i'));
    } else if (tab === 'titles') {
      if (!T) body = `<p class="ct-lead">For each page your crawler found, Clickwise checks the title, meta description and H1, and${search ? ' whether the title contains the search that brings the page most of its impressions' : ' (with Search Console connected) whether the title contains the page\'s main search'}. Pages are ordered by how often they are seen.</p>`;
      else {
        const k = T.kinds, kinds = Object.keys(ISSUE).filter(x => k[x]);
        const cols = [{ ...C.page, cls: 'u wide', f: r => `${urlCell(r.url, r.path)}${r.inGsc ? '' : '<br><small class="flat">No impressions in this data</small>'}` },
          C.impr,
          { k: 'iss', l: 'Issues', sort: false, cls: 'act', f: r => r.issues.map(i => `<span class="tag ${i.sev >= 2 ? 'risk' : i.sev === 1 ? 'watch' : ''}">${esc(ISSUE[i.kind])}</span>`).join(' ') + `<br><small class="flat">${r.issues.map(i => esc(i.text)).join('<br>')}</small>`, csv: r => r.issues.map(i => i.text).join(' | ') },
          { k: 'title', l: 'Title now', cls: 'act', f: r => r.title ? `${esc(r.title)}<br><small class="flat">${r.titleLen} characters</small>` : '<span class="flat">None</span>', csv: r => r.title },
          { k: 'suggestion', l: 'A starting point', cls: 'act', f: r => r.suggestion ? `${esc(r.suggestion)}<br><small class="flat">from the search “${esc(r.queries[0].q)}”: edit before using</small>` : '<span class="flat">—</span>', csv: r => r.suggestion || '' }]
          .concat(search ? [{ k: 'qs', l: 'Its main searches', sort: false, cls: 'act', f: r => r.queries.length ? `<small>${r.queries.slice(0, 3).map(q => `${esc(q.q)} <span class="flat">${fmtN(q.impr)}</span>`).join('<br>')}</small>` : '—', csv: r => r.queries.map(q => q.q).join(' | ') }] : []);
        const groups = T.dupTitles.slice(0, 50);
        body = `<div class="strip">${stat(T.pages.toLocaleString(), 'pages checked')}${stat(T.rows.length.toLocaleString(), 'with something to fix', 'watch')}${stat((k['title-query'] || 0).toLocaleString(), 'main search missing from the title', 'risk')}${stat(T.dupTitles.length.toLocaleString(), 'groups of pages sharing a title')}</div>
          ${T.mode === 'export' ? '<p class="ct-lead">This export has no search-to-page data, so titles are checked for length, duplicates and gaps only. Connect Search Console to check them against each page\'s real searches.</p>' : ''}
          ${T.gscOnly || T.crawlNoImpr ? `<p class="flat">${T.gscOnly ? `${T.gscOnly.toLocaleString()} page${T.gscOnly === 1 ? '' : 's'} with impressions ${T.gscOnly === 1 ? 'is' : 'are'} not in the crawl (the crawl may be partial). ` : ''}${T.crawlNoImpr ? `${T.crawlNoImpr.toLocaleString()} crawled page${T.crawlNoImpr === 1 ? ' has' : 's have'} no impressions in this data.` : ''}</p>` : ''}
          <section class="panel">${table('t-ct-ti', cols, T.rows, { sort: 'impr', file: 'title-meta-audit', searchKeys: ['path'], placeholder: 'Filter pages', pageSize: 25, filters: [{ key: 'kind', label: 'Issue', options: kinds.map(x => [x, `${ISSUE[x]} (${k[x]})`]), test: (r, v) => r.issues.some(i => i.kind === v) }], empty: 'No title or meta issues on the crawled pages.' })}</section>
          ${groups.length ? `<section class="panel"><div class="panel-h"><h2>Pages sharing a title</h2><p>Each group shows one title used on several indexable pages. Give each page its own.</p></div><div class="panel-b"><ul class="ct-dup">${groups.map(g => `<li><b>${esc(g.text)}</b> <span class="flat">(${g.keys.length} pages)</span><br><small>${g.keys.slice(0, 5).map(x => esc('/' + x.split('/').slice(1).join('/'))).join(' · ')}${g.keys.length > 5 ? ` · +${g.keys.length - 5} more` : ''}</small></li>`).join('')}</ul></div></section>` : ''}
          <p class="note">Limits are guides: Google usually cuts titles past about ${T.LIMITS.titleMax} characters (${T.LIMITS.titlePx} px) and descriptions past about ${T.LIMITS.metaMax}. Suggestions are the page's own main search in title case: a starting point to edit, not a finished title.</p>`;
        mounts.push(() => drawTable('t-ct-ti'));
      }
    } else if (tab === 'links') {
      const cols = [{ k: 'path', l: 'Link to', cls: 'u wide', f: r => `${urlCell(r.p, r.path)}${r.target ? `<br><small class="flat">#${r.target.pos.toFixed(1)} for “${esc(r.anchor)}”</small>` : ''}`, csv: r => r.p },
        { k: 'anchor', l: 'Anchor text', f: r => r.anchor ? `“${esc(r.anchor)}”` : '<span class="flat">The page\'s main topic</span>', csv: r => r.anchor || '' },
        { k: 'src', l: 'From', sort: false, cls: 'act', f: r => r.sources.map(s => `${urlCell(s.p, s.path)}<br><small class="flat">${esc(s.why)}</small>`).join('<br>'), csv: r => r.sources.map(s => s.p).join(' | ') },
        C.impr, { k: 'ver', l: 'Checked', f: r => r.verified ? '<span class="tag gain">Not linked yet</span>' : '<span class="tag">Not checked</span>', csv: r => r.verified ? 'checked' : 'not checked' }];
      body = `<p class="ct-lead">${search ? 'Each target ranks on positions 4–20 for a search; each source already ranks on page one for a search in the same topic. Anchor text is the target\'s own search.' : 'Sources are the strongest pages in the same folder: without search-to-page data, relevance is only by folder.'}</p>
        <section class="panel">${table('t-ct-l', cols, K2.links, { sort: 'impr', file: 'internal-links', searchKeys: ['path'], placeholder: 'Filter target pages', pageSize: 25, empty: K2.inlinks ? 'Every suggested link already exists.' : 'No link suggestions in this data.' })}</section>`;
      mounts.push(() => drawTable('t-ct-l'));
    } else {
      const sel = params().get('brief');
      const b = K2.briefs.find(x => x.id === sel) || K2.briefs[0];
      body = !b ? '<p class="empty">No briefs: briefs are drafted for content gaps and for pages with link suggestions.</p>' : `<div class="ct-briefs">
        <aside class="ct-blist" aria-label="Briefs">${K2.briefs.map(x => `<a href="#content?tab=briefs&brief=${esc(x.id)}" class="${x.id === b.id ? 'on' : ''}">${esc(x.label)}<small>${x.target ? esc(x.target.path) : 'New page'} · ${fmtN(x.impr)} impr.</small></a>`).join('')}</aside>
        <article class="panel ct-brief"><div class="panel-b">
          <div class="ct-bh"><div><h2>${esc(b.label)}</h2><p class="flat">${b.target ? `Page: ${urlCell(b.target.p, b.target.path)}` : 'New page: no page on your site serves this topic yet'} · ${esc(b.intent)} intent · ${fmtN(b.impr)} impressions</p></div><button type="button" class="btn-quiet" data-copy="ct-brief-text">Copy brief</button></div>
          <h3>Suggested title</h3><p class="ct-title">${esc(b.title)}</p>${b.alsoCover.length ? `<p class="flat">Words searchers add: ${b.alsoCover.map(esc).join(', ')}</p>` : ''}
          <h3>Headings to cover</h3>${b.headings.length ? `<ul>${b.headings.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : '<p class="flat">Only one search in this topic.</p>'}
          <h3>Searches it should answer</h3><div class="tw"><table class="rep-t"><thead><tr><th scope="col">Search</th><th scope="col" class="r">Impressions</th><th scope="col" class="r">Clicks</th><th scope="col" class="r">Position</th></tr></thead><tbody>${b.queries.map(q => `<tr><td>${esc(q.q)}</td><td class="r">${fmtN(q.impr)}</td><td class="r">${fmtN(q.clicks)}</td><td class="r">${q.pos.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>${b.more ? `<p class="flat">and ${b.more} more searches</p>` : ''}
          <h3>Link to it from</h3>${b.linkFrom.length ? `<ul>${b.linkFrom.map(s => `<li>${urlCell(s.p, s.path)} <span class="flat">${esc(s.why)}</span></li>`).join('')}</ul>` : '<p class="flat">No page ranks on page one for this topic yet.</p>'}
          <p class="note">Drafted by fixed rules from your Search Console data: every heading and search above is a real search. Check facts, tone and the title before publishing.</p>
          <pre id="ct-brief-text" hidden>${esc(K.briefText(b))}</pre>
        </div></article></div>`;
    }
    const html = head('Content & links', 'Topics, content gaps, pages to improve and internal links, from the searches you already appear for. Nothing here is invented: every page, search and number comes from your data.') +
      `<p class="flat ct-mode">${esc(modeNote)}</p>` +
      `<div class="strip">${stat(counts.topics.toLocaleString(), 'topics with 2+ searches')}${stat(counts.gaps.toLocaleString(), 'content gaps', 'watch')}${stat(counts.improve.toLocaleString(), 'pages to improve', 'gain')}${stat(counts.links.toLocaleString(), 'pages to link to', 'gain')}</div>` +
      nav + (tab === 'links' || tab === 'briefs' ? crawl : tab === 'titles' ? pagesNote : '') + body;
    const mount = () => {
      mounts.forEach(f => f());
      const f = document.getElementById('ct-file');
      if (f) f.addEventListener('change', () => {
        const file = f.files && f.files[0]; if (!file) return;
        if (file.size > 50 * 1024 * 1024) { uploadMsg = { error: 'That file is larger than 50 MB. Export only the All Inlinks report.' }; window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
        const rd = new FileReader();
        rd.onload = () => { uploadMsg = null; document.dispatchEvent(new CustomEvent('cw:inlinks', { detail: { text: String(rd.result), name: file.name } })); };
        rd.onerror = () => { uploadMsg = { error: 'Could not read that file.' }; window.dispatchEvent(new HashChangeEvent('hashchange')); };
        rd.readAsText(file);
      });
      const cp = document.getElementById('ct-clear-pages'); if (cp) cp.addEventListener('click', () => document.dispatchEvent(new CustomEvent('cw:inlinks', { detail: { clear: 'pages' } })));
      const c = document.getElementById('ct-clear'); if (c) c.addEventListener('click', () => document.dispatchEvent(new CustomEvent('cw:inlinks', { detail: { clear: true } })));
    };
    return { html, mount };
  };
})();
