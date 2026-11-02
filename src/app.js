/* 画面のプログラム。ゲームの数値は GAME（data/game.json）から読み、装備名や数値は必ずここから表示します。 */
(function () {
  'use strict';
  var E = window.MHEngine;
  var GAME = JSON.parse(document.getElementById('game-data').textContent);
  var PRESETS = JSON.parse(document.getElementById('preset-data').textContent);
  var I = E.indexGame(GAME);
  E.prepare(GAME, { ranks: ['LR'], maxRarity: 1 }); // 会心の基本倍率を求めておく
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var NUM = ['', '①', '②', '③', '④'];
  var fmt = function (x, d) { return (Math.round(x * Math.pow(10, d || 1)) / Math.pow(10, d || 1)).toFixed(d == null ? 1 : d); };

  /* ---------- 検索を動かす（Web Worker。使えなければ少しずつ処理） ---------- */
  var worker = null, workerOk = false, jobSeq = 0, jobs = {};
  function makeWorker() {
    worker = null; workerOk = false;
    try {
      var src = document.getElementById('engine-src').textContent + '\n' + document.getElementById('worker-src').textContent;
      var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === 'ready') { workerOk = true; return; }
        var j = jobs[m.job]; if (!j) return;
        if (m.type === 'progress') j.onProgress && j.onProgress(m.p);
        else if (m.type === 'done') { delete jobs[m.job]; j.resolve(m.result); }
        else if (m.type === 'error') { delete jobs[m.job]; j.reject(new Error(m.message)); }
      };
      w.onerror = function () { if (worker === w) { worker = null; workerOk = false; } };
      w.postMessage({ type: 'init', game: document.getElementById('game-data').textContent });
      worker = w;
    } catch (e) { worker = null; }
  }
  makeWorker();

  // 検索を始めます。返り値の promise は、最後まで探し終えたときか、「止める」を押したときに、
  // それまでに見つけた案を返します（止めても途中の結果は消えません）。
  var currentJob = null, stopFlag = false;
  function runSearch(q, onProgress) {
    if (worker && workerOk) {
      return new Promise(function (resolve, reject) {
        var id = ++jobSeq;
        jobs[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
        currentJob = id;
        worker.postMessage({ type: 'search', job: id, query: q });
      });
    }
    // Web Worker が使えないとき：少しずつ処理して、そのたびに画面へ戻ります
    return new Promise(function (resolve, reject) {
      var it;
      stopFlag = false; currentJob = 'main';
      var q2 = Object.assign({}, q, { stopSignal: function () { return stopFlag; } });
      try { it = E.searchGen(GAME, q2); } catch (e) { reject(e); return; }
      (function step() {
        try {
          var t = Date.now(), r;
          while (true) {
            r = it.next();
            if (r.done) { resolve(stripResult(r.value)); return; }
            onProgress && onProgress(r.value);
            if (Date.now() - t > 40) break;
          }
          setTimeout(step, 0);
        } catch (e) { reject(e); }
      })();
    });
  }
  // 「止める」：検索プログラムに止まるよう知らせ、それまでの結果を受け取ります。
  // 3 秒たっても返事がないときだけ、Web Worker ごと止めます。
  function stopWorker() {
    stopFlag = true;
    if (currentJob === 'main' || currentJob == null) return;
    var id = currentJob;
    if (worker) worker.postMessage({ type: 'stop', job: id });
    setTimeout(function () {
      if (!jobs[id]) return;
      if (worker) worker.terminate();
      jobs[id].reject(new Error('止めました'));
      delete jobs[id];
      makeWorker();
    }, 3000);
  }
  function stripResult(r) { return { builds: r.builds, stats: r.stats }; }

  /* ---------- 名前 ---------- */
  function skillName(id) { var s = I.skillById[id]; return s ? s.ja : '?'; }
  // データに日本語名がない装備には印を付けます（記憶で日本語名を作りません）
  function noJa(x) { return x && x.jaMissing ? ' <span class="tag" title="MHWorldData に日本語名がないため英語名で表示しています">日本語名なし</span>' : ''; }
  function armorName(id) { var a = I.armorById[id]; return a ? a.ja : '?'; }
  function decoName(id) { var d = I.decoById[id]; return d ? d.ja : '?'; }
  function charmName(id) { if (id == null) return 'なし'; var c = I.charmById[id]; return c ? c.ja : '?'; }
  function weaponLabel(b) {
    if (b.weapon != null) { var w = I.weaponById[b.weapon]; return w.ja + (w.jaMissing ? '［日本語名なし］' : '') + '（' + E.WEAPON_JA[w.type] + '）'; }
    return 'スロットだけ指定した武器';
  }
  function slotsLabel(sl) { return sl && sl.length ? sl.map(function (s) { return NUM[s]; }).join('') : 'なし'; }

  /* ---------- 案の表示 ---------- */
  var store = {}; // buildId -> build（Claude の答えはここにある id だけ表示します）
  function partRows(b) {
    var byslot = {}; b.decos.forEach(function (d) { byslot[d.slot] = d; });
    var rows = [];
    function slotCells(prefix, slots) {
      return slots.map(function (sz, j) {
        var d = byslot[prefix + '#' + j];
        return '<span class="slot">' + NUM[sz] + ' ' + (d ? esc(decoName(d.deco)) + noJa(I.decoById[d.deco]) : '<span class="muted">空き</span>') + '</span>';
      }).join('');
    }
    var wsl = b.weapon != null ? I.weaponById[b.weapon].slots : (b.weaponSlots || []);
    rows.push('<tr><th>武器</th><td>' + esc(weaponLabel(b)) + '<div class="slots">' + slotCells('weapon', wsl) + '</div></td></tr>');
    E.PARTS.forEach(function (p, i) {
      var a = I.armorById[b.armor[i]];
      rows.push('<tr><th>' + E.PART_JA[p] + '</th><td>' + esc(a.ja) + noJa(a) + ' <span class="muted">レア' + a.rarity + '</span><div class="slots">' + slotCells(p, a.slots) + '</div></td></tr>');
    });
    rows.push('<tr><th>護石</th><td>' + esc(charmName(b.charm)) + noJa(b.charm != null && I.charmById[b.charm]) + (b.charm != null ? ' <span class="muted">' + I.charmById[b.charm].skills.map(function (x) { return esc(skillName(x[0])) + x[1]; }).join('・') + '</span>' : '') + '</td></tr>');
    return rows.join('');
  }
  function bonusSkillSet(b) { var s = {}; (b.bonuses || []).forEach(function (x) { x.active.forEach(function (k) { s[k] = 1; }); }); return s; }
  function skillList(b, req) {
    var reqSet = {}; (req || []).forEach(function (x) { reqSet[x.id] = 1; });
    var bs = bonusSkillSet(b);
    var ks = Object.keys(b.levels).filter(function (k) { return b.levels[k] > 0; });
    ks.sort(function (x, y) { return (reqSet[y] || 0) - (reqSet[x] || 0) || b.levels[y] - b.levels[x] || x - y; });
    return ks.map(function (k) {
      var s = I.skillById[k];
      var unlocked = s.unlockedBy != null && (b.levels[s.unlockedBy] || 0) > 0;
      var cap = unlocked ? s.maxAll : s.max;
      var over = b.points && b.points[k] > b.levels[k] ? '<span class="muted">（' + b.points[k] + 'pt、上限で切り）</span>' : '';
      return '<li class="' + (reqSet[k] ? 'req' : '') + '">' + esc(s.ja) + ' <b>Lv' + b.levels[k] + '</b><span class="muted">/' + cap + '</span>' + (bs[k] ? ' <span class="tag">シリーズ</span>' : '') + over + '</li>';
    }).join('');
  }
  function bonusList(b) {
    var out = (b.bonuses || []).map(function (x) {
      var bo = I.bonusById[x.id];
      var parts = bo.skills.map(function (y) { return esc(skillName(y[0])) + '（' + y[1] + '部位）' + (x.count >= y[1] ? '<b>発動</b>' : '<span class="muted">未発動</span>'); }).join('、');
      return '<li>' + esc(bo.ja) + ' ' + x.count + '部位：' + parts + '</li>';
    });
    return out.length ? out.join('') : '<li class="muted">なし</li>';
  }
  function scoreBlock(b) {
    var sc = b.score, d = sc.detail;
    var obj = E.OBJECTIVES[b.objective || 'fire'];
    var resTxt = d.res.map(function (r, i) { return E.ELEM_JA[E.ELEMS[i]] + fmt(r, 0); }).join(' ');
    var nc = (sc.notCounted || []).map(skillName);
    return '<details class="score"><summary>点数の内訳（目的：' + esc(obj.ja) + '、合計 ' + fmt(sc.total) + '）</summary>' +
      '<table class="kv">' +
      '<tr><th>火力点</th><td>' + fmt(sc.fire) + '（スキルなしを 100 とした期待値）</td></tr>' +
      '<tr><th>　物理期待値</th><td>' + fmt(d.phys0) + ' から ' + fmt(d.phys) + '（基礎攻撃力 ' + fmt(d.raw) + '、攻撃の倍率 ' + fmt(d.atkMul, 3) + '、会心率 ' + fmt(d.affinity, 0) + '%、会心の倍率 ' + fmt(d.critMul, 2) + '）</td></tr>' +
      '<tr><th>　属性期待値</th><td>' + (d.elem0 ? fmt(d.elem0) + ' から ' + fmt(d.elem) : '属性なし（または数えない属性）') + '</td></tr>' +
      '<tr><th>守り点</th><td>' + fmt(sc.def) + '（防御力 ' + fmt(d.defense, 0) + '、耐性 ' + resTxt + '、体力 +' + fmt(d.health, 0) + '、生存スキル Lv 計 ' + d.survLv + '）</td></tr>' +
      '<tr><th>快適点</th><td>' + fmt(sc.comfort) + '（余りスロット ' + d.spareP + ' 点、便利スキル Lv 計 ' + d.comfortLv + '）</td></tr>' +
      '<tr><th>数値に入れていないスキル</th><td>' + (nc.length ? esc(nc.join('、')) : 'なし') + '</td></tr>' +
      '</table></details>';
  }
  function buildCard(b, opt) {
    opt = opt || {};
    var id = opt.id || ('x' + Math.random().toString(36).slice(2, 8));
    store[id] = { build: b, query: opt.query || {}, title: opt.title || '' };
    var sp = (b.spare || []).map(function (s) { return NUM[s.size]; }).join('');
    var d = b.score.detail;
    var html = '<article class="card" id="card-' + esc(id) + '">' +
      '<header><h3>' + esc(opt.title || ('案 ' + (b.rank || ''))) + '</h3>' +
      '<div class="pts"><span>合計 <b>' + fmt(b.score.total) + '</b></span><span>火力 ' + fmt(b.score.fire) + '</span><span>守り ' + fmt(b.score.def) + '</span><span>快適 ' + fmt(b.score.comfort) + '</span></div></header>' +
      (opt.reason ? '<p class="reason">' + esc(opt.reason) + '</p>' : '') +
      '<table class="parts">' + partRows(b) + '</table>' +
      '<div class="cols"><div><h4>発動スキル</h4><ul class="skills">' + skillList(b, opt.query && opt.query.skills) + '</ul></div>' +
      '<div><h4>シリーズスキル</h4><ul class="skills">' + bonusList(b) + '</ul>' +
      '<h4>余るスロット</h4><p>' + (sp || 'なし') + '</p>' +
      '<h4>防御力と耐性</h4><p>防御力 ' + fmt(d.defense, 0) + '（強化最大、スキル込み）<br>' + d.res.map(function (r, i) { return E.ELEM_JA[E.ELEMS[i]] + '耐性 ' + fmt(r, 0); }).join('、') + '</p></div></div>' +
      scoreBlock(b) +
      '<div class="actions"><button type="button" data-copy="' + esc(id) + '">一覧をコピー</button><button type="button" data-share="' + esc(id) + '">この案の URL をコピー</button><span class="copied" aria-live="polite"></span></div>' +
      '</article>';
    return html;
  }
  function buildText(b, title) {
    var lines = ['【MHW:IB 装備案】' + (title || '')];
    var byslot = {}; b.decos.forEach(function (d) { byslot[d.slot] = d; });
    function sl(prefix, slots) { return slots.map(function (sz, j) { var d = byslot[prefix + '#' + j]; return NUM[sz] + (d ? decoName(d.deco) : '空き'); }).join(' / '); }
    var wsl = b.weapon != null ? I.weaponById[b.weapon].slots : (b.weaponSlots || []);
    lines.push('武器: ' + weaponLabel(b) + (wsl.length ? '［' + sl('weapon', wsl) + '］' : ''));
    E.PARTS.forEach(function (p, i) { var a = I.armorById[b.armor[i]]; lines.push(E.PART_JA[p] + ': ' + a.ja + (a.slots.length ? '［' + sl(p, a.slots) + '］' : '')); });
    lines.push('護石: ' + charmName(b.charm));
    lines.push('発動スキル: ' + Object.keys(b.levels).filter(function (k) { return b.levels[k] > 0; }).sort(function (x, y) { return b.levels[y] - b.levels[x]; }).map(function (k) { return skillName(k) + ' Lv' + b.levels[k]; }).join('、'));
    var bo = (b.bonuses || []).filter(function (x) { return x.active.length; }).map(function (x) { return I.bonusById[x.id].ja + '（' + x.active.map(skillName).join('・') + '）'; });
    if (bo.length) lines.push('シリーズスキル: ' + bo.join('、'));
    lines.push('防御力 ' + Math.round(b.score.detail.defense) + '（強化最大の値。ゲーム内で確かめてください）');
    return lines.join('\n');
  }
  function shareUrl(b, q) {
    var o = { v: 1, w: b.weapon, ws: b.weapon == null ? b.weaponSlots : undefined, a: b.armor, c: b.charm, d: b.decos.map(function (x) { return [x.slot, x.deco]; }), o: b.objective || 'fire', u: q && q.uptimeScale };
    var s = btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0] + '#b=' + s;
  }
  function readShared() {
    var m = /#b=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return null;
    try {
      var s = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      var o = JSON.parse(decodeURIComponent(escape(atob(s))));
      var spec = { weapon: o.w == null ? null : o.w, weaponSlots: o.ws || [], armor: o.a, charm: o.c, decos: (o.d || []).map(function (x) { return { slot: x[0], deco: x[1] }; }) };
      var q = { objective: o.o, uptimeScale: o.u, weaponId: spec.weapon, weaponSlots: spec.weaponSlots };
      var b = E.evaluateBuild(GAME, spec, q);
      return b ? { b: b, q: q } : null;
    } catch (e) { return null; }
  }
  function copy(text, el) {
    function done(ok) { if (el) { el.textContent = ok ? 'コピーしました' : 'コピーできませんでした。下の文字を選んでコピーしてください'; } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); done(ok);
      if (!ok && el) { var pre = document.createElement('pre'); pre.className = 'copytext'; pre.textContent = text; el.parentNode.appendChild(pre); }
    }
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.copy) { var s = store[t.dataset.copy]; copy(buildText(s.build, s.title), t.parentNode.querySelector('.copied')); }
    if (t.dataset && t.dataset.share) { var s2 = store[t.dataset.share]; copy(shareUrl(s2.build, s2.query), t.parentNode.querySelector('.copied')); }
  });

  /* ---------- 条件の入力 ---------- */
  var form = $('#search-form');
  var wtSel = $('#weapon-type'), wSel = $('#weapon'), objSel = $('#objective');
  E.WEAPON_TYPES.forEach(function (t) { wtSel.insertAdjacentHTML('beforeend', '<option value="' + t + '">' + E.WEAPON_JA[t] + '</option>'); });
  function ranks() { return Array.prototype.slice.call(form.querySelectorAll('input[name=rank]:checked')).map(function (x) { return x.value; }); }
  function fillWeapons() {
    var t = wtSel.value, rk = ranks();
    // 武器はレア度 11 と 12 だけを候補にします（依頼による）
    var list = GAME.weapons.filter(function (w) { return w.type === t && w.rarity >= 11; });
    list.sort(function (a, b) { return b.rarity - a.rarity || b.attack - a.attack; });
    wSel.innerHTML = '<option value="">武器を選ばず、スロットだけ指定する</option>' + list.map(function (w) {
      var el = w.elements.map(function (x) { return (w.elemHidden ? '(' : '') + (E.ELEM_JA[x[0]] || x[0]) + x[1] + (w.elemHidden ? ')' : ''); }).join(' ');
      return '<option value="' + w.id + '">' + esc(w.ja) + (w.jaMissing ? '［日本語名なし］' : '') + '｜レア' + w.rarity + '｜攻' + w.attack + (w.affinity ? '｜会心' + w.affinity + '%' : '') + (el ? '｜' + esc(el) : '') + '｜' + slotsLabel(w.slots) + '</option>';
    }).join('');
    $('#weapon-slots').hidden = !!wSel.value;
  }
  wtSel.addEventListener('change', fillWeapons);
  wSel.addEventListener('change', function () { $('#weapon-slots').hidden = !!wSel.value; });
  form.querySelectorAll('input[name=rank]').forEach(function (x) { x.addEventListener('change', fillWeapons); });

  // スキルの選択
  var skillDl = $('#skill-list');
  GAME.skills.slice().sort(function (a, b) { return a.ja.localeCompare(b.ja, 'ja'); }).forEach(function (s) { skillDl.insertAdjacentHTML('beforeend', '<option value="' + esc(s.ja) + '">'); });
  var armorDl = $('#armor-list');
  GAME.armors.forEach(function (a) { armorDl.insertAdjacentHTML('beforeend', '<option value="' + esc(a.ja + '｜' + E.PART_JA[a.part] + '｜' + (E.RANK_JA[a.rank] || '') + '｜#' + a.id) + '">'); });
  var decoDl = $('#deco-list');
  GAME.decos.forEach(function (d) { decoDl.insertAdjacentHTML('beforeend', '<option value="' + esc(d.ja + '｜#' + d.id) + '">'); });
  var chosenSkills = [], fixedArmor = {}, excludeArmor = [], excludeDecos = [];
  function findSkillByName(n) { n = (n || '').trim(); return GAME.skills.filter(function (s) { return s.ja === n || s.en.toLowerCase() === n.toLowerCase(); })[0]; }
  function idFromLabel(v) { var m = /#(\d+)\s*$/.exec(v || ''); return m ? +m[1] : null; }
  function renderChips() {
    $('#skill-chips').innerHTML = chosenSkills.map(function (x, i) {
      var s = I.skillById[x.id]; var opts = '';
      for (var l = 1; l <= s.maxAll; l++) opts += '<option' + (l === x.lv ? ' selected' : '') + '>' + l + '</option>';
      return '<span class="chip">' + esc(s.ja) + ' Lv<select data-lv="' + i + '" aria-label="' + esc(s.ja) + 'のレベル">' + opts + '</select>' + (s.maxAll > s.max ? '<span class="muted">（' + (s.max + 1) + '以上は極意が要る）</span>' : '') + '<button type="button" data-rm-skill="' + i + '" aria-label="外す">×</button></span>';
    }).join('') || '<span class="muted">まだありません</span>';
    $('#fixed-chips').innerHTML = Object.keys(fixedArmor).map(function (p) { return '<span class="chip">' + E.PART_JA[p] + '：' + esc(armorName(fixedArmor[p])) + '<button type="button" data-rm-fixed="' + p + '" aria-label="外す">×</button></span>'; }).join('') || '<span class="muted">なし</span>';
    $('#ex-chips').innerHTML = excludeArmor.map(function (id, i) { return '<span class="chip">' + esc(armorName(id)) + '<button type="button" data-rm-ex="' + i + '" aria-label="外す">×</button></span>'; }).join('') || '<span class="muted">なし</span>';
    $('#exd-chips').innerHTML = excludeDecos.map(function (id, i) { return '<span class="chip">' + esc(decoName(id)) + '<button type="button" data-rm-exd="' + i + '" aria-label="外す">×</button></span>'; }).join('') || '<span class="muted">なし</span>';
  }
  form.addEventListener('click', function (ev) {
    var t = ev.target, d = t.dataset || {};
    if (d.rmSkill != null) { chosenSkills.splice(+d.rmSkill, 1); renderChips(); }
    if (d.rmFixed != null) { delete fixedArmor[d.rmFixed]; renderChips(); }
    if (d.rmEx != null) { excludeArmor.splice(+d.rmEx, 1); renderChips(); }
    if (d.rmExd != null) { excludeDecos.splice(+d.rmExd, 1); renderChips(); }
  });
  form.addEventListener('change', function (ev) { var t = ev.target; if (t.dataset && t.dataset.lv != null) chosenSkills[+t.dataset.lv].lv = +t.value; });
  $('#add-skill').addEventListener('click', function () {
    var s = findSkillByName($('#skill-input').value), msg = $('#skill-msg');
    if (!s) { msg.textContent = 'そのスキルは見つかりません。候補から選んでください。'; return; }
    msg.textContent = '';
    if (!chosenSkills.some(function (x) { return x.id === s.id; })) chosenSkills.push({ id: s.id, lv: Math.min(+$('#skill-lv').value || 1, s.maxAll) });
    $('#skill-input').value = ''; renderChips();
  });
  $('#add-fixed').addEventListener('click', function () { var id = idFromLabel($('#fixed-input').value); if (id != null && I.armorById[id]) { fixedArmor[I.armorById[id].part] = id; $('#fixed-input').value = ''; renderChips(); } });
  $('#add-ex').addEventListener('click', function () { var id = idFromLabel($('#ex-input').value); if (id != null && I.armorById[id] && excludeArmor.indexOf(id) < 0) { excludeArmor.push(id); $('#ex-input').value = ''; renderChips(); } });
  $('#add-exd').addEventListener('click', function () { var id = idFromLabel($('#exd-input').value); if (id != null && I.decoById[id] && excludeDecos.indexOf(id) < 0) { excludeDecos.push(id); $('#exd-input').value = ''; renderChips(); } });

  function currentQuery() {
    var ws = [+$('#ws1').value, +$('#ws2').value, +$('#ws3').value].filter(function (x) { return x > 0; });
    var minRes = Array.prototype.map.call(form.querySelectorAll('.minres'), function (x) { return x.value === '' ? null : +x.value; });
    return {
      weaponType: wtSel.value, weaponId: wSel.value ? +wSel.value : null, weaponSlots: wSel.value ? [] : ws,
      ranks: ranks(), objective: objSel.value, skills: chosenSkills.slice(),
      fixedArmor: Object.assign({}, fixedArmor), excludeArmor: excludeArmor.slice(), excludeDecos: excludeDecos.slice(),
      minDefense: +$('#min-def').value || 0, minRes: minRes,
      maxRarity: +$('#max-rarity').value, decoMaxRarity: +$('#deco-rarity').value,
      uptimeScale: +$('#uptime').value, timeLimitMs: +$('#time-limit').value * 1000,
      untilDone: $('#time-limit').value === '0', minRarity: +$('#min-rarity').value
    };
  }

  var resultsEl = $('#results'), statusEl = $('#status');
  function describeStats(st) {
    var t = '調べた組み合わせ ' + st.leaves.toLocaleString() + ' 通り、条件を満たしたもの ' + st.feasible.toLocaleString() + ' 通り、' + fmt(st.timeMs / 1000) + ' 秒。';
    t += '候補の防具（各部位、外せるものを外した後）：' + E.PARTS.map(function (p) { return E.PART_JA[p] + st.poolSizes[p]; }).join('・') + '、護石 ' + st.poolSizes.charm + '。';
    if (st.stoppedByUser) t += ' ⚠ 「止める」で途中で止めました（' + st.passTotal + ' 段のうち ' + st.passes + ' 段まで終わりました）。ここまでに見つけた中の上位を出しています。';
    else if (st.truncated) t += ' ⚠ 時間切れで途中で打ち切りました（' + st.passTotal + ' 段のうち ' + st.passes + ' 段まで終わりました）。もっと良い案が残っているかもしれません。探す時間を長くするか、「最後まで」を選ぶと、さらに調べます。';
    else t += ' 最後まで調べ終わりました（全部の組み合わせを調べたのと同じ結果です）。';
    return t;
  }
  function progressText(p) {
    // ここで考えているのは Claude ではなく、このページの検索プログラム（ブラウザの中の計算）です
    return 'このページの検索プログラムが探しています（Claude ではありません）… 調べた枝 ' + p.nodes.toLocaleString() +
      '、調べた組み合わせ ' + (p.leaves || 0).toLocaleString() + ' 通り、いまの上位の候補 ' + p.found + '（' + fmt(p.ms / 1000) + ' 秒、' + p.passes + ' 段のうち ' + p.pass + ' 段目）';
  }
  var searchCount = 0;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var q = currentQuery();
    if (!q.ranks.length) { statusEl.textContent = 'ランクを 1 つ以上選んでください。'; return; }
    statusEl.textContent = '探しています…';
    $('#stop').hidden = false; $('#go').disabled = true;
    resultsEl.innerHTML = '';
    var n = ++searchCount;
    q.live = true;
    var liveCount = 0;
    runSearch(q, function (p) {
      statusEl.textContent = progressText(p);
      if (p.snapshot && p.snapshot.length) {
        // 探しながら、いまの上位を表示します（まだ探しています）
        liveCount++;
        resultsEl.innerHTML = '<p class="note">途中の結果です（' + fmt(p.ms / 1000) + ' 秒の時点、更新 ' + liveCount + ' 回目）。探し続けているので、順位や中身はまだ変わります。</p>' +
          p.snapshot.map(function (b, i) { return buildCard(b, { id: 'q' + n + '-live-' + (i + 1), title: (i + 1) + '位（途中）', query: q }); }).join('');
      }
    })
      .then(function (r) {
        $('#stop').hidden = true; $('#go').disabled = false;
        statusEl.textContent = describeStats(r.stats);
        if (!r.builds.length) {
          resultsEl.innerHTML = '<p class="warn">条件をすべて満たす組み合わせは見つかりませんでした。スキルのレベルを下げる、ランクを広げる、使わない装備や持っていない装飾品を減らす、防具のレア度の下限を下げる、などを試してください。</p>';
          return;
        }
        resultsEl.innerHTML = r.builds.map(function (b, i) { return buildCard(b, { id: 'q' + n + '-' + (i + 1), title: (i + 1) + '位', query: q }); }).join('');
      }, function (e) { $('#stop').hidden = true; $('#go').disabled = false; statusEl.textContent = 'うまく探せませんでした：' + e.message; });
  });
  $('#stop').addEventListener('click', function () { stopWorker(); });

  /* ---------- あらかじめ作った案 ---------- */
  var pt = $('#preset-type'), po = $('#preset-obj');
  E.WEAPON_TYPES.forEach(function (t) { pt.insertAdjacentHTML('beforeend', '<option value="' + t + '">' + E.WEAPON_JA[t] + '</option>'); });
  function renderPresets() {
    var t = pt.value, o = po.value;
    var grp = PRESETS.groups.filter(function (g) { return g.weaponType === t && g.objective === o; })[0];
    var el = $('#preset-out');
    if (!grp) { el.innerHTML = '<p class="muted">この組み合わせの案はありません。</p>'; return; }
    var html = '<p class="note">' + esc(grp.note || '') + '</p>';
    grp.builds.forEach(function (sb, i) {
      var q = sb.query || grp.query;
      var b = E.evaluateBuild(GAME, sb, q);
      if (!b) return;
      var label = (sb.access === 'easy' ? '入手しやすい案' : '入手が難しい装備も使う案') + ' ' + sb.rankInAccess + '位';
      html += buildCard(b, { id: 'p-' + t + '-' + o + '-' + i, title: (i + 1) + '. ' + label, reason: sb.reason, query: q });
    });
    el.innerHTML = html;
  }
  pt.addEventListener('change', renderPresets); po.addEventListener('change', renderPresets);
  renderPresets();

  /* ---------- 共有された案 ---------- */
  var shared = readShared();
  if (shared) {
    $('#shared').hidden = false;
    $('#shared-out').innerHTML = buildCard(shared.b, { id: 'shared', title: '共有された案', query: shared.q });
  }

  fillWeapons(); renderChips();
  $('#weapon-type').value = 'long-sword'; fillWeapons();

  /* ---------- 言葉で頼む（Claude の sample。使える場所だけ出す） ---------- */
  var nlSec = $('#nl'), nlOut = $('#nl-out'), nlStatus = $('#nl-status');
  var sample = null, nlSeq = 0;
  function hideNl(reason) {
    nlSec.hidden = true;
    $('#nl-off').hidden = false;
    if (reason) $('#nl-off-reason').textContent = reason;
  }
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then(function (s) {
      if (!s) { hideNl('この場所では Claude を呼べないため、言葉で頼む入り口は出していません。'); return; }
      sample = s; nlSec.hidden = false; $('#nl-off').hidden = true;
    }, function () { hideNl(''); });
  } else hideNl('');

  function toolSkills(input) {
    var qv = String(input.query || '').trim();
    var list = GAME.skills.filter(function (s) { return !qv || s.ja.indexOf(qv) >= 0 || s.en.toLowerCase().indexOf(qv.toLowerCase()) >= 0 || s.desc.indexOf(qv) >= 0; }).slice(0, 25);
    return list.map(function (s) { return { name: s.ja, maxLevel: s.max, maxWithSecret: s.maxAll, description: s.desc.replace(/\s+/g, '') }; });
  }
  function toolWeapons(input) {
    var t = String(input.weaponType || ''); if (!E.WEAPON_JA[t]) throw new Error('weaponType は次のどれか: ' + E.WEAPON_TYPES.join(', '));
    var maxR = +input.maxRarity || 12;
    var list = GAME.weapons.filter(function (w) { return w.type === t && w.rarity <= maxR && w.rarity >= 11; });
    list.sort(function (a, b) { return b.attack - a.attack; });
    if (input.element) list = list.filter(function (w) { return w.elements.some(function (x) { return x[0] === input.element || E.ELEM_JA[x[0]] === input.element; }); });
    return list.slice(0, 20).map(function (w) { return { weaponId: w.id, name: w.ja, rarity: w.rarity, attack: w.attack, affinity: w.affinity, element: w.elements.map(function (x) { return (E.ELEM_JA[x[0]] || x[0]) + x[1] + (w.elemHidden ? '(隠し)' : ''); }).join(' '), slots: w.slots }; });
  }
  function summarize(id, b) {
    return { buildId: id, total: +fmt(b.score.total), fire: +fmt(b.score.fire), defensePts: +fmt(b.score.def), comfort: +fmt(b.score.comfort),
      armor: b.armor.map(armorName), charm: charmName(b.charm),
      skills: Object.keys(b.levels).filter(function (k) { return b.levels[k] > 0; }).map(function (k) { return skillName(k) + b.levels[k]; }).join(' '),
      spareSlots: (b.spare || []).map(function (s) { return s.size; }), defense: Math.round(b.score.detail.defense),
      maxArmorRarity: Math.max.apply(null, b.armor.map(function (i) { return I.armorById[i].rarity; })) };
  }
  function toolSearch(input) {
    var skills = [];
    var errs = [];
    (input.skills || []).forEach(function (x) {
      var s = findSkillByName(x.name);
      if (!s) errs.push(x.name); else skills.push({ id: s.id, lv: Math.max(1, Math.min(+x.level || 1, s.maxAll)) });
    });
    if (errs.length) throw new Error('見つからないスキル名: ' + errs.join(', ') + '。findSkills で正しい名前を確かめてください。');
    var t = String(input.weaponType || 'long-sword');
    if (!E.WEAPON_JA[t]) throw new Error('weaponType は次のどれか: ' + E.WEAPON_TYPES.join(', '));
    var q = {
      weaponType: t, weaponId: input.weaponId != null && I.weaponById[+input.weaponId] ? +input.weaponId : null,
      weaponSlots: (input.weaponSlots || []).map(Number).filter(function (x) { return x > 0 && x <= 4; }),
      objective: E.OBJECTIVES[input.objective] ? input.objective : 'fire',
      ranks: (input.ranks && input.ranks.length ? input.ranks : ['MR']).filter(function (r) { return E.RANK_JA[r]; }),
      skills: skills, minDefense: +input.minDefense || 0, maxRarity: +input.maxRarity || 12, decoMaxRarity: +input.decoMaxRarity || 12, minRarity: input.minRarity != null ? +input.minRarity : 10,
      timeLimitMs: 40000
    };
    var sid = 's' + (++nlSeq);
    nlStatus.textContent = 'ページの中で検索しています（' + sid + '）…';
    return runSearch(q).then(function (r) {
      var out = r.builds.map(function (b, i) { var id = sid + '-b' + (i + 1); store[id] = { build: b, query: q, title: '' }; return summarize(id, b); });
      return { searchId: sid, truncated: r.stats.truncated, found: r.stats.feasible, builds: out, note: out.length ? '' : '条件を満たす案がありません' };
    });
  }
  function toolGet(input) {
    var s = store[String(input.buildId)]; if (!s) throw new Error('その buildId はありません');
    var b = s.build;
    var o = summarize(String(input.buildId), b);
    o.weapon = weaponLabel(b);
    o.decorations = b.decos.map(function (d) { return d.slot + ':' + decoName(d.deco); });
    o.setBonuses = (b.bonuses || []).filter(function (x) { return x.active.length; }).map(function (x) { return I.bonusById[x.id].ja + '(' + x.active.map(skillName).join('・') + ')'; });
    o.scoreDetail = { physicalEV: +fmt(b.score.detail.phys), elementEV: +fmt(b.score.detail.elem), affinity: Math.round(b.score.detail.affinity), notCounted: (b.score.notCounted || []).map(skillName) };
    return o;
  }
  function limitSize(x) { var s = JSON.stringify(x); if (s.length > 30000) { if (x.builds) { x.builds = x.builds.slice(0, 5); x.note = '大きすぎるため 5 案に減らしました'; } s = JSON.stringify(x).slice(0, 30000); return s; } return x; }
  var TOOLS = [
    { name: 'findSkills', description: 'スキルを日本語名・英語名・説明文の一部で探し、正しい日本語名と最大レベルを返します。searchBuilds に渡す前に名前を確かめるために使います。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'たとえば「見切り」「会心」「回避」' } }, required: ['query'] }, execute: function (i) { return limitSize(toolSkills(i)); } },
    { name: 'findWeapons', description: '武器種の中から、マスターランクの武器を攻撃力の高い順に最大 20 個返します（weaponId・名前・レア度・攻撃力・会心率・属性・スロット）。', inputSchema: { type: 'object', properties: { weaponType: { type: 'string', enum: E.WEAPON_TYPES }, maxRarity: { type: 'number' }, element: { type: 'string', description: '火・水・雷・氷・龍 など（任意）' } }, required: ['weaponType'] }, execute: function (i) { return limitSize(toolWeapons(i)); } },
    { name: 'searchBuilds', description: 'ページの検索プログラムで、条件を満たす装備の組み合わせを点数の高い順に最大 10 案返します。buildId はこの答えの中のものだけが本物です。objective は fire（火力）・balance（守りとの両立）・defense（守り）・comfort（快適さ）。', inputSchema: { type: 'object', properties: { weaponType: { type: 'string', enum: E.WEAPON_TYPES }, weaponId: { type: 'number' }, weaponSlots: { type: 'array', items: { type: 'number' } }, objective: { type: 'string', enum: ['fire', 'balance', 'defense', 'comfort'] }, skills: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'number' } }, required: ['name', 'level'] } }, ranks: { type: 'array', items: { type: 'string', enum: ['LR', 'HR', 'MR'] } }, minDefense: { type: 'number' }, maxRarity: { type: 'number', description: '防具・護石のレア度の上限（入手しやすさ）' }, minRarity: { type: 'number', description: '防具のレア度の下限。はじめは 10（マスターランク序盤の防具を外す）' }, decoMaxRarity: { type: 'number' } }, required: ['weaponType', 'objective', 'skills'] }, execute: function (i) { return toolSearch(i).then(limitSize); } },
    { name: 'getBuild', description: 'searchBuilds が返した buildId の案の中身（装飾品の場所・シリーズスキル・点数の内訳）を返します。', inputSchema: { type: 'object', properties: { buildId: { type: 'string' } }, required: ['buildId'] }, execute: function (i) { return limitSize(toolGet(i)); } }
  ];
  function nlPrompt(text) {
    return [
      'あなたは「モンスターハンターワールド：アイスボーン」の装備検索ページの案内役です。',
      '見る人の頼み：「' + text + '」',
      '',
      'やること：',
      '1. 頼みを検索条件に直します。スキル名は findSkills で確かめ、武器を決めるなら findWeapons を使います。',
      '2. searchBuilds を 1〜2 回呼びます（呼びすぎない）。条件を満たす案がなければ、条件を少し緩めてもう一度探し、何を緩めたかを説明します。',
      '3. 検索結果の候補から、頼みに合う順に最大 5 案を選び、短い日本語の理由（です・ます）を付けます。',
      '',
      '決まり：装備名やスキルの数値を自分で作ってはいけません。理由の中で数値を言うときは、道具の答えにある数だけを使います。buildId は searchBuilds の答えにあるものだけを使います。攻略サイトの知識ではなく、道具の答えで判断します。',
      '最後の答えは、次の形の JSON だけを書きます（前後に文章を書かない）：',
      '{"summary":"条件をどう直したか（1〜2 文）","ranking":[{"buildId":"s1-b1","reason":"理由"}],"relax":"満たせなかったときに緩めたこと、または空文字"}'
    ].join('\n');
  }
  function parseAnswer(t) {
    var a = t.lastIndexOf('{"summary"'); if (a < 0) a = t.indexOf('{');
    var z = t.lastIndexOf('}');
    if (a < 0 || z < a) return null;
    try { return JSON.parse(t.slice(a, z + 1)); } catch (e) { return null; }
  }
  var nlBusy = false, nlCtl = null;
  $('#nl-go').addEventListener('click', function () {
    if (!sample || nlBusy) return;
    var text = $('#nl-text').value.trim();
    if (!text) { nlStatus.textContent = '頼みを書いてください。'; return; }
    nlBusy = true; $('#nl-go').disabled = true; nlOut.innerHTML = ''; nlStatus.textContent = 'Claude に頼んでいます…（時間がかかることがあります）';
    nlCtl = new AbortController(); $('#nl-stop').hidden = false;
    var chosenModel = $('#nl-model').value, chosenEffort = $('#nl-effort').value;
    var TIER = { 'claude-opus-5-5': 'complex', 'claude-fable-5-1': 'complex', 'claude-sonnet-5-5': 'default', 'claude-haiku-5-5': 'quick' };
    var MODEL_JA = { 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-1': 'Fable 5.1', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
    var TIER_JA = { complex: '一番よく考える段階', 'default': '標準の段階', quick: '速い段階' };
    var opts = { modelTier: chosenModel ? TIER[chosenModel] : 'default', effort: chosenEffort, tools: TOOLS, signal: nlCtl.signal, onText: function () { nlStatus.textContent = 'Claude が答えを書いています…'; } };
    if (chosenModel) opts.model = chosenModel;
    sample(nlPrompt(text), opts).then(function (res) {
      var note = '';
      var tierTxt = TIER_JA[res.modelTierApplied] || res.modelTierApplied || '不明';
      if (chosenModel && res.modelApplied !== chosenModel) note = '⚠ 選んだ ' + esc(MODEL_JA[chosenModel]) + '（' + esc(chosenModel) + '）は使えなかったため、別のモデル（' + esc(tierTxt) + '）が答えました。';
      else if (chosenModel) note = esc(MODEL_JA[chosenModel]) + '（' + esc(chosenModel) + '）が答えました。';
      else note = 'おまかせの指定で、' + esc(tierTxt) + 'のモデルが答えました。';
      var ans = parseAnswer(res.text);
      if (!ans) { nlStatus.innerHTML = note + ' 答えの形が読めませんでした。言い方を変えてもう一度試すか、下の「条件で探す」を使ってください。'; return; }
      var html = '<p>' + esc(ans.summary || '') + '</p>' + (ans.relax ? '<p class="warn">緩めた条件：' + esc(ans.relax) + '</p>' : '');
      var shown = 0, skipped = 0;
      (ans.ranking || []).slice(0, 5).forEach(function (x) {
        var s = store[String(x.buildId)];
        if (!s || !/^s\d+-b\d+$/.test(String(x.buildId))) { skipped++; return; } // 検索結果にない id は出さない
        shown++;
        html += buildCard(s.build, { id: 'nl-' + x.buildId, title: shown + '位（Claude の順位）', reason: x.reason, query: s.query });
      });
      if (skipped) html += '<p class="muted">検索結果にない案が ' + skipped + ' 個あったため、表示しませんでした。</p>';
      if (!shown) html += '<p class="warn">表示できる案がありませんでした。</p>';
      nlOut.innerHTML = html;
      nlStatus.innerHTML = note + (res.truncated ? ' 答えが途中で切れました。' : '');
    }, function (e) {
      var c = e && e.code;
      if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'tools_unavailable' || c === 'capability_removed') { hideNl('この表示では Claude を使う許可がないため、言葉で頼む入り口を閉じました。'); return; }
      if (c === 'cancelled') { nlStatus.textContent = '止めました。'; return; }
      if (c === 'rate_limited') { nlStatus.textContent = 'いまは Claude の利用枠の上限に達しています。時間をおいて、ご自身でもう一度押してください。'; return; }
      nlStatus.textContent = 'うまくいきませんでした（' + (c || '') + '）：' + (e && e.message || '');
    }).then(function () { nlBusy = false; $('#nl-go').disabled = false; $('#nl-stop').hidden = true; });
  });
  $('#nl-stop').addEventListener('click', function () { if (nlCtl) nlCtl.abort(); });

  // 試験用に一部を外から見えるようにします
  window.__app = { store: store, TOOLS: TOOLS, runSearch: runSearch, workerOk: function () { return workerOk; }, parseAnswer: parseAnswer };
})();
