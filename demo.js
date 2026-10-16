// Sample data for a fictional outdoor-gear site. Deterministic.
(function () {
  'use strict';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function build() {
    const R = rng(42);
    const pick = a => a[Math.floor(R() * a.length)];
    const between = (a, b) => a + R() * (b - a);
    const host = 'https://www.trailcraft.co';
    const exp = window.CW.expCtr;

    const pages = [];
    const addPage = (path, opts) => { const p = { p: host + path, ...opts }; pages.push(p); return p; };

    // pages with topic seeds
    const gear = ['hiking boots', 'trail running shoes', 'backpacking tent', 'sleeping bag', 'trekking poles', 'rain jacket', 'hiking backpack', 'headlamp', 'water filter', 'camping stove', 'down jacket', 'hiking socks'];
    const trails = [['himalaya', 'triund trek'], ['himalaya', 'kedarkantha trek'], ['himalaya', 'hampta pass'], ['himalaya', 'valley of flowers'], ['western-ghats', 'kalsubai peak'], ['western-ghats', 'rajmachi trek'], ['western-ghats', 'kudremukh trek'], ['northeast', 'dzukou valley'], ['himalaya', 'roopkund trek'], ['himalaya', 'brahmatal trek']];
    const guides = ['how to layer clothes for trekking', 'how to choose hiking boots', 'what to pack for a winter trek', 'how to prevent altitude sickness', 'how to set up a tent', 'leave no trace principles', 'how to read a topographic map', 'how to waterproof boots', 'beginner trekking fitness plan', 'how to pack a backpack'];
    const compares = [['hiking boots', 'trail runners'], ['down jacket', 'synthetic jacket'], ['water filter', 'purification tablets']];
    const slug = s => s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const home = addPage('/', { kind: 'home' });
    addPage('/login', { kind: 'login' });
    const gearPages = gear.map(g => addPage('/gear/' + slug(g), { kind: 'gear', topic: g }));
    const reviewPages = gear.slice(0, 8).map(g => addPage('/reviews/best-' + slug(g), { kind: 'review', topic: g }));
    const trailPages = trails.map(([reg, t]) => addPage('/trails/' + reg + '/' + slug(t), { kind: 'trail', topic: t }));
    const guidePages = guides.map(g => addPage('/guides/' + slug(g), { kind: 'guide', topic: g }));
    const blogPages = ['best treks in india 2026', 'monsoon trekking tips', 'solo trekking safety for women', 'budget trekking gear list'].map(g => addPage('/blog/' + slug(g), { kind: 'blog', topic: g }));
    const comparePages = compares.map(([a, b]) => addPage('/compare/' + slug(a) + '-vs-' + slug(b), { kind: 'compare', topic: a + ' vs ' + b, a, b }));
    addPage('/about', { kind: 'about' });

    // query templates per page
    const QP = []; // query × page
    // a few pages have weak titles: every query on them under-performs
    [gearPages, trailPages, guidePages].forEach(list => list.forEach((pg, i) => { if (i % 4 === 2) pg.weak = 0.35; }));
    const push = (q, page, pos, impr, ctrFactor) => {
      pos = Math.max(1, Math.min(60, pos));
      ctrFactor *= page.weak || 1;
      impr = Math.max(3, Math.round(impr));
      const ctr = Math.min(70, exp(pos) * ctrFactor * between(0.75, 1.25));
      const clicks = Math.round(impr * ctr / 100);
      QP.push({ q, p: page.p, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
    };
    // brand
    ['trailcraft', 'trailcraft india', 'trail craft', 'trailcraft coupon', 'trailcraft boots', 'trailcraft reviews', 'trialcraft', 'trailcraf shoes'].forEach((q, i) => push(q, i === 4 ? gearPages[0] : home, between(1, 1.6), between(400, 3200) / (i + 1), 2.2));
    gearPages.forEach((pg, i) => {
      const g = pg.topic;
      const base = between(1500, 9000) / (1 + i * 0.25);
      push(g, pg, between(6, 16), base, 1);
      push('buy ' + g + ' online', pg, between(3, 9), base * 0.25, 1.1);
      push(g + ' price', pg, between(4, 12), base * 0.3, 0.9);
      push(g + ' for women', pg, between(8, 22), base * 0.18, 1);
      push(g + ' india', pg, between(4, 11), base * 0.35, i % 3 === 0 ? 0.4 : 1);
      if (i < 8) {
        // cannibalisation: review page and gear page both rank for "best X"
        push('best ' + g, reviewPages[i], between(4, 9), base * 0.5, 0.8);
        if (i % 2 === 0) push('best ' + g, pg, between(9, 18), base * 0.35, 0.8);
        push('best ' + g + ' 2026', reviewPages[i], between(5, 13), base * 0.2, 0.7);
        push(g + ' review', reviewPages[i], between(3, 8), base * 0.15, 1);
        push('top 10 ' + g + ' under 5000', reviewPages[i], between(7, 19), base * 0.12, 1);
      }
    });
    trailPages.forEach((pg, i) => {
      const t = pg.topic;
      const base = between(2000, 14000) / (1 + i * 0.2);
      push(t, pg, between(2, 7), base, i % 4 === 1 ? 0.3 : 1); // some AI-overview style suppression
      push(t + ' distance', pg, between(1, 4), base * 0.2, 0.25);
      push(t + ' difficulty level', pg, between(2, 6), base * 0.12, 0.3);
      push('how to reach ' + t, pg, between(3, 9), base * 0.18, 0.6);
      push('best time for ' + t, pg, between(2, 8), base * 0.22, 0.5);
      push(t + ' itinerary 4 days', pg, between(5, 15), base * 0.1, 1);
      push('is ' + t + ' safe for beginners in winter', pg, between(3, 12), base * 0.05, 0.6);
      push(t + ' cost', pg, between(6, 18), base * 0.15, 1);
      if (i % 3 === 0) push(t + ' altitude in meters', pg, between(1, 2.5), base * 0.12, 0.02); // answered on the results page
    });
    guidePages.forEach((pg, i) => {
      const g = pg.topic;
      const base = between(800, 6000);
      push(g, pg, between(2, 14), base, i % 3 === 0 ? 0.35 : 0.9);
      push(g.replace(/^how to /, '') + ' tips', pg, between(5, 18), base * 0.3, 1);
      push(g + ' step by step for beginners', pg, between(4, 16), base * 0.08, 0.8);
      push('what is the best way ' + g.replace(/^how /, ''), pg, between(6, 20), base * 0.06, 0.7);
    });
    blogPages.forEach((pg, i) => {
      const base = between(1500, 8000);
      push(pg.topic, pg, between(3, 12), base, 0.7);
      push(pg.topic.replace(' 2026', ''), pg, between(6, 20), base * 0.6, 0.8);
      push(pg.topic + ' list', pg, between(8, 24), base * 0.2, 1);
    });
    comparePages.forEach(pg => {
      const base = between(600, 3000);
      push(pg.a + ' vs ' + pg.b, pg, between(1, 3), base, 1);
      push('difference between ' + pg.a + ' and ' + pg.b, pg, between(2, 6), base * 0.4, 0.5);
      push(pg.a + ' or ' + pg.b + ' for himalayan trek', pg, between(4, 12), base * 0.2, 1);
    });
    // long tail noise
    for (let i = 0; i < 220; i++) {
      const pg = pick(pages.filter(p => !['login', 'about'].includes(p.kind)));
      const mods = ['near delhi', 'for beginners', 'checklist', 'in december', 'with kids', 'under 2000', 'lightweight', 'waterproof', 'for monsoon', 'rental', 'decathlon alternative', 'reddit'];
      const t = (pg.topic || 'trekking gear') + ' ' + pick(mods);
      push(t, pg, between(4, 45), between(10, 400), 1);
    }

    // aggregate query and page tables
    const byQ = new Map(), byP = new Map();
    const add = (m, k, r) => { const o = m.get(k) || { clicks: 0, impr: 0, posW: 0 }; o.clicks += r.clicks; o.impr += r.impr; o.posW += r.pos * r.impr; m.set(k, o); };
    QP.forEach(r => { add(byQ, r.q, r); add(byP, r.p, r); });
    const fin = (m, key) => [...m.entries()].map(([k, o]) => ({ [key]: k, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.posW / Math.max(1, o.impr) }));
    const Q = fin(byQ, 'q').sort((a, b) => b.clicks - a.clicks);
    const P = fin(byP, 'p').sort((a, b) => b.clicks - a.clicks);
    // login page gets some brand traffic
    P.push({ p: host + '/login', clicks: 820, impr: 1900, ctr: 43.2, pos: 1.4 });

    // previous period: most pages a bit lower; a few decaying pages were stronger
    const decaying = new Set([trailPages[1].p, guidePages[0].p, blogPages[0].p, gearPages[2].p, reviewPages[3].p]);
    const prevP = P.map(r => {
      const f = decaying.has(r.p) ? between(1.6, 2.6) : between(0.75, 1.05);
      const posShift = decaying.has(r.p) ? -between(2, 5) : between(0, 1.5);
      const impr = Math.round(r.impr * (decaying.has(r.p) ? between(1.0, 1.5) : between(0.8, 1.0)));
      const clicks = Math.round(r.clicks * f);
      return { p: r.p, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: Math.max(1, r.pos + posShift) };
    });
    const qPage = new Map(); QP.forEach(r => { if (!qPage.has(r.q)) qPage.set(r.q, r.p); });
    const prevQ = Q.map(r => {
      const d = decaying.has(qPage.get(r.q));
      const clicks = Math.round(r.clicks * (d ? between(1.6, 2.6) : between(0.75, 1.05)));
      const impr = Math.round(r.impr * between(0.85, 1.1));
      return { q: r.q, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: Math.max(1, r.pos + (d ? -between(2, 5) : between(0, 1.5))) };
    });

    // daily series (90 days), totals ~= sum of pages + anonymised share
    const totalClicks = P.reduce((s, r) => s + r.clicks, 0) * 1.12;
    const totalImpr = P.reduce((s, r) => s + r.impr, 0) * 1.25;
    const end = new Date(); end.setDate(end.getDate() - 3);
    const C = [];
    let wsum = 0; const weights = [];
    for (let i = 0; i < 90; i++) {
      const dd = new Date(end); dd.setDate(end.getDate() - (89 - i));
      const dow = dd.getDay();
      const w = (0.85 + i / 90 * 0.3) * (dow === 0 || dow === 6 ? 1.18 : 1) * between(0.92, 1.08);
      weights.push([dd.toISOString().slice(0, 10), w]); wsum += w;
    }
    weights.forEach(([d, w]) => {
      const clicks = Math.round(totalClicks * w / wsum), impr = Math.round(totalImpr * w / wsum * between(0.95, 1.05));
      C.push({ d, clicks, impr, ctr: clicks / impr * 100, pos: between(11.5, 13.5) });
    });
    const Dev = [
      { d: 'MOBILE', clicks: Math.round(totalClicks * 0.71), impr: Math.round(totalImpr * 0.74) },
      { d: 'DESKTOP', clicks: Math.round(totalClicks * 0.26), impr: Math.round(totalImpr * 0.23) },
      { d: 'TABLET', clicks: Math.round(totalClicks * 0.03), impr: Math.round(totalImpr * 0.03) }
    ].map(r => ({ ...r, ctr: r.clicks / r.impr * 100, pos: 0 }));

    const start = C[0].d, endD = C[C.length - 1].d;
    return { site: 'trailcraft.co', siteUrl: 'sc-domain:trailcraft.co', source: 'demo', start, end: endD, days: 90, Q, P, C, Dev, QP, prevQ, prevP };
  }

  window.CW_DEMO = { build };
})();
