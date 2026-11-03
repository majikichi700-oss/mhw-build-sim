/* Web Worker の中で動く部分。engine.js の後ろにつなげて使います。
 * 検索は少しずつ（約 50 ミリ秒ずつ）進め、そのあいだに「止める」の知らせを受け取れるようにします。 */
var GAME_W = null;
var STOP = {};
self.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === 'init') {
    GAME_W = JSON.parse(m.game);
    self.MHEngine.indexGame(GAME_W);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'stop') { STOP[m.job] = true; return; }
  if (m.type === 'search') {
    var job = m.job;
    var q = m.query;
    q.stopSignal = function () { return !!STOP[job]; };
    var it;
    try { it = self.MHEngine.searchGen(GAME_W, q); } catch (e) {
      self.postMessage({ type: 'error', job: job, message: String(e && e.message || e) });
      return;
    }
    var step = function () {
      try {
        var t = Date.now(), r;
        while (true) {
          r = it.next();
          if (r.done) {
            delete STOP[job];
            self.postMessage({ type: 'done', job: job, result: { builds: r.value.builds, stats: r.value.stats } });
            return;
          }
          self.postMessage({ type: 'progress', job: job, p: r.value });
          if (Date.now() - t > 50) break;
        }
        setTimeout(step, 0);
      } catch (e) {
        self.postMessage({ type: 'error', job: job, message: String(e && e.message || e) });
      }
    };
    step();
  }
};
