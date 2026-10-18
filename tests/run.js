#!/usr/bin/env node
// Runs every test suite: node tests/run.js   (add --no-browser to skip the browser test)
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['unit.test.js', 'opportunities.test.js', 'goals.test.js', 'content.test.js', 'fixes.test.js', 'titles.test.js', 'report.test.js', 'regression.test.js'].concat(process.argv.includes('--no-browser') ? [] : ['browser.test.js']);
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
