// Clickwise white-label report: a one-page "boss-ready" summary (and an optional details page) carrying the
// agency's name, logo and colour, and the client's name and logo. Saved as PDF with the browser's print.
// Branding is kept in this browser: the agency once for all clients, the client per site.
(function () {
  'use strict';
  const CW = window.CW, fmtN = CW.fmtN;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('cw:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cw:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const DEFAULT = { agency: '', contact: '', color: '#4F46E5', logo: null, showClickwise: true, client: '', clientLogo: null, notes: '', details: true };
  const LIMIT = { agency: 80, contact: 120, client: 80, notes: 600 };
  const HEX = /^#[0-9a-f]{6}$/i;
  const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  // ── settings ──
  // Saved values come back from browser storage, so each is checked again; anything odd falls back to the default.
  function clean(b) {
    b = b && typeof b === 'object' ? b : {};
    const txt = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
    const notes = typeof b.notes === 'string' ? b.notes.replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, LIMIT.notes) : '';
    return {
      agency: txt(b.agency, LIMIT.agency), contact: txt(b.contact, LIMIT.contact), client: txt(b.client, LIMIT.client), notes,
      color: typeof b.color === 'string' && HEX.test(b.color) ? b.color : DEFAULT.color,
      logo: typeof b.logo === 'string' && LOGO.test(b.logo) && b.logo.length < 300000 ? b.logo : null,
      clientLogo: typeof b.clientLogo === 'string' && LOGO.test(b.clientLogo) && b.clientLogo.length < 300000 ? b.clientLogo : null,
      showClickwise: b.showClickwise !== false, details: b.details !== false
    };
  }
  function load(site) {
    const ag = store.get('agency') || {}, cl = store.get('client:' + site) || {};
    return clean({ ...DEFAULT, ...ag, client: cl.client, clientLogo: cl.clientLogo, notes: cl.notes, details: cl.details });
  }
  function save(site, b) {
    const c = clean(b);
    const ok1 = store.set('agency', { agency: c.agency, contact: c.contact, color: c.color, logo: c.logo, showClickwise: c.showClickwise });
    const ok2 = store.set('client:' + site, { client: c.client, clientLogo: c.clientLogo, notes: c.notes, details: c.details });
    return ok1 && ok2;
  }
  // Text on the brand colour must stay readable: white on dark colours, near-black on light ones (WCAG luminance).
  function onColor(hex) {
    const n = parseInt(hex.slice(1), 16), ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * ch(n >> 16 & 255) + 0.7152 * ch(n >> 8 & 255) + 0.0722 * ch(n & 255);
    return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? '#FFFFFF' : '#111827';
  }
  // A logo is redrawn onto a canvas and saved as PNG, at most 400 × 160 px: only pixels survive, never markup.
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file chosen.'));
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, WebP or GIF image.'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('That image is larger than 5 MB.'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, 400 / img.width, 160 / img.height), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        const d = c.toDataURL('image/png');
        d.length < 300000 ? resolve(d) : reject(new Error('That image is too detailed; use a simpler logo.'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  // ── what goes on the page (pure) ──
  const pct = (c, p) => p ? (c - p) / p * 100 : null;
  const mag = v => v == null ? '' : `${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;  // size of a change; the verb gives its direction
  function changed(A) {
    const out = [], ps = A.prevSite, s = A.site;
    if (ps && ps.clicks) {
      const c = pct(s.clicks, ps.clicks), i = pct(s.impr, ps.impr);
      out.push(`Clicks ${c >= 0 ? 'rose' : 'fell'} ${mag(c)} against the previous period (${fmtN(ps.clicks)} → ${fmtN(s.clicks)}); impressions ${i >= 0 ? 'rose' : 'fell'} ${mag(i)}.`);
    } else if (A.trend) out.push(`Within this period, clicks ${A.trend.clicks >= 0 ? 'rose' : 'fell'} ${mag(A.trend.clicks)} from the first half to the second.`);
    if (A.decay && A.decay.pages[0]) { const d = A.decay.pages[0]; out.push(`Biggest drop: ${d.path}, ${fmtN(d.prev.clicks)} → ${d.uncertain ? 'at most ' : ''}${fmtN(d.cur.clicks)} clicks (${d.reason}).`); }
    if (A.decay && A.decay.rising[0]) { const r = A.decay.rising[0]; out.push(`Biggest gain: ${r.path}, ${r.uncertain ? 'at least ' : ''}+${fmtN(r.won)} clicks.`); }
    if (!out.length) out.push('No comparison period was loaded, so changes over time are not shown. Load the previous period to include them.');
    return out;
  }
  // the five most valuable actions with medium or high confidence (the same list and numbers as All opportunities)
  const topActions = A => (A.opps ? A.opps.items : []).filter(it => it.confidence.level !== 'Low' && it.impact.kind !== 'none').slice(0, 5);

  window.CW_REPORT = { DEFAULT, LIMIT, clean, load, save, onColor, readLogo, changed, topActions };
})();
