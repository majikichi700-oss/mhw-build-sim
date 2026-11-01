/* Web Worker の中で動く部分。engine.js の後ろにつなげて使います。 */
var GAME_W = null;
self.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === 'init') {
    GAME_W = JSON.parse(m.game);
    self.MHEngine.indexGame(GAME_W);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'search') {
    try {
      var it = self.MHEngine.searchGen(GAME_W, m.query), r;
      while (true) {
        r = it.next();
        if (r.done) break;
        self.postMessage({ type: 'progress', job: m.job, p: r.value });
      }
      self.postMessage({ type: 'done', job: m.job, result: { builds: r.value.builds, stats: r.value.stats } });
    } catch (e) {
      self.postMessage({ type: 'error', job: m.job, message: String(e && e.message || e) });
    }
  }
};
