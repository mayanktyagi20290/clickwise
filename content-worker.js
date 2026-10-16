// Runs the content assistant off the main thread for large sites, so grouping 100,000 searches never freezes
// the page. It repeats the same pure analysis the page runs (engine.js, then content.js) on a copy of the data
// and posts the result back. Nothing here talks to the network.
'use strict';
self.window = self;
const v = (self.location.search.match(/v=(\d+)/) || [])[1] || '0';
importScripts('engine.js?v=' + v, 'content.js?v=' + v);
self.onmessage = e => {
  const { id, D, S, inlinks } = e.data || {};
  try {
    const A = self.CW.analyse(D, S);
    const content = self.CW_CONTENT.build(A, D, { brand: S.brand, inlinks });
    self.postMessage({ id, content });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
