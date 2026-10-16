#!/usr/bin/env node
// Turn a Search Console Performance export (.xlsx) into an anonymised JSON test fixture.
//
//   node tools/anonymize-export.js <export.xlsx> <brand> <out.json>
//
// Kept: every number (clicks, impressions, CTR, position), dates, devices, countries,
// search appearance, the number of words in each query, common English words
// (so question and intent rules still work), URL depth and generic folder words
// (blog, dashboard, login…) so page-type and utility rules still work.
// Replaced: the domain (→ example.com), the brand (→ "example"), every other query
// word and URL segment (→ stable tokens such as w12 or s7).
'use strict';
const path = require('path');
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { console.error('Needs the "xlsx" package: npm install'); process.exit(1); }

const [, , input, brand, output] = process.argv;
if (!input || !brand || !output) { console.error('usage: node tools/anonymize-export.js <export.xlsx> <brand> <out.json>'); process.exit(1); }

const KEEP_WORDS = new Set(('a an the and or of in on at to for from by with without vs versus near me my your is are was were be can could does do did should will would ' +
  'who what when where why how which best top cheap free online new latest today review reviews compare comparison alternative alternatives price prices pricing cost buy ' +
  'guide tutorial tips examples meaning definition list template steps 2024 2025 2026 2027 india delhi mumbai bangalore login sign up').split(' '));
const KEEP_SEGMENTS = new Set(('blog blogs news articles guides guide help support docs faq jobs job careers internships internship courses course events event ' +
  'products product category categories collections tag tags author authors about contact pricing features privacy terms login logout signin signup register auth ' +
  'account accounts dashboard admin panel settings profile cart checkout billing inbox notifications app').split(' '));

// same rule as the app (engine.js brandPattern): exact for short names, up to 3 glued characters for longer ones
const glue = brand.length > 4 ? '[\\p{L}\\p{N}]{0,3}' : '';
const brandRx = new RegExp('(^|[^\\p{L}\\p{N}])' + glue + brand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + glue + '(?=$|[^\\p{L}\\p{N}])', 'u');
const tok = (map, prefix) => w => { if (!map.has(w)) map.set(w, prefix + (map.size + 1)); return map.get(w); };
const word = tok(new Map(), 'w'), seg = tok(new Map(), 's');

function anonQuery(q) {
  const l = String(q).toLowerCase();
  const isBrand = brandRx.test(l);
  const words = l.replace(new RegExp(brandRx.source, 'gu'), ' ').split(/\s+/).filter(Boolean).map(w => KEEP_WORDS.has(w) ? w : word(w));
  return (isBrand ? ['example'] : []).concat(words).join(' ') || 'example';
}
function anonUrl(u) {
  let p; try { p = new URL(u).pathname; } catch (e) { p = String(u).replace(/^https?:\/\/[^/]+/i, ''); }
  const segs = p.split('/').filter(Boolean).map(s => s.toLowerCase().split(/[-_]/).map(part => KEEP_SEGMENTS.has(part) ? part : seg(part)).join('-'));
  return 'https://example.com/' + segs.join('/') + (p.endsWith('/') && segs.length ? '/' : '');
}

const wb = XLSX.readFile(path.resolve(input));
const rows = name => { const ws = wb.Sheets[name]; return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter(r => r.some(c => c !== '')) : []; };
const num = v => typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%]/g, '')) || 0;
const metric = r => ({ clicks: num(r[1]), impr: num(r[2]), ctr: typeof r[3] === 'number' ? r[3] : num(r[3]) / 100, pos: num(r[4]) });
const sheet = re => wb.SheetNames.find(n => re.test(n.toLowerCase()));

const out = {
  note: 'Anonymised Search Console export used as a regression fixture. Numbers are real; query words, URLs and the brand are replaced.',
  site: 'example.com', brand: 'example',
  sheets: {
    Chart: rows(sheet(/chart|date/)).slice(1).map(r => [String(r[0]).slice(0, 10), ...Object.values(metric(r))]),
    Queries: rows(sheet(/quer/)).slice(1).map(r => [anonQuery(r[0]), ...Object.values(metric(r))]),
    Pages: rows(sheet(/page/)).slice(1).map(r => [anonUrl(r[0]), ...Object.values(metric(r))]),
    Countries: rows(sheet(/countr/)).slice(1).map(r => [String(r[0]), ...Object.values(metric(r))]),
    Devices: rows(sheet(/device/)).slice(1).map(r => [String(r[0]), ...Object.values(metric(r))]),
    'Search appearance': rows(sheet(/appearance/)).slice(1).map(r => [String(r[0]), ...Object.values(metric(r))])
  }
};
require('fs').writeFileSync(output, JSON.stringify(out));
console.log('wrote', output, Object.entries(out.sheets).map(([k, v]) => k + ':' + v.length).join(' '));
