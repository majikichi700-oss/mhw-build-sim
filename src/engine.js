/* 装備検索の中心。ブラウザ（画面・Web Worker）と Node（試験）の両方で動きます。
 * ゲームの数値はすべて data/game.json（MHWorldData から変換）から読みます。
 * ここに書いてある数は「点数の付け方」の判断（重み）と、README に書いた前提の数だけです。 */
(function (root) {
  'use strict';
  var PARTS = ['head', 'chest', 'arms', 'waist', 'legs'];
  var PART_JA = { head: '頭', chest: '胴', arms: '腕', waist: '腰', legs: '脚', charm: '護石', weapon: '武器' };
  var ELEMS = ['fire', 'water', 'thunder', 'ice', 'dragon'];
  var ELEM_JA = { fire: '火', water: '水', thunder: '雷', ice: '氷', dragon: '龍', poison: '毒', sleep: '睡眠', paralysis: '麻痺', blast: '爆破' };
  var RANK_JA = { LR: '下位', HR: '上位', MR: 'マスターランク' };
  var WEAPON_TYPES = ['great-sword', 'long-sword', 'sword-and-shield', 'dual-blades', 'hammer', 'hunting-horn', 'lance', 'gunlance', 'switch-axe', 'charge-blade', 'insect-glaive', 'light-bowgun', 'heavy-bowgun', 'bow'];
  var WEAPON_JA = { 'great-sword': '大剣', 'long-sword': '太刀', 'sword-and-shield': '片手剣', 'dual-blades': '双剣', hammer: 'ハンマー', 'hunting-horn': '狩猟笛', lance: 'ランス', gunlance: 'ガンランス', 'switch-axe': 'スラッシュアックス', 'charge-blade': 'チャージアックス', 'insect-glaive': '操虫棍', 'light-bowgun': 'ライトボウガン', 'heavy-bowgun': 'ヘビィボウガン', bow: '弓' };
  var RANGED = { 'light-bowgun': 1, 'heavy-bowgun': 1, bow: 1 };

  /* ---- データにない前提の数（README「データにない前提の数」に理由を書いています） ---- */
  // 武器倍率：表示攻撃力を基礎攻撃力に直す割り算の数。データからは一つに決まらないため、
  // 表示攻撃力をすべて割り切れる候補の中から、一般に知られている値を選んでいます。
  var WEAPON_BLOAT = { 'great-sword': 4.8, 'long-sword': 3.3, 'sword-and-shield': 1.4, 'dual-blades': 1.4, hammer: 5.2, 'hunting-horn': 4.2, lance: 2.3, gunlance: 2.3, 'switch-axe': 3.5, 'charge-blade': 3.6, 'insect-glaive': 3.1, 'light-bowgun': 1.3, 'heavy-bowgun': 1.5, bow: 1.2 };
  var NEG_CRIT = 0.25; // マイナス会心のときに減る割合（データにないため前提）
  var ELEM_DIV = 10;   // 属性の表示値を物理と足すときに割る数（判断）

  /* ---- 点数の重み（判断。README と画面に同じ説明があります） ---- */
  var SURVIVAL = ['Recovery Up', 'Recovery Speed', 'Earplugs', 'Windproof', 'Tremor Resistance', 'Stun Resistance', 'Evade Window', 'Flinch Free', 'Guard', 'Guard Up', 'Blight Resistance', 'Hasten Recovery', 'Super Recovery', 'Guts', 'Fortify', 'Resuscitate', 'Poison Resistance', 'Paralysis Resistance', 'Sleep Resistance', 'Bleeding Resistance', 'Effluvia Resistance', 'Heat Guard', 'Coldproof', 'Iron Skin', "Gaia's Veil", "True Gaia's Veil", 'Nullify Wind Pressure', 'Divine Blessing Secret'];
  var COMFORT = ['Evade Extender', 'Speed Sharpening', 'Free Meal', 'Item Prolonger', 'Wide-Range', 'Speed Eating', 'Marathon Runner', 'Constitution', 'Stamina Surge', 'Mushroomancer', 'Quick Sheath', 'Earplugs', 'Windproof', 'Tremor Resistance', 'Flinch Free', 'Stun Resistance', 'Slinger Capacity', 'Recovery Speed', 'Stamina Cap Up', 'Botanist', 'Geologist', 'Aquatic/Polar Mobility', 'Jump Master', 'Survival Expert', 'Hunger Resistance', 'Power Prolonger', 'Focus', 'Capacity Boost', 'Horn Maestro', 'Speed Crawler', 'Cliffhanger', 'Clutch Claw Boost', 'Safe Landing', 'Detector', 'Free Meal Secret', 'Master Mounter', 'Scoutfly Range Up'];
  var W = {
    surv: 8, resPt: 3, healthPt: 2, cutPt: 3, defDiv: 10, // 守り点 =（防御力 + 耐性合計×3 + 体力×2 + 生存スキルLv×8 + 軽減%×発動割合×3）÷10
    comfortLv: 3, spare: [0, 2, 4, 6, 9],                 // 快適点 = 余りスロット（1:2, 2:4, 3:6, 4:9）+ 便利スキルLv×3
    balanceDef: 0.5                                      // 守りとの両立 = 火力点 + 守り点×0.5
  };
  var OBJECTIVES = {
    fire: { ja: '火力', w: [1, 0, 0] },
    balance: { ja: '守りとの両立', w: [1, W.balanceDef, 0] },
    defense: { ja: '守り', w: [0, 1, 0] },
    comfort: { ja: '快適さ', w: [0, 0, 1] }
  };

  function indexGame(g) {
    if (g._idx) return g._idx;
    var I = { skillByEn: {}, skillById: {}, armorById: {}, decoById: {}, charmById: {}, weaponById: {}, setById: {}, bonusById: {} };
    g.skills.forEach(function (s) { I.skillByEn[s.en] = s; I.skillById[s.id] = s; });
    g.armors.forEach(function (a) { I.armorById[a.id] = a; });
    g.decos.forEach(function (d) { I.decoById[d.id] = d; });
    g.charms.forEach(function (c) { I.charmById[c.id] = c; });
    g.weapons.forEach(function (w) { I.weaponById[w.id] = w; });
    g.sets.forEach(function (s) { I.setById[s.id] = s; });
    g.bonuses.forEach(function (b) { I.bonusById[b.id] = b; });
    function ids(list) { return list.map(function (n) { return I.skillByEn[n] ? I.skillByEn[n].id : -1; }).filter(function (x) { return x >= 0; }); }
    I.survival = {}; ids(SURVIVAL).forEach(function (i) { I.survival[i] = 1; });
    I.comfort = {}; ids(COMFORT).forEach(function (i) { I.comfort[i] = 1; });
    // 説明文から火力・守りの数値が読めたスキル
    I.fireSkill = {}; I.defSkill = {};
    g.skills.forEach(function (s) {
      s.levels.forEach(function (l) {
        var e = l.eff; if (!e) return;
        if (e.cond === 'draw' || e.cond === 'faint') return;
        if (e.atk || e.atkMul || e.aff || e.critMul || e.elemAdd || e.elemMul || e.elemAddAll) I.fireSkill[s.id] = 1;
        if (e.def || e.defMul || e.res || e.resAll || e.health || e.dmgCut || e.resMul) I.defSkill[s.id] = 1;
      });
    });
    // データの英語の説明で「極意の上限をなくす」とされているスキル（Fatalis Legend の 2 部位で付く）
    I.inheritId = I.skillByEn['Inheritance'] ? I.skillByEn['Inheritance'].id : null;
    g._idx = I;
    return I;
  }

  function rankOfRarity(r) { return r <= 4 ? 'LR' : (r <= 8 ? 'HR' : 'MR'); }

  /* スキルの上限（極意で上がる分を含む） */
  function skillCap(s, unlocked) { return unlocked ? s.maxAll : s.max; }

  /* ---------- 点数 ---------- */
  /* 条件付きスキルを数える割合（判断）。理由はスキルの説明文（skill_base の description_ja）に書かれた条件です。 */
  var UPTIME = {
    'Weakness Exploit': 0.8,   // 有効な部位に当てたとき
    'Agitator': 0.5,           // モンスターが怒っている間
    'Peak Performance': 0.6,   // 体力が最大のとき
    'Latent Power': 0.3,       // 特定の条件のあと一定時間
    'Maximum Might': 0.7,      // スタミナが満タンの状態をしばらく保つ間
    'Resentment': 0.3,         // 体力に赤い部分がある間
    'Heroics': 0,              // 体力が 35% 以下のとき（狙わない前提で数えない）
    'Offensive Guard': 0.3,    // ガードを決めたあと一定時間（ガードできる武器だけ）
    'Coalescence': 0.2,        // 状態異常などを解除したあと一定時間
    'Divine Blessing': 0.3     // 一定の確率
  };
  var GUARD_WEAPONS = { lance: 1, gunlance: 1, 'charge-blade': 1, 'sword-and-shield': 1, 'great-sword': 1 };
  function condWeight(cond, s, q, wi) {
    if (!cond) return 1;
    if (cond === 'draw' || cond === 'faint') return 0;
    var u = UPTIME[s.en] != null ? UPTIME[s.en] : 0.5;
    if (s.en === 'Offensive Guard' && !(wi.type && GUARD_WEAPONS[wi.type])) u = 0;
    return Math.min(1, u * (q.uptimeScale == null ? 1 : q.uptimeScale));
  }

  function weaponInfo(g, q) {
    var I = indexGame(g);
    var w = q.weaponId != null ? I.weaponById[q.weaponId] : null;
    if (w) {
      var el = (!w.elemHidden) ? w.elements.filter(function (e) { return ELEMS.indexOf(e[0]) >= 0; }) : [];
      return { w: w, raw: w.attack / WEAPON_BLOAT[w.type], aff: w.affinity, elems: el, defense: w.defense, slots: w.slots.slice(), skills: w.skills, bonus: w.bonus, type: w.type };
    }
    // 武器を選ばないときの「基準の武器」（判断）：基礎攻撃力 200、会心率 0%、属性なし
    return { w: null, raw: 200, aff: 0, elems: [], defense: 0, slots: (q.weaponSlots || []).slice().sort(function (a, b) { return b - a; }), skills: [], bonus: null, type: q.weaponType || null };
  }

  /* levels: {skillId: level}（上限で切った後）, spare: 余りスロットの大きさの配列 */
  function scoreParts(g, q, wi, levels, spare, baseDef, baseRes) {
    var I = indexGame(g);
    var atk = 0, atkMul = 1, aff = wi.aff, crit = 0, elemAdd = {}, elemMul = {}, elemAll = 0;
    var defAdd = 0, defMul = 1, resAll = 0, res = [0, 0, 0, 0, 0], resMul = 1, health = 0, cut = 0, survLv = 0, comfortLv = 0;
    var notCounted = [];
    for (var k in levels) {
      var lv = levels[k]; if (!lv) continue;
      var s = I.skillById[k];
      var L = s.levels[Math.min(lv, s.levels.length) - 1];
      var e = L && L.eff;
      if (I.survival[k]) survLv += lv;
      if (I.comfort[k]) comfortLv += lv;
      if (!e) { if (!I.survival[k] && !I.comfort[k]) notCounted.push(+k); continue; }
      var cw = condWeight(e.cond, s, q, wi);
      if (cw === 0) { notCounted.push(+k); continue; }
      if (e.atk) atk += cw * e.atk;
      if (e.atkMul) atkMul *= 1 + cw * (e.atkMul - 1);
      if (e.aff) aff += cw * e.aff;
      if (e.critMul) crit = Math.max(crit, e.critMul);
      if (e.elemAdd) for (var t in e.elemAdd) elemAdd[t] = (elemAdd[t] || 0) + cw * e.elemAdd[t];
      if (e.elemMul) for (var t2 in e.elemMul) elemMul[t2] = (elemMul[t2] || 1) * (1 + cw * (e.elemMul[t2] - 1));
      if (e.elemAddAll) elemAll += cw * e.elemAddAll;
      if (e.def) defAdd += cw * e.def;
      if (e.defMul) defMul *= 1 + cw * (e.defMul - 1);
      if (e.resAll) resAll += cw * e.resAll;
      if (e.res) for (var t3 in e.res) res[ELEMS.indexOf(t3)] += cw * e.res[t3];
      if (e.resMul) resMul *= e.resMul;
      if (e.health) health += cw * e.health;
      if (e.dmgCut) cut = Math.max(cut, cw * e.dmgCut);
    }
    // 会心の倍率：超会心 Lv1〜2 の差を Lv1 から引いた値を「超会心なし」とします（データからの推定）
    var critBase = g._critBase || 1.25;
    var critMul = crit || critBase;
    var affC = Math.max(-100, Math.min(100, aff));
    var critF = affC >= 0 ? 1 + affC / 100 * (critMul - 1) : 1 + affC / 100 * NEG_CRIT;
    var phys = (wi.raw + atk) * atkMul * critF;
    var phys0 = wi.raw * (wi.aff >= 0 ? 1 + Math.min(100, wi.aff) / 100 * (critBase - 1) : 1 + Math.max(-100, wi.aff) / 100 * NEG_CRIT);
    var elem = 0, elem0 = 0;
    if (wi.elems.length) {
      wi.elems.forEach(function (x) {
        var v = x[1] * (elemMul[x[0]] || 1) + (elemAdd[x[0]] || 0) + elemAll;
        elem += v / ELEM_DIV / wi.elems.length; elem0 += x[1] / ELEM_DIV / wi.elems.length;
      });
    }
    var fire = 100 * (phys + elem) / (phys0 + elem0);
    var defense = (baseDef + wi.defense) * defMul + defAdd;
    var rs = [];
    for (var i = 0; i < 5; i++) rs.push((baseRes[i] + resAll + res[i]) * resMul);
    var resSum = rs.reduce(function (a, b) { return a + b; }, 0);
    var def = (defense + W.resPt * resSum + W.healthPt * health + W.surv * survLv + W.cutPt * cut) / W.defDiv;
    var spareP = 0;
    for (var j = 0; j < spare.length; j++) spareP += W.spare[spare[j]];
    var comfort = spareP + W.comfortLv * comfortLv;
    var ow = OBJECTIVES[q.objective || 'fire'].w;
    return {
      total: ow[0] * fire + ow[1] * def + ow[2] * comfort,
      fire: fire, def: def, comfort: comfort,
      detail: { phys: phys, phys0: phys0, elem: elem, elem0: elem0, raw: wi.raw + atk, atkMul: atkMul, affinity: aff, critMul: critMul,
        defense: defense, res: rs, health: health, cut: cut, survLv: survLv, comfortLv: comfortLv, spareP: spareP },
      notCounted: notCounted
    };
  }

  /* ---------- 検索の準備 ---------- */
  function normalizeQuery(g, q0) {
    var q = {};
    for (var k in q0) q[k] = q0[k];
    q.skills = (q.skills || []).filter(function (x) { return x && x.lv > 0; });
    q.ranks = q.ranks && q.ranks.length ? q.ranks : ['MR'];
    q.excludeArmor = q.excludeArmor || [];
    q.excludeDecos = q.excludeDecos || [];
    q.excludeCharms = q.excludeCharms || [];
    q.fixedArmor = q.fixedArmor || {};
    q.minDefense = q.minDefense || 0;
    q.minRes = q.minRes || [null, null, null, null, null];
    q.objective = q.objective || 'fire';
    q.activeUptime = q.activeUptime == null ? 0.5 : q.activeUptime;
    q.weakUptime = q.weakUptime == null ? 1 : q.weakUptime;
    q.maxRarity = q.maxRarity || 12;        // 防具・護石の上限レア度
    q.decoMaxRarity = q.decoMaxRarity || 12; // 装飾品の上限レア度
    q.minRarity = q.minRarity || 1;         // 防具の下限レア度（マスターランク序盤の防具を外すときに使う）
    // untilDone のときは時間で止めず、最後まで探します（止めるのは画面の「止める」だけ）
    q.timeLimitMs = q.untilDone ? Infinity : (q.timeLimitMs || 60000);
    q.topK = q.topK || 120;
    q.resultCount = q.resultCount || 10;
    return q;
  }

  function slotsDominate(a, b) { // a のスロットに b の装飾品が全部入るか（大きい順に並べた配列）
    if (a.length < b.length) return false;
    for (var i = 0; i < b.length; i++) if (a[i] < b[i]) return false;
    return true;
  }

  function prepare(g, q0) {
    var I = indexGame(g);
    if (!g._critBase) {
      var cb = I.skillByEn['Critical Boost'];
      var c1 = cb.levels[0].eff.critMul, c2 = cb.levels[1].eff.critMul;
      g._critBase = Math.round((c1 - (c2 - c1)) * 1000) / 1000;
    }
    var q = normalizeQuery(g, q0);
    var wi = weaponInfo(g, q);
    var req = {}; // skillId -> 必要レベル
    q.skills.forEach(function (x) { req[x.id] = Math.max(req[x.id] || 0, x.lv); });
    // 上限を超えるレベルは、極意スキルか「Inheritance」（データの英語の説明：極意の上限をなくす）が要ります。
    // どちらでもよいので、条件にはせず、最後に確かめます（needUnlock）。
    var needUnlock = [];
    Object.keys(req).forEach(function (k) {
      var s = I.skillById[k];
      if (req[k] > s.max) {
        if (s.unlockedBy == null || req[k] > s.maxAll) throw new Error('「' + s.ja + '」は Lv' + Math.max(s.max, s.maxAll) + ' までです');
        needUnlock.push(+k);
      }
    });
    // シリーズスキルで付くスキル -> そのシリーズスキルと必要部位数
    var bonusGrants = {}; // skillId -> [[bonusId, req]]
    g.bonuses.forEach(function (b) { b.skills.forEach(function (x) { (bonusGrants[x[0]] = bonusGrants[x[0]] || []).push([b.id, x[1]]); }); });
    var ow = OBJECTIVES[q.objective].w;
    // 点数に関わるスキル
    var rel = {};
    Object.keys(req).forEach(function (k) { rel[k] = 1; });
    var welems = {}; wi.elems.forEach(function (x) { welems[x[0]] = 1; });
    function fireRel(s) {
      return s.levels.some(function (l) {
        var e = l.eff; if (!e || condWeight(e.cond, s, q, wi) === 0) return false;
        if (e.atk || e.atkMul || e.aff || e.critMul) return true;
        if (e.elemAddAll && wi.elems.length) return true;
        var k;
        for (k in (e.elemAdd || {})) if (welems[k]) return true;
        for (k in (e.elemMul || {})) if (welems[k]) return true;
        return false;
      });
    }
    g.skills.forEach(function (s) {
      if ((ow[0] && fireRel(s)) || (ow[1] && (I.defSkill[s.id] || I.survival[s.id])) || (ow[2] && I.comfort[s.id])) rel[s.id] = 1;
    });
    // 極意スキル：解放先が点数に関わるなら関わる。Inheritance も同じ
    var anySecret = false;
    g.skills.forEach(function (s) { if (s.unlocks != null && rel[s.unlocks]) { rel[s.id] = 1; anySecret = true; } });
    if (anySecret && I.inheritId != null) rel[I.inheritId] = 1;
    var relBonus = {};
    g.bonuses.forEach(function (b) { b.skills.forEach(function (x) { if (rel[x[0]]) relBonus[b.id] = 1; }); });
    var relList = Object.keys(rel).map(Number).sort(function (a, b) { return a - b; });
    var relPos = {}; relList.forEach(function (s, i) { relPos[s] = i; });
    var useDef = !!ow[1] || q.minDefense > 0 || q.minRes.some(function (x) { return x != null && x !== ''; });

    var ex = {}; q.excludeArmor.forEach(function (i) { ex[i] = 1; });
    function vecOf(skillsList) {
      var v = new Int16Array(relList.length);
      skillsList.forEach(function (x) { if (relPos[x[0]] != null) v[relPos[x[0]]] += x[1]; });
      return v;
    }
    function mkCand(a) {
      var st = a.set != null ? I.setById[a.set] : null;
      var b = st ? st.bonus : null;
      return { a: a, id: a.id, v: vecOf(a.skills), slots: a.slots, bonus: b != null && relBonus[b] ? b : null, rawBonus: b,
        def: a.def[1], res: a.res, rarity: a.rarity };
    }
    function dominates(x, y) {
      if (x.bonus !== y.bonus) return false;
      for (var i = 0; i < x.v.length; i++) if (x.v[i] < y.v[i]) return false;
      if (!slotsDominate(x.slots, y.slots)) return false;
      if (useDef) {
        if (x.def < y.def) return false;
        for (var j = 0; j < 5; j++) if (x.res[j] < y.res[j]) return false;
      }
      return true;
    }
    function equalCand(x, y) {
      if (x.bonus !== y.bonus || x.slots.join() !== y.slots.join()) return false;
      for (var i = 0; i < x.v.length; i++) if (x.v[i] !== y.v[i]) return false;
      if (useDef) { if (x.def !== y.def || x.res.join() !== y.res.join()) return false; }
      return true;
    }
    function prune(list) {
      // 同じ中身ならレア度の低い（入手しやすい）方・防御の高い方を残す
      list.sort(function (x, y) { return x.rarity - y.rarity || y.def - x.def || x.id - y.id; });
      var keep = [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i], dom = false;
        for (var j = 0; j < list.length && !dom; j++) {
          if (i === j) continue;
          var o = list[j];
          if (dominates(o, c) && (!equalCand(o, c) || j < i)) dom = true;
        }
        if (!dom) keep.push(c);
      }
      return keep;
    }
    var pools = {};
    var poolSizes = {};
    PARTS.forEach(function (p) {
      var list;
      if (q.fixedArmor[p] != null) list = [mkCand(I.armorById[q.fixedArmor[p]])];
      else list = g.armors.filter(function (a) {
        return a.part === p && a.rank && q.ranks.indexOf(a.rank) >= 0 && !ex[a.id] && a.rarity <= q.maxRarity && a.rarity >= q.minRarity;
      }).map(mkCand);
      poolSizes[p] = list.length;
      pools[p] = q.fixedArmor[p] != null ? list : prune(list);
    });
    // 護石：系列ごとに、条件の中で一番上の段階だけ
    var exC = {}; q.excludeCharms.forEach(function (i) { exC[i] = 1; });
    var charmOk = function (c) { return q.ranks.indexOf(rankOfRarity(c.rarity)) >= 0 && c.rarity <= q.maxRarity && !exC[c.id]; };
    var nextOf = {}; g.charms.forEach(function (c) { if (c.prev != null) nextOf[c.prev] = c.id; });
    var charmList = g.charms.filter(function (c) {
      if (!charmOk(c)) return false;
      var n = nextOf[c.id];
      while (n != null) { if (charmOk(I.charmById[n])) return false; n = nextOf[n]; }
      return true;
    }).map(function (c) { return { a: c, id: c.id, v: vecOf(c.skills), slots: [], bonus: null, def: 0, res: [0, 0, 0, 0, 0], rarity: c.rarity, charm: true }; });
    charmList.push({ a: null, id: null, v: new Int16Array(relList.length), slots: [], bonus: null, def: 0, res: [0, 0, 0, 0, 0], rarity: 0, charm: true });
    poolSizes.charm = charmList.length;
    var savedDef = useDef; useDef = false;
    pools.charm = prune(charmList);
    useDef = savedDef;

    // 装飾品
    var exD = {}; q.excludeDecos.forEach(function (i) { exD[i] = 1; });
    var decos = g.decos.filter(function (d) { return !exD[d.id] && d.rarity <= q.decoMaxRarity; });
    // スキルごと・スロットの大きさごとに、1 個で入る最大のポイント
    var bestPts = {}; // skillId -> [0, s1, s2, s3, s4]
    decos.forEach(function (d) {
      d.skills.forEach(function (x) {
        var arr = bestPts[x[0]] = bestPts[x[0]] || [0, 0, 0, 0, 0];
        for (var s = d.size; s <= 4; s++) arr[s] = Math.max(arr[s], x[1]);
      });
    });
    var P = { g: g, I: I, q: q, wi: wi, req: req, needUnlock: needUnlock, rel: rel, relList: relList, relPos: relPos, relBonus: relBonus, bonusGrants: bonusGrants,
      pools: pools, poolSizes: poolSizes, decos: decos, bestPts: bestPts, useDef: useDef };
    // 装飾品で置きかえられる防具も外す：B のスロットに装飾品を差して A のスキルを作っても、
    // A のスロット以上が残るなら、A を使う案は B を使う案より良くならない
    PARTS.forEach(function (p) { if (q.fixedArmor[p] == null) pools[p] = decoPrune(P, pools[p]); });
    return P;
  }

  function decoDominates(P, o, c) {
    if (o.bonus !== c.bonus) return false;
    if (P.useDef) {
      if (o.def < c.def) return false;
      for (var j = 0; j < 5; j++) if (o.res[j] < c.res[j]) return false;
    }
    var need = {}, any = false;
    for (var i = 0; i < c.v.length; i++) if (c.v[i] > o.v[i]) { need[P.relList[i]] = c.v[i] - o.v[i]; any = true; }
    if (!any) return slotsDominate(o.slots, c.slots);
    if (o.slots.length === 0) return false;
    var sol = solveDecos(P, need, o.slots);
    return !!sol && slotsDominate(sol.spare, c.slots);
  }
  function decoPrune(P, list) {
    var sorted = list.slice().sort(function (a, b) {
      var sa = 0, sb = 0; a.slots.forEach(function (x) { sa += x; }); b.slots.forEach(function (x) { sb += x; });
      return sb - sa || a.rarity - b.rarity || a.id - b.id;
    });
    var kept = [];
    sorted.forEach(function (c) {
      if (!kept.some(function (o) { return decoDominates(P, o, c); })) kept.push(c);
    });
    // 後から入った物が先の物を置きかえられる場合も外す
    return kept.filter(function (c) { return !kept.some(function (o) { return o !== c && decoDominates(P, o, c) && !decoDominates(P, c, o); }); });
  }

  /* ---------- 装飾品の割り当て ---------- */
  // 大きさの数え方：ge[t] = 大きさ t 以上のスロットの数
  function geOf(slots) { var ge = [0, 0, 0, 0, 0]; slots.forEach(function (s) { for (var t = 1; t <= s; t++) ge[t]++; }); return ge; }

  /* 必要な装飾品を、余るスロットができるだけ大きく残るように選びます（総当たり＋上限付き）。
   * need: {skillId: 足りないポイント}。返り値 null は入らないこと。 */
  function solveDecos(P, need, slots) {
    var ck = JSON.stringify(need) + '|' + slots.slice().sort().join('');
    var cache = P._solveCache || (P._solveCache = {});
    if (ck in cache) return cache[ck];
    var r = solveDecos0(P, need, slots);
    cache[ck] = r;
    return r;
  }
  function solveDecos0(P, need, slots) {
    var keys = Object.keys(need).filter(function (k) { return need[k] > 0; }).map(Number);
    if (!keys.length) return { decos: [], spare: slots.slice() };
    var ge = geOf(slots);
    // スキルごとの候補（同じ大きさなら多くポイントが付く物。複合は相手のスキルが必要なものか、代表 1 つ）
    var opts = {};
    keys.forEach(function (k) {
      var list = P.decos.filter(function (d) { return d.skills.some(function (x) { return x[0] === k; }); }).map(function (d) {
        var pk = 0, other = null, opk = 0;
        d.skills.forEach(function (x) { if (x[0] === k) pk = x[1]; else { other = x[0]; opk = x[1]; } });
        return { d: d, size: d.size, pk: pk, other: other, opk: opk, useful: other != null && need[other] > 0 };
      }).filter(function (o) { return o.size <= 4 && ge[o.size] > 0; });
      // 支配される候補を外す：大きさが大きく、ポイントが少なく、相手のスキルが役に立たない
      var kept = [];
      list.sort(function (a, b) { return a.size - b.size || b.pk - a.pk || (b.useful - a.useful) || a.d.rarity - b.d.rarity || a.d.id - b.d.id; });
      list.forEach(function (o) {
        var dom = kept.some(function (x) { return x.size <= o.size && x.pk >= o.pk && (!o.useful || (x.useful && x.other === o.other && x.opk >= o.opk)); });
        if (!dom) kept.push(o);
      });
      opts[k] = kept;
    });
    keys.sort(function (a, b) { return opts[a].length - opts[b].length; });
    var best = null, bestVal = -1, steps = 0;
    var useGe = [0, 0, 0, 0, 0];
    var chosen = [];
    var rem = {}; keys.forEach(function (k) { rem[k] = need[k]; });
    function spareOf() {
      var sizes = chosen.map(function (o) { return o.size; }).sort(function (a, b) { return b - a; });
      var free = slots.slice().sort(function (a, b) { return a - b; });
      var used = [];
      for (var i = 0; i < sizes.length; i++) {
        var j = 0; while (j < free.length && free[j] < sizes[i]) j++;
        if (j >= free.length) return null;
        used.push(free[j]); free.splice(j, 1);
      }
      return free.sort(function (a, b) { return b - a; });
    }
    function rec(ki, minOpt) {
      if (++steps > 200000) return;
      while (ki < keys.length && rem[keys[ki]] <= 0) { ki++; minOpt = 0; }
      if (ki >= keys.length) {
        var sp = spareOf(); if (!sp) return;
        var val = 0; sp.forEach(function (s) { val += W.spare[s]; });
        val -= chosen.length * 0.01; // 同じなら装飾品の数が少ない方
        if (val > bestVal) { bestVal = val; best = { decos: chosen.map(function (o) { return o.d; }), spare: sp }; }
        return;
      }
      var k = keys[ki], list = opts[k];
      for (var i = minOpt; i < list.length; i++) {
        var o = list[i];
        // ホールの条件：大きさ t 以上の装飾品の数 <= 大きさ t 以上のスロットの数
        var ok = true;
        for (var t = 1; t <= o.size; t++) if (useGe[t] + 1 > ge[t]) { ok = false; break; }
        if (!ok) continue;
        for (t = 1; t <= o.size; t++) useGe[t]++;
        chosen.push(o); rem[k] -= o.pk; if (o.other != null && rem[o.other] != null) rem[o.other] -= o.opk;
        rec(ki, i);
        chosen.pop(); rem[k] += o.pk; if (o.other != null && rem[o.other] != null) rem[o.other] += o.opk;
        for (t = 1; t <= o.size; t++) useGe[t]--;
        if (best && bestVal >= sumSpare(slots) - 0.01 * chosen.length - 1e-9) return;
      }
    }
    function sumSpare(sl) { var v = 0; sl.forEach(function (s) { v += W.spare[s]; }); return v; }
    rec(0, 0);
    return best;
  }

  /* 速い点数計算：点数に関わるスキルだけを配列で持ち、scoreParts と同じ式で計算します（試験で一致を確かめます） */
  function compileScorer(P) {
    if (P._fast) return P._fast;
    var R = P.relList.length, q = P.q, wi = P.wi, I = P.I;
    var sk = P.relList.map(function (id) { return I.skillById[id]; });
    var unlockIdx = sk.map(function (s) { return s.unlockedBy != null && P.relPos[s.unlockedBy] != null ? P.relPos[s.unlockedBy] : -1; });
    var hasSecret = sk.map(function (s) { return s.unlockedBy != null; });
    var inheritIdx = I.inheritId != null && P.relPos[I.inheritId] != null ? P.relPos[I.inheritId] : -1;
    var nE = wi.elems.length;
    // T[i][lv] = その段階で足す量
    var T = sk.map(function (s) {
      var arr = [null];
      for (var lv = 1; lv <= s.maxAll; lv++) {
        var L = s.levels[lv - 1], e = L && L.eff, o = { atk: 0, atkMul: 1, aff: 0, crit: 0, eAdd: [], eMul: [], def: 0, defMul: 1, resAll: 0, res: [0, 0, 0, 0, 0], resMul: 1, health: 0, cut: 0 };
        for (var j = 0; j < nE; j++) { o.eAdd.push(0); o.eMul.push(1); }
        if (e) {
          var cw = condWeight(e.cond, s, q, wi);
          if (cw > 0) {
            if (e.atk) o.atk = cw * e.atk;
            if (e.atkMul) o.atkMul = 1 + cw * (e.atkMul - 1);
            if (e.aff) o.aff = cw * e.aff;
            if (e.critMul) o.crit = e.critMul;
            for (var j2 = 0; j2 < nE; j2++) {
              var t = wi.elems[j2][0];
              if (e.elemAdd && e.elemAdd[t]) o.eAdd[j2] += cw * e.elemAdd[t];
              if (e.elemAddAll) o.eAdd[j2] += cw * e.elemAddAll;
              if (e.elemMul && e.elemMul[t]) o.eMul[j2] = 1 + cw * (e.elemMul[t] - 1);
            }
            if (e.def) o.def = cw * e.def;
            if (e.defMul) o.defMul = 1 + cw * (e.defMul - 1);
            if (e.resAll) o.resAll = cw * e.resAll;
            if (e.res) for (var t3 in e.res) o.res[ELEMS.indexOf(t3)] = cw * e.res[t3];
            if (e.resMul) o.resMul = e.resMul;
            if (e.health) o.health = cw * e.health;
            if (e.dmgCut) o.cut = cw * e.dmgCut;
          }
        }
        o.surv = I.survival[s.id] ? lv : 0;
        o.comf = I.comfort[s.id] ? lv : 0;
        arr.push(o);
      }
      return arr;
    });
    var ow = OBJECTIVES[q.objective].w;
    var critBase = P.g._critBase;
    var phys0 = wi.raw * (wi.aff >= 0 ? 1 + Math.min(100, wi.aff) / 100 * (critBase - 1) : 1 + Math.max(-100, wi.aff) / 100 * NEG_CRIT);
    var elem0 = 0; wi.elems.forEach(function (x) { elem0 += x[1] / ELEM_DIV / nE; });
    var lvBuf = new Int16Array(R);
    function levels(pts) {
      for (var i = 0; i < R; i++) {
        var s = sk[i], p = pts[i];
        var cap = ((unlockIdx[i] >= 0 && pts[unlockIdx[i]] > 0) || (hasSecret[i] && inheritIdx >= 0 && pts[inheritIdx] > 0)) ? s.maxAll : s.max;
        lvBuf[i] = p < cap ? p : cap;
      }
      return lvBuf;
    }
    function total(lv, spare, nSpare, baseDef, baseRes) {
      var atk = 0, atkMul = 1, aff = wi.aff, crit = 0, defAdd = 0, defMul = 1, resAll = 0, r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0, resMul = 1, health = 0, cut = 0, surv = 0, comf = 0;
      var e0a = 0, e0m = 1, e1a = 0, e1m = 1;
      for (var i = 0; i < R; i++) {
        var l = lv[i]; if (l <= 0) continue;
        var o = T[i][l];
        atk += o.atk; atkMul *= o.atkMul; aff += o.aff; if (o.crit > crit) crit = o.crit;
        if (nE > 0) { e0a += o.eAdd[0]; e0m *= o.eMul[0]; if (nE > 1) { e1a += o.eAdd[1]; e1m *= o.eMul[1]; } }
        defAdd += o.def; defMul *= o.defMul; resAll += o.resAll; r0 += o.res[0]; r1 += o.res[1]; r2 += o.res[2]; r3 += o.res[3]; r4 += o.res[4];
        resMul *= o.resMul; health += o.health; if (o.cut > cut) cut = o.cut; surv += o.surv; comf += o.comf;
      }
      var fire = 0, def = 0, comfort = 0;
      if (ow[0]) {
        var cm = crit || critBase;
        var a = aff > 100 ? 100 : (aff < -100 ? -100 : aff);
        var cf = a >= 0 ? 1 + a / 100 * (cm - 1) : 1 + a / 100 * NEG_CRIT;
        var phys = (wi.raw + atk) * atkMul * cf, elem = 0;
        if (nE > 0) { elem += (wi.elems[0][1] * e0m + e0a) / ELEM_DIV / nE; if (nE > 1) elem += (wi.elems[1][1] * e1m + e1a) / ELEM_DIV / nE; }
        fire = 100 * (phys + elem) / (phys0 + elem0);
      }
      if (ow[1]) {
        var defense = (baseDef + wi.defense) * defMul + defAdd;
        var rs = ((baseRes[0] + resAll + r0) + (baseRes[1] + resAll + r1) + (baseRes[2] + resAll + r2) + (baseRes[3] + resAll + r3) + (baseRes[4] + resAll + r4)) * resMul;
        def = (defense + W.resPt * rs + W.healthPt * health + W.surv * surv + W.cutPt * cut) / W.defDiv;
      }
      if (ow[2]) {
        var sp = 0; for (var j = 0; j < nSpare; j++) sp += W.spare[spare[j]];
        comfort = sp + W.comfortLv * comf;
      }
      return ow[0] * fire + ow[1] * def + ow[2] * comfort;
    }
    P._fast = { levels: levels, total: total, R: R };
    return P._fast;
  }

  // 余りスロットを埋める候補：点数に関わるスキルの装飾品のうち、ほかの物より小さくも強くもない物は外す
  function fillCandidates(P) {
    var list = P.decos.filter(function (d) { return d.skills.some(function (x) { return P.rel[x[0]] && !P.req[x[0]] || P.rel[x[0]]; }); });
    function relPts(d) { var m = {}; d.skills.forEach(function (x) { if (P.rel[x[0]]) m[x[0]] = x[1]; }); return m; }
    list.sort(function (a, b) { return a.size - b.size || a.rarity - b.rarity || a.id - b.id; });
    var kept = [];
    list.forEach(function (d) {
      var pd = relPts(d);
      var dom = kept.some(function (o) {
        if (o.size > d.size) return false;
        var po = relPts(o);
        for (var k in pd) if ((po[k] || 0) < pd[k]) return false;
        return true;
      });
      if (!dom) kept.push(d);
    });
    return kept;
  }

  /* ---------- 案を作り上げる（評価）：防具・護石が決まった後 ---------- */
  function gearPoints(P, armorCands, charmCand) {
    var pts = {}, bcount = {}, def = 0, res = [0, 0, 0, 0, 0], slots = [];
    var add = function (lst) { lst.forEach(function (x) { pts[x[0]] = (pts[x[0]] || 0) + x[1]; }); };
    armorCands.forEach(function (c) {
      var a = c.a; add(a.skills); def += a.def[1]; for (var i = 0; i < 5; i++) res[i] += a.res[i];
      a.slots.forEach(function (s, j) { slots.push({ ref: a.part + '#' + j, size: s }); });
      var st = a.set != null ? P.I.setById[a.set] : null;
      if (st && st.bonus != null) bcount[st.bonus] = (bcount[st.bonus] || 0) + 1;
    });
    if (charmCand && charmCand.a) add(charmCand.a.skills);
    add(P.wi.skills);
    if (P.wi.bonus != null) bcount[P.wi.bonus] = (bcount[P.wi.bonus] || 0) + 1;
    P.wi.slots.forEach(function (s, j) { slots.push({ ref: 'weapon#' + j, size: s }); });
    return { pts: pts, bcount: bcount, def: def, res: res, slots: slots };
  }

  function activeBonusSkills(P, bcount) {
    var out = {}; // skillId -> 1
    for (var b in bcount) {
      P.I.bonusById[b].skills.forEach(function (x) { if (bcount[b] >= x[1]) out[x[0]] = 1; });
    }
    return out;
  }

  function levelsOf(P, pts, bonusSk) {
    var total = {};
    for (var k in pts) total[k] = pts[k];
    for (var b in bonusSk) total[b] = (total[b] || 0) + 1;
    var lv = {};
    for (var s in total) {
      var sk = P.I.skillById[s];
      var unlocked = sk.unlockedBy != null && ((total[sk.unlockedBy] || 0) > 0 || (P.I.inheritId != null && (total[P.I.inheritId] || 0) > 0));
      lv[s] = Math.min(total[s], skillCap(sk, unlocked));
    }
    return { total: total, lv: lv };
  }

  // 防具・護石が決まったときの最良の案（必要な装飾品を入れ、余りを目的に合わせて埋める）
  function finishBuild(P, armorCands, charmCand, thr) {
    var G = gearPoints(P, armorCands, charmCand);
    var bonusSk = activeBonusSkills(P, G.bcount);
    var base = levelsOf(P, G.pts, bonusSk);
    // 必要ポイントの不足
    var need = {};
    for (var k in P.req) {
      var sk = P.I.skillById[k];
      var have = base.total[k] || 0;
      if (have >= P.req[k]) continue;
      if (P.bestPts[k] == null) return null; // 装飾品がなく足りない
      need[k] = P.req[k] - have;
    }
    // 極意が要るのに無いなら不可
    for (var k2 in P.req) {
      var s2 = P.I.skillById[k2];
      if (P.req[k2] > s2.max && !(base.total[s2.unlockedBy] > 0) && !(P.I.inheritId != null && base.total[P.I.inheritId] > 0)) return null;
    }
    if (P.q.minDefense || P.q.minRes.some(function (x) { return x != null && x !== ''; })) {
      // 下限は装飾品を入れる前の数で大まかに確かめ、最後にもう一度確かめます
    }
    var sizes = G.slots.map(function (s) { return s.size; });
    var sol = solveDecos(P, need, sizes);
    if (!sol) return null;
    var decoList = sol.decos.slice();
    var spare = sol.spare.slice();
    function evalWith(list, sp) {
      var pts = {}; for (var k in G.pts) pts[k] = G.pts[k];
      list.forEach(function (d) { d.skills.forEach(function (x) { pts[x[0]] = (pts[x[0]] || 0) + x[1]; }); });
      var L = levelsOf(P, pts, bonusSk);
      var sc = scoreParts(P.g, P.q, P.wi, L.lv, sp, G.def, G.res);
      return { L: L, sc: sc, pts: pts };
    }
    var F = compileScorer(P), R = F.R;
    var rp = new Int16Array(R);
    for (var kk in G.pts) if (P.relPos[kk] != null) rp[P.relPos[kk]] += G.pts[kk];
    for (var kb in bonusSk) if (P.relPos[kb] != null) rp[P.relPos[kb]] += 1;
    decoList.forEach(function (d) { d.skills.forEach(function (x) { if (P.relPos[x[0]] != null) rp[P.relPos[x[0]]] += x[1]; }); });
    var cand = P.fillDecos || (P.fillDecos = fillCandidates(P));
    var candV = P.fillVec || (P.fillVec = cand.map(function (d) { return d.skills.filter(function (x) { return P.relPos[x[0]] != null; }).map(function (x) { return [P.relPos[x[0]], x[1]]; }); }));
    // 大きいスロットから順に、点数が一番上がる装飾品を入れます（上がらなければ空けたまま）
    spare.sort(function (a, b) { return b - a; });
    var buf = new Int8Array(32);
    function fill(arr) { for (var z = 0; z < arr.length; z++) buf[z] = arr[z]; return arr.length; }
    var n0 = fill(spare);
    var curTotal = F.total(F.levels(rp), buf, n0, G.def, G.res);
    var keepSpare = [];
    while (spare.length) {
      var sz = spare.shift();
      var rest = keepSpare.concat(spare), nr = fill(rest);
      var bestGain = 1e-9, bestI = -1, bestT = 0;
      for (var di = 0; di < cand.length; di++) {
        if (cand[di].size > sz) continue;
        var vv = candV[di];
        for (var a1 = 0; a1 < vv.length; a1++) rp[vv[a1][0]] += vv[a1][1];
        var tt = F.total(F.levels(rp), buf, nr, G.def, G.res);
        for (a1 = 0; a1 < vv.length; a1++) rp[vv[a1][0]] -= vv[a1][1];
        if (tt - curTotal > bestGain + 1e-9) { bestGain = tt - curTotal; bestI = di; bestT = tt; }
      }
      if (bestI < 0) { keepSpare.push(sz); continue; }
      var bv = candV[bestI]; for (var a2 = 0; a2 < bv.length; a2++) rp[bv[a2][0]] += bv[a2][1];
      decoList.push(cand[bestI]); curTotal = bestT;
    }
    spare = keepSpare;
    if (thr != null && curTotal < thr - 1e-9) return { below: true };
    var cur = evalWith(decoList, spare);
    // 防御・耐性の下限
    if (P.q.minDefense && cur.sc.detail.defense < P.q.minDefense) return null;
    for (var ri = 0; ri < 5; ri++) {
      var m = P.q.minRes[ri];
      if (m != null && m !== '' && cur.sc.detail.res[ri] < +m) return null;
    }
    // 条件の最終確認
    for (var k3 in P.req) if ((cur.L.lv[k3] || 0) < P.req[k3]) return null;
    // 装飾品を具体的なスロットに置く（大きい装飾品から、入る一番小さいスロットへ）
    var freeSlots = G.slots.slice().sort(function (a, b) { return a.size - b.size; });
    var placed = [];
    decoList.slice().sort(function (a, b) { return b.size - a.size || a.id - b.id; }).forEach(function (d) {
      var j = 0; while (freeSlots[j].size < d.size) j++;
      placed.push({ slot: freeSlots[j].ref, slotSize: freeSlots[j].size, deco: d.id });
      freeSlots.splice(j, 1);
    });
    return {
      armor: armorCands.map(function (c) { return c.a.id; }),
      charm: charmCand && charmCand.a ? charmCand.a.id : null,
      weapon: P.q.weaponId != null ? P.q.weaponId : null,
      weaponSlots: P.wi.slots,
      decos: placed,
      spare: freeSlots.map(function (s) { return { slot: s.ref, size: s.size }; }),
      levels: cur.L.lv, points: cur.L.total,
      bonuses: Object.keys(G.bcount).map(function (b) { return { id: +b, count: G.bcount[b], active: P.I.bonusById[b].skills.filter(function (x) { return G.bcount[b] >= x[1]; }).map(function (x) { return x[0]; }) }; }),
      score: cur.sc, fastTotal: curTotal,
      objective: P.q.objective
    };
  }

  /* ---------- 検索（深さ優先の探索と枝刈り） ---------- */
  function* searchGen(g, q0) {
    var t0 = Date.now();
    var P = prepare(g, q0);
    var q = P.q;
    var order = PARTS.concat(['charm']).sort(function (a, b) { return P.pools[a].length - P.pools[b].length; });
    var D = order.length, R = P.relList.length;
    var pools = order.map(function (p) { return P.pools[p]; });
    // 候補の並び：目的に効きそうな順（早く良い案を見つけて枝刈りを強くするため）
    var reqPos = Object.keys(P.req).map(function (k) { return P.relPos[k]; });
    pools.forEach(function (list) {
      list.forEach(function (c) {
        var h = 0; for (var i = 0; i < R; i++) h += c.v[i] * (P.req[P.relList[i]] ? 3 : 1);
        c.slots.forEach(function (s) { h += s * 0.8; }); if (c.bonus != null) h += 2;
        c.h = h;
      });
      list.sort(function (a, b) { return b.h - a.h; });
    });
    // 残りの部位で取れる最大（スキル・スロット・シリーズ・防御）
    var sufV = [], sufGe = [], sufB = [], sufDef = [], sufRes = [];
    for (var d = D; d >= 0; d--) {
      var v = new Int16Array(R), ge = [0, 0, 0, 0, 0], b = {}, df = 0, rs = [0, 0, 0, 0, 0];
      if (d < D) {
        var nv = sufV[d + 1], nge = sufGe[d + 1], nb = sufB[d + 1];
        for (var i = 0; i < R; i++) { var m = 0; pools[d].forEach(function (c) { if (c.v[i] > m) m = c.v[i]; }); v[i] = nv[i] + m; }
        for (var t = 1; t <= 4; t++) { var mg = 0; pools[d].forEach(function (c) { var n = 0; c.slots.forEach(function (s) { if (s >= t) n++; }); if (n > mg) mg = n; }); ge[t] = nge[t] + mg; }
        for (var kb in nb) b[kb] = nb[kb];
        var seen = {}; pools[d].forEach(function (c) { if (c.bonus != null) seen[c.bonus] = 1; });
        for (var sb in seen) b[sb] = (b[sb] || 0) + 1;
        var md = 0; pools[d].forEach(function (c) { if (c.def > md) md = c.def; }); df = sufDef[d + 1] + md;
        for (var e = 0; e < 5; e++) { var mr = -999; pools[d].forEach(function (c) { if (c.res[e] > mr) mr = c.res[e]; }); rs[e] = sufRes[d + 1][e] + mr; }
      }
      sufV[d] = v; sufGe[d] = ge; sufB[d] = b; sufDef[d] = df; sufRes[d] = rs;
    }
    // 武器の分
    var wv = new Int16Array(R); P.wi.skills.forEach(function (x) { if (P.relPos[x[0]] != null) wv[P.relPos[x[0]]] += x[1]; });
    var wge = geOf(P.wi.slots);
    var bonusReq = {}; // シリーズスキルで付くスキルのうち、条件にあるもの
    Object.keys(P.req).forEach(function (k) { if (P.bonusGrants[k]) bonusReq[k] = P.bonusGrants[k]; });

    var heap = []; // 点数の高い順に topK
    var seenKey = {};
    var stats = { nodes: 0, leaves: 0, feasible: 0, pruned: 0, truncated: false, poolSizes: {}, poolSizesBefore: P.poolSizes, timeMs: 0 };
    order.forEach(function (p, i) { stats.poolSizes[p] = pools[i].length; });
    function threshold() { return heap.length >= q.topK ? heap[heap.length - 1].score.total : -Infinity; }
    var heapVer = 0;
    function insert(b) {
      heapVer++;
      var key = b.armor.join(',') + '|' + b.charm;
      if (seenKey[key]) return; seenKey[key] = 1;
      var i = heap.length; heap.push(b);
      while (i > 0 && heap[i - 1].score.total < b.score.total) { heap[i] = heap[i - 1]; i--; }
      heap[i] = b;
      if (heap.length > q.topK) { var x = heap.pop(); delete seenKey[x.armor.join(',') + '|' + x.charm]; }
    }
    var cur = new Int16Array(R); for (var wi2 = 0; wi2 < R; wi2++) cur[wi2] = wv[wi2];
    var curGe = wge.slice(), curB = {}, curDef = 0, curRes = [0, 0, 0, 0, 0];
    if (P.wi.bonus != null) curB[P.wi.bonus] = 1;
    var chosen = new Array(D);
    var reqKeys = Object.keys(P.req).map(Number);
    var relSk = P.relList.map(function (s) { return P.I.skillById[s]; });

    function decoCap(si, ge) { // スキル si を装飾品だけで最大何ポイント
      var bp = P.bestPts[P.relList[si]]; if (!bp) return 0;
      var c = 0; for (var t = 1; t <= 4; t++) c += (ge[t] - (ge[t + 1] || 0)) * bp[t];
      return c;
    }
    function feasibleBound(d) {
      var ge = [0, 0, 0, 0, 0, 0];
      for (var t = 1; t <= 4; t++) ge[t] = curGe[t] + sufGe[d][t];
      var totalDef = 0;
      for (var r = 0; r < reqKeys.length; r++) {
        var k = reqKeys[r], pi = P.relPos[k];
        var have = cur[pi] + sufV[d][pi];
        if (bonusReq[k]) bonusReq[k].forEach(function (x) { if ((curB[x[0]] || 0) + (sufB[d][x[0]] || 0) >= x[1]) have += 1; });
        var def = P.req[k] - have;
        if (def > 0) {
          if (decoCap(pi, ge) < def) return false;
          totalDef += def;
        }
      }
      if (totalDef > 0) {
        // 1 スロットに入る最大ポイントで、全体の数が足りるか
        var cap = 0;
        for (var t2 = 1; t2 <= 4; t2++) {
          var mx = 0;
          for (var r2 = 0; r2 < reqKeys.length; r2++) { var bp = P.bestPts[reqKeys[r2]]; if (bp && bp[t2] > mx) mx = bp[t2]; }
          cap += (ge[t2] - (ge[t2 + 1] || 0)) * mx;
        }
        if (cap < totalDef) return false;
      }
      if (q.minDefense && P.useDef && false) return false;
      return true;
    }
    // 点数の上限（楽観的な見積もり。点数はスキル・スロット・防御について単調なので、これを超える案はない）
    var FS = compileScorer(P);
    var lvB = new Int16Array(R), spB = new Int8Array(64), resB = [0, 0, 0, 0, 0];
    function scoreBound(d) {
      var ge = [0, 0, 0, 0, 0, 0];
      for (var t = 1; t <= 4; t++) ge[t] = curGe[t] + sufGe[d][t];
      for (var i = 0; i < R; i++) {
        var p = cur[i] + sufV[d][i] + decoCap(i, ge);
        var bg = P.bonusGrants[P.relList[i]];
        if (bg) for (var j = 0; j < bg.length; j++) if ((curB[bg[j][0]] || 0) + (sufB[d][bg[j][0]] || 0) >= bg[j][1]) p += 1;
        var mx = relSk[i].maxAll;
        lvB[i] = p < mx ? p : mx;
      }
      var n = 0;
      for (var t3 = 4; t3 >= 1; t3--) for (var k = 0; k < ge[t3] - (ge[t3 + 1] || 0); k++) spB[n++] = t3;
      for (var e = 0; e < 5; e++) resB[e] = curRes[e] + sufRes[d][e];
      return FS.total(lvB, spB, n, curDef + sufDef[d], resB);
    }
    var lastYield = Date.now();
    function apply(c, sign) {
      for (var i = 0; i < R; i++) cur[i] += sign * c.v[i];
      var ge = geOf(c.slots); for (var t = 1; t <= 4; t++) curGe[t] += sign * ge[t];
      if (c.rawBonus != null && c.bonus != null) curB[c.bonus] = (curB[c.bonus] || 0) + sign;
      curDef += sign * c.def; for (var e = 0; e < 5; e++) curRes[e] += sign * c.res[e];
    }
    // 少しずつ広げる探索：各部位の上位 w 個だけで探し、次に w を広げます（前に見た組み合わせは飛ばします）。
    // 最後の段は全部の候補なので、時間内に終われば総当たりと同じ結果になります。
    var maxLen = 0; pools.forEach(function (l) { if (l.length > maxLen) maxLen = l.length; });
    var widths = [2, 3, 4, 6, 9, 14, 20, 30, 45, 70, 100, 150, 250, 400].filter(function (w) { return w < maxLen; }).concat([maxLen]);
    var idx = new Array(D);
    var stopped = false;
    var snapVer = 0, lastSnap = 0;
    stats.passes = 0;
    for (var pass = 0; pass < widths.length && !stopped; pass++) {
      var w = widths[pass], prevW = pass ? widths[pass - 1] : 0;
      var stack = [{ d: 0, i: 0 }];
      while (stack.length) {
        var top = stack[stack.length - 1];
        if (top.i >= Math.min(w, pools[top.d].length)) {
          stack.pop();
          if (stack.length) { var parent = stack[stack.length - 1]; apply(chosen[parent.d], -1); }
          continue;
        }
        idx[top.d] = top.i;
        var c = pools[top.d][top.i++];
        stats.nodes++;
        if ((stats.nodes & 63) === 0) {
          var now = Date.now();
          var userStop = q.stopSignal && q.stopSignal();
          if (now - t0 > q.timeLimitMs || userStop) { stats.truncated = true; stats.stoppedByUser = !!userStop; stopped = true; break; }
          if (now - lastYield > 100) {
            lastYield = now;
            var pr = { progress: true, nodes: stats.nodes, leaves: stats.leaves, feasible: stats.feasible, found: heap.length, ms: now - t0, pass: pass + 1, passes: widths.length };
            // 途中の結果：上位が変わっていて、前の途中の結果から 1 秒以上たったら付けます
            if (q.live && heapVer !== snapVer && now - lastSnap >= 1000) {
              snapVer = heapVer; lastSnap = now;
              pr.snapshot = diversify(heap, q.resultCount).map(function (x, i) { return Object.assign({}, x, { rank: i + 1, id: 'b' + (i + 1) }); });
            }
            yield pr;
          }
        }
        chosen[top.d] = c; apply(c, 1);
        var d1 = top.d + 1;
        if (d1 === D) {
          var fresh = false; for (var z = 0; z < D; z++) if (idx[z] >= prevW) { fresh = true; break; }
          if (!fresh) { apply(c, -1); continue; }
        }
        if (!feasibleBound(d1) || scoreBound(d1) < threshold() - 1e-9) { apply(c, -1); stats.pruned++; continue; }
        if (d1 === D) {
          stats.leaves++;
          var armorC = PARTS.map(function (p) { return chosen[order.indexOf(p)]; });
          var charmC = chosen[order.indexOf('charm')];
          var b = finishBuild(P, armorC, charmC, threshold());
          if (b) { stats.feasible++; if (!b.below) insert(b); }
          apply(c, -1);
          continue;
        }
        stack.push({ d: d1, i: 0 });
      }
      if (stopped) {
        // 途中で止めたときは、積んだ分を元に戻す必要はありません（この後は使わないため）
      } else stats.passes = pass + 1;
    }
    stats.passTotal = widths.length;
    stats.timeMs = Date.now() - t0;
    var picked = diversify(heap, q.resultCount);
    picked = picked.map(function (b, i) { return Object.assign({}, b, { rank: i + 1, id: 'b' + (i + 1) }); });
    return { builds: picked, all: heap, stats: stats, query: q, relCount: R };
  }

  // 似た案ばかりにならないように：防具が 2 部位以上違う案を先に並べる
  function diversify(list, n) {
    var out = [], rest = [];
    list.forEach(function (b) {
      var ok = out.length < n && out.every(function (o) { var diff = 0; for (var i = 0; i < 5; i++) if (o.armor[i] !== b.armor[i]) diff++; return diff >= 2; });
      if (ok) out.push(b); else rest.push(b);
    });
    for (var i = 0; out.length < n && i < rest.length; i++) out.push(rest[i]);
    out.sort(function (a, b) { return b.score.total - a.score.total; });
    return out;
  }

  function search(g, q) {
    var it = searchGen(g, q), r;
    do { r = it.next(); } while (!r.done);
    return r.value;
  }

  /* 決まった案（URL や あらかじめ作った案）を、ページのデータで計算し直します */
  function evaluateBuild(g, spec, q0) {
    var q = normalizeQuery(g, q0 || {});
    var P = prepare(g, Object.assign({}, q, { skills: [], weaponId: spec.weapon, weaponSlots: spec.weaponSlots }));
    var I = P.I;
    var armorC = spec.armor.map(function (id) { return { a: I.armorById[id] }; });
    if (armorC.some(function (c) { return !c.a; })) return null;
    var charm = spec.charm != null ? { a: I.charmById[spec.charm] } : null;
    var G = gearPoints(P, armorC, charm);
    var slotSize = {}; G.slots.forEach(function (s) { slotSize[s.ref] = s.size; });
    var pts = {}; for (var k in G.pts) pts[k] = G.pts[k];
    var used = {};
    for (var i = 0; i < spec.decos.length; i++) {
      var x = spec.decos[i], d = I.decoById[x.deco];
      if (!d || slotSize[x.slot] == null || slotSize[x.slot] < d.size || used[x.slot]) return null;
      used[x.slot] = 1;
      d.skills.forEach(function (y) { pts[y[0]] = (pts[y[0]] || 0) + y[1]; });
    }
    var bonusSk = activeBonusSkills(P, G.bcount);
    var L = levelsOf(P, pts, bonusSk);
    var spare = G.slots.filter(function (s) { return !used[s.ref]; });
    var sc = scoreParts(g, q, P.wi, L.lv, spare.map(function (s) { return s.size; }), G.def, G.res);
    return {
      armor: spec.armor.slice(), charm: spec.charm, weapon: spec.weapon, weaponSlots: P.wi.slots,
      decos: spec.decos.map(function (x) { return { slot: x.slot, slotSize: slotSize[x.slot], deco: x.deco }; }),
      spare: spare.map(function (s) { return { slot: s.ref, size: s.size }; }),
      levels: L.lv, points: L.total,
      bonuses: Object.keys(G.bcount).map(function (b) { return { id: +b, count: G.bcount[b], active: I.bonusById[b].skills.filter(function (y) { return G.bcount[b] >= y[1]; }).map(function (y) { return y[0]; }) }; }),
      score: sc, objective: q.objective
    };
  }

  var API = {
    PARTS: PARTS, PART_JA: PART_JA, ELEMS: ELEMS, ELEM_JA: ELEM_JA, RANK_JA: RANK_JA, WEAPON_TYPES: WEAPON_TYPES, WEAPON_JA: WEAPON_JA,
    WEAPON_BLOAT: WEAPON_BLOAT, UPTIME: UPTIME, GUARD_WEAPONS: GUARD_WEAPONS, NEG_CRIT: NEG_CRIT, ELEM_DIV: ELEM_DIV, W: W, OBJECTIVES: OBJECTIVES, SURVIVAL: SURVIVAL, COMFORT: COMFORT, RANGED: RANGED,
    indexGame: indexGame, prepare: prepare, search: search, searchGen: searchGen, finishBuild: finishBuild, evaluateBuild: evaluateBuild,
    scoreParts: scoreParts, compileScorer: compileScorer, weaponInfo: weaponInfo, normalizeQuery: normalizeQuery, solveDecos: solveDecos, diversify: diversify, rankOfRarity: rankOfRarity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MHEngine = API;
})(typeof self !== 'undefined' ? self : this);
