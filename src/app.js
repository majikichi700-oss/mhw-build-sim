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
  // tag：だれの検索か（'form' は条件検索、'claude' は Claude の道具）。「止める」は tag ごとに止めます。
  var mainStops = {};
  function runSearch(q, onProgress, tag) {
    tag = tag || 'form';
    if (worker && workerOk) {
      return new Promise(function (resolve, reject) {
        var id = ++jobSeq;
        jobs[id] = { resolve: resolve, reject: reject, onProgress: onProgress, tag: tag };
        worker.postMessage({ type: 'search', job: id, query: q });
      });
    }
    // Web Worker が使えないとき：少しずつ処理して、そのたびに画面へ戻ります
    return new Promise(function (resolve, reject) {
      var it, key = 'm' + (++jobSeq);
      mainStops[key] = { tag: tag, stop: false };
      var q2 = Object.assign({}, q, { stopSignal: function () { return mainStops[key].stop; } });
      try { it = E.searchGen(GAME, q2); } catch (e) { delete mainStops[key]; reject(e); return; }
      (function step() {
        try {
          var t = Date.now(), r;
          while (true) {
            r = it.next();
            if (r.done) { delete mainStops[key]; resolve(stripResult(r.value)); return; }
            onProgress && onProgress(r.value);
            if (Date.now() - t > 40) break;
          }
          setTimeout(step, 0);
        } catch (e) { delete mainStops[key]; reject(e); }
      })();
    });
  }
  // 「止める」：その tag の検索に止まるよう知らせ、それまでの結果を受け取ります。
  // 3 秒たっても返事がないときだけ、Web Worker ごと止めます（そのときは、動いていた検索を全部「止めました」で終えます）。
  function stopWorker(tag) {
    tag = tag || 'form';
    for (var k in mainStops) if (mainStops[k].tag === tag) mainStops[k].stop = true;
    var ids = Object.keys(jobs).filter(function (id) { return jobs[id].tag === tag; });
    if (!ids.length) return;
    ids.forEach(function (id) { if (worker) worker.postMessage({ type: 'stop', job: +id }); });
    setTimeout(function () {
      if (!ids.some(function (id) { return jobs[id]; })) return;
      if (worker) worker.terminate();
      Object.keys(jobs).forEach(function (id) { jobs[id].reject(new Error('止めました')); delete jobs[id]; });
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
    var wsl = b.weaponSlots || (b.weapon != null ? I.weaponById[b.weapon].slots : []);
    rows.push('<tr><th>武器</th><td>' + esc(weaponLabel(b)) + '<div class="slots">' + slotCells('weapon', wsl) + '</div></td></tr>');
    E.PARTS.forEach(function (p, i) {
      var a = E.armorOf(GAME, b.mods || {}, b.armor[i]); // カスタム強化を入れた防具は、入れたスロットで表示します
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
      var unlocked = s.unlockedBy != null && ((b.levels[s.unlockedBy] || 0) > 0 || (I.inheritId != null && (b.levels[I.inheritId] || 0) > 0));
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
  function elemText(d) {
    if (!d.elemShown || !d.elemShown.length) return '属性なし（毒などの状態異常は数えません）';
    var t = d.elemShown.map(function (x) { return (E.ELEM_JA[x[0]] || x[0]) + ' ' + fmt(x[1], 0); }).join('・');
    var parts = [fmt(d.elem0) + ' から ' + fmt(d.elem) + '（スキル込みの属性値 ' + t + '）'];
    if (d.hiddenFrac > 0 && d.hiddenFrac < 1) parts.push('隠し属性は ' + Math.round(d.hiddenFrac * 100) + '% 出る見込み');
    if (d.critElem) parts.push('会心時の属性 ' + fmt(d.critElem, 2) + ' 倍');
    if (d.elemWeight !== 1) parts.push('属性の重み ' + d.elemWeight + ' 倍');
    return parts.join('、');
  }
  function partsText(d) {
    var P = d.parts || {}, out = [];
    if (P.art > 0) out.push('爆発を伴う攻撃 ' + Math.round(P.art * 100) + '%（砲術 ' + fmt(d.art, 2) + ' 倍）');
    if (P.special > 0) out.push('特殊弾など ' + Math.round(P.special * 100) + '%（' + fmt(d.special, 2) + ' 倍）');
    if (P.jump > 0) out.push('ジャンプ攻撃 ' + Math.round(P.jump * 100) + '%（飛燕 ' + fmt(d.jump, 2) + ' 倍）');
    return out.length ? '<tr><th>　攻撃の内わけ</th><td>' + out.join('、') + '</td></tr>' : '';
  }
  function modsText(m) {
    if (!m) return '';
    var t = [];
    if (m.weaponOverride) {
      var w = m.weaponOverride, x = [];
      if (w.attack) x.push('表示攻撃力 ' + w.attack); if (w.affinity != null) x.push('会心率 ' + w.affinity + '%');
      if (w.element) x.push(w.element[1] > 0 ? (E.ELEM_JA[w.element[0]] || '') + ' ' + w.element[1] : '属性なし'); if (w.slots) x.push('スロット ' + slotsLabel(w.slots)); if (w.defense != null) x.push('防御 ' + w.defense);
      t.push('武器（入力した値）：' + x.join('、'));
    }
    if (m.armorAugMax) t.push('防具の防御力はカスタム強化の最大');
    if (m.armorOverrides) t.push('強化した防具（入力した値）：' + Object.keys(m.armorOverrides).map(function (id) { var o = m.armorOverrides[id]; return armorName(+id) + '［' + (o.slots ? slotsLabel(o.slots) : 'スロットはデータのまま') + (o.addSkills ? '・' + o.addSkills.map(function (y) { return skillName(y[0]) + '+' + y[1]; }).join('・') : '') + '］'; }).join('、'));
    return t.join('。');
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
      '<tr><th>　属性期待値</th><td>' + elemText(d) + '</td></tr>' +
      partsText(d) +
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
      (modsText(b.mods) ? '<p class="note">' + esc(modsText(b.mods)) + '</p>' : '') +
      '<table class="parts">' + partRows(b) + '</table>' +
      '<div class="cols"><div><h4>発動スキル</h4><ul class="skills">' + skillList(b, opt.query && opt.query.skills) + '</ul></div>' +
      '<div><h4>シリーズスキル</h4><ul class="skills">' + bonusList(b) + '</ul>' +
      '<h4>余るスロット</h4><p>' + (sp || 'なし') + '</p>' +
      '<h4>防御力と耐性</h4><p>防御力 ' + fmt(d.defense, 0) + '（' + (b.mods && b.mods.armorAugMax ? 'カスタム強化の最大' : '強化最大') + '、スキル込み）<br>' + d.res.map(function (r, i) { return E.ELEM_JA[E.ELEMS[i]] + '耐性 ' + fmt(r, 0); }).join('、') + '</p></div></div>' +
      scoreBlock(b) +
      '<div class="actions"><button type="button" data-copy="' + esc(id) + '">一覧をコピー</button><button type="button" data-share="' + esc(id) + '">この案の URL をコピー</button><span class="copied" aria-live="polite"></span></div>' +
      '</article>';
    return html;
  }
  function buildText(b, title) {
    var lines = ['【MHW:IB 装備案】' + (title || '')];
    var byslot = {}; b.decos.forEach(function (d) { byslot[d.slot] = d; });
    function sl(prefix, slots) { return slots.map(function (sz, j) { var d = byslot[prefix + '#' + j]; return NUM[sz] + (d ? decoName(d.deco) : '空き'); }).join(' / '); }
    var wsl = b.weaponSlots || (b.weapon != null ? I.weaponById[b.weapon].slots : []);
    lines.push('武器: ' + weaponLabel(b) + (wsl.length ? '［' + sl('weapon', wsl) + '］' : ''));
    E.PARTS.forEach(function (p, i) { var a = E.armorOf(GAME, b.mods || {}, b.armor[i]); lines.push(E.PART_JA[p] + ': ' + a.ja + (a.slots.length ? '［' + sl(p, a.slots) + '］' : '')); });
    lines.push('護石: ' + charmName(b.charm));
    lines.push('発動スキル: ' + Object.keys(b.levels).filter(function (k) { return b.levels[k] > 0; }).sort(function (x, y) { return b.levels[y] - b.levels[x]; }).map(function (k) { return skillName(k) + ' Lv' + b.levels[k]; }).join('、'));
    var bo = (b.bonuses || []).filter(function (x) { return x.active.length; }).map(function (x) { return I.bonusById[x.id].ja + '（' + x.active.map(skillName).join('・') + '）'; });
    if (bo.length) lines.push('シリーズスキル: ' + bo.join('、'));
    if (modsText(b.mods)) lines.push('強化：' + modsText(b.mods));
    lines.push('防御力 ' + Math.round(b.score.detail.defense) + '（' + (b.mods && b.mods.armorAugMax ? 'カスタム強化の最大' : '強化最大') + 'の値。ゲーム内で確かめてください）');
    return lines.join('\n');
  }
  function shareUrl(b, q) {
    var o = { v: 1, w: b.weapon, ws: b.weapon == null ? b.weaponSlots : undefined, a: b.armor, c: b.charm, d: b.decos.map(function (x) { return [x.slot, x.deco]; }), o: b.objective || 'fire', u: q && q.uptimeScale, m: b.mods || undefined, t: b.weaponType || (q && q.weaponType) || undefined };
    var s = btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0] + '#b=' + s;
  }
  function readShared() {
    var m = /#b=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return null;
    try {
      var s = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      var o = JSON.parse(decodeURIComponent(escape(atob(s))));
      var spec = { weapon: o.w == null ? null : o.w, weaponSlots: o.ws || [], armor: o.a, charm: o.c, decos: (o.d || []).map(function (x) { return { slot: x[0], deco: x[1] }; }), mods: o.m || null, weaponType: o.t || null };
      var q = { objective: o.o, uptimeScale: o.u, weaponId: spec.weapon, weaponSlots: spec.weaponSlots, weaponType: o.t || null };
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
  function resetParts() {
    var d = E.PARTS_DEFAULT[wtSel.value] || { art: 0, special: 0, jump: 0 };
    $('#part-art').value = Math.round(d.art * 100); $('#part-special').value = Math.round(d.special * 100); $('#part-jump').value = Math.round(d.jump * 100);
  }
  wtSel.addEventListener('change', function () { fillWeapons(); resetParts(); clearWeaponOverride(); });
  // 武器を変えたら、前の武器のために入れたカスタム強化の数値を消します
  function clearWeaponOverride() { ['#wo-attack', '#wo-aff', '#wo-eval', '#wo-def'].forEach(function (k) { $(k).value = ''; }); $('#wo-etype').value = ''; $('#wo-s1').value = ''; $('#wo-s2').value = '0'; $('#wo-s3').value = '0'; }
  wSel.addEventListener('change', function () { $('#weapon-slots').hidden = !!wSel.value; clearWeaponOverride(); });
  form.querySelectorAll('input[name=rank]').forEach(function (x) { x.addEventListener('change', fillWeapons); });

  // スキルの選択
  var skillDl = $('#skill-list');
  GAME.skills.slice().sort(function (a, b) { return a.ja.localeCompare(b.ja, 'ja'); }).forEach(function (s) { skillDl.insertAdjacentHTML('beforeend', '<option value="' + esc(s.ja) + '">'); });
  var armorDl = $('#armor-list');
  GAME.armors.forEach(function (a) { armorDl.insertAdjacentHTML('beforeend', '<option value="' + esc(a.ja + '｜' + E.PART_JA[a.part] + '｜' + (E.RANK_JA[a.rank] || '') + '｜#' + a.id) + '">'); });
  var decoDl = $('#deco-list');
  GAME.decos.forEach(function (d) { decoDl.insertAdjacentHTML('beforeend', '<option value="' + esc(d.ja + '｜#' + d.id) + '">'); });
  var chosenSkills = [], fixedArmor = {}, excludeArmor = [], excludeDecos = [], armorOverrides = {};
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
    $('#ao-chips').innerHTML = Object.keys(armorOverrides).map(function (id) {
      var o = armorOverrides[id];
      return '<span class="chip">' + esc(armorName(+id)) + '：スロット ' + (o.slots ? slotsLabel(o.slots) : 'データのまま') + (o.addSkills && o.addSkills.length ? '、' + o.addSkills.map(function (x) { return esc(skillName(x[0])) + '+' + x[1]; }).join('・') : '') + '<button type="button" data-rm-ao="' + id + '" aria-label="外す">×</button></span>';
    }).join('') || '<span class="muted">なし</span>';
    $('#exd-chips').innerHTML = excludeDecos.map(function (id, i) { return '<span class="chip">' + esc(decoName(id)) + '<button type="button" data-rm-exd="' + i + '" aria-label="外す">×</button></span>'; }).join('') || '<span class="muted">なし</span>';
  }
  form.addEventListener('click', function (ev) {
    var t = ev.target, d = t.dataset || {};
    if (d.rmSkill != null) { chosenSkills.splice(+d.rmSkill, 1); renderChips(); }
    if (d.rmFixed != null) { delete fixedArmor[d.rmFixed]; renderChips(); }
    if (d.rmEx != null) { excludeArmor.splice(+d.rmEx, 1); renderChips(); }
    if (d.rmExd != null) { excludeDecos.splice(+d.rmExd, 1); renderChips(); }
    if (d.rmAo != null) { delete armorOverrides[d.rmAo]; renderChips(); }
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
  $('#add-ao').addEventListener('click', function () {
    var id = idFromLabel($('#ao-input').value); if (id == null || !I.armorById[id]) return;
    var o = {};
    // スロットが「データのまま」なら、スロットは変えません
    if ($('#ao-s1').value !== '') o.slots = [+$('#ao-s1').value, +$('#ao-s2').value, +$('#ao-s3').value].filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; });
    var sk = findSkillByName($('#ao-skill').value);
    if (sk) o.addSkills = [[sk.id, +$('#ao-lv').value]];
    if (!o.slots && !o.addSkills) return;
    armorOverrides[id] = o; $('#ao-input').value = ''; $('#ao-skill').value = ''; renderChips();
  });
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
      untilDone: $('#time-limit').value === '0', minRarity: +$('#min-rarity').value,
      elemWeight: +$('#elem-weight').value,
      parts: { art: (+$('#part-art').value || 0) / 100, special: (+$('#part-special').value || 0) / 100, jump: (+$('#part-jump').value || 0) / 100 },
      weaponOverride: weaponOverride(), armorAugMax: $('#armor-augmax').checked,
      armorOverrides: Object.keys(armorOverrides).length ? JSON.parse(JSON.stringify(armorOverrides)) : null
    };
  }
  function weaponOverride() {
    if (!wSel.value) return null;
    var o = {};
    if ($('#wo-attack').value !== '') o.attack = +$('#wo-attack').value;
    if ($('#wo-aff').value !== '') o.affinity = +$('#wo-aff').value;
    if ($('#wo-etype').value && $('#wo-eval').value !== '') o.element = [$('#wo-etype').value, +$('#wo-eval').value];
    if ($('#wo-s1').value !== '') o.slots = [+$('#wo-s1').value, +$('#wo-s2').value, +$('#wo-s3').value].filter(function (x) { return x > 0; });
    if ($('#wo-def').value !== '') o.defense = +$('#wo-def').value;
    return Object.keys(o).length ? o : null;
  }

  var resultsEl = $('#results'), statusEl = $('#status');
  function describeStats(st) {
    var t = '調べた組み合わせ ' + st.leaves.toLocaleString() + ' 通り、条件を満たしたもの ' + st.feasible.toLocaleString() + ' 通り、' + fmt(st.timeMs / 1000) + ' 秒。';
    t += '候補の防具（各部位、外せるものを外した後）：' + E.PARTS.map(function (p) { return E.PART_JA[p] + st.poolSizes[p]; }).join('・') + '、護石 ' + st.poolSizes.charm + '。';
    if (st.stoppedByUser) t += ' ⚠ 「止める」で途中で止めました（' + st.passTotal + ' 段のうち ' + st.passes + ' 段まで終わりました）。ここまでに見つけた中の上位を出しています。';
    else if (st.truncated) t += ' ⚠ 時間切れで途中で打ち切りました（' + st.passTotal + ' 段のうち ' + st.passes + ' 段まで終わりました）。もっと良い案が残っているかもしれません。探す時間を長くするか、「最後まで」を選ぶと、さらに調べます。';
    else t += ' 最後まで調べ終わりました（防具と護石の組み合わせは全部調べたのと同じ結果です）。';
    if (st.refined != null) t += ' 上位の案のうち ' + st.refined + ' 案は、装飾品の入れ方を丁寧に磨き直しました（それでも一番よい入れ方とは限りません）。';
    return t;
  }
  function progressText(p) {
    if (p.refining) return 'このページの検索プログラムが、見つけた上位の案の装飾品の入れ方を磨き直しています（Claude ではありません）… ' + p.refined + ' / ' + p.total + ' 案（' + fmt(p.ms / 1000) + ' 秒）';
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
        if (!r.builds.length && r.stats.truncated) {
          resultsEl.innerHTML = '<p class="warn">' + (r.stats.stoppedByUser ? '止めるまでに' : '時間内に') + '、条件をすべて満たす組み合わせは見つかりませんでした。まだ調べていない組み合わせが残っています。探す時間を長くするか、「最後まで」を選んでください。</p>';
          return;
        }
        if (!r.builds.length) {
          resultsEl.innerHTML = '<p class="warn">条件をすべて満たす組み合わせは見つかりませんでした。スキルのレベルを下げる、ランクを広げる、使わない装備や持っていない装飾品を減らす、防具のレア度の下限を下げる、などを試してください。</p>';
          return;
        }
        resultsEl.innerHTML = r.builds.map(function (b, i) { return buildCard(b, { id: 'q' + n + '-' + (i + 1), title: (i + 1) + '位', query: q }); }).join('');
      }, function (e) { $('#stop').hidden = true; $('#go').disabled = false; statusEl.textContent = 'うまく探せませんでした：' + e.message; });
  });
  $('#stop').addEventListener('click', function () { stopWorker('form'); });

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

  fillWeapons(); renderChips(); resetParts();
  $('#weapon-type').value = 'long-sword'; fillWeapons(); resetParts();

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
    // 画面で入れた計算の設定（条件付きスキルの見込み・属性の重み・攻撃の内わけ・防具の強化）も同じように使います
    var page = currentQuery();
    q.uptimeScale = page.uptimeScale; q.elemWeight = page.elemWeight; q.armorAugMax = page.armorAugMax; q.armorOverrides = page.armorOverrides;
    if (t === wtSel.value) q.parts = page.parts;
    if (q.weaponId != null && page.weaponId === q.weaponId) q.weaponOverride = page.weaponOverride;
    return runSearch(q, null, 'claude').then(function (r) {
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
  $('#nl-stop').addEventListener('click', function () { if (nlCtl) nlCtl.abort(); stopWorker('claude'); });

  // 試験用に一部を外から見えるようにします
  window.__app = { store: store, TOOLS: TOOLS, runSearch: runSearch, workerOk: function () { return workerOk; }, parseAnswer: parseAnswer };
})();
