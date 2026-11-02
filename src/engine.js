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

  /* 防具のカスタム強化：自分で入れた「強化のあとのスロット・足したスキル」を反映した防具を返します。
   * データにない強化なので、値は入力のまま使います。防御力は armorAugMax のとき defense_augment_max（データ）を使います。 */
  function armorOf(g, q, id) {
    var I = indexGame(g);
    var a = I.armorById[id];
    if (!a) return null;
    var ov = q && q.armorOverrides && q.armorOverrides[id];
    if (!ov) return a;
    var c = Object.assign({}, a);
    if (ov.slots) c.slots = ov.slots.filter(function (x) { return x > 0; }).map(Number).sort(function (x, y) { return y - x; });
    if (ov.addSkills && ov.addSkills.length) {
      var m = {}; a.skills.forEach(function (x) { m[x[0]] = (m[x[0]] || 0) + x[1]; });
      ov.addSkills.forEach(function (x) { if (x && x[1] > 0) m[x[0]] = (m[x[0]] || 0) + +x[1]; });
      c.skills = Object.keys(m).map(function (k) { return [+k, m[k]]; });
    }
    c.augmented = true;
    return c;
  }
  function defOf(q, a) { return a.def[q && q.armorAugMax ? 2 : 1]; }

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
    'Divine Blessing': 0.3,    // 一定の確率
    'Element Acceleration': 0.6,      // 続けて攻撃を当てたあと一定時間（v1.1）
    'True Element Acceleration': 0.6  // 同じ
  };
  var GUARD_WEAPONS = { lance: 1, gunlance: 1, 'charge-blade': 1, 'sword-and-shield': 1, 'great-sword': 1 };
  function condWeight(cond, s, q, wi) {
    if (!cond) return 1;
    if (cond === 'draw' || cond === 'faint') return 0;
    var u = UPTIME[s.en] != null ? UPTIME[s.en] : 0.5;
    if (s.en === 'Offensive Guard' && !(wi.type && GUARD_WEAPONS[wi.type])) u = 0;
    return Math.min(1, u * (q.uptimeScale == null ? 1 : q.uptimeScale));
  }

  /* ---- 調べて分かった数（出典は README と画面の「点数の付け方」にあります。2026-11-02 に検索で調べました） ---- */
  // 会心撃【属性】・真・会心撃【属性】：会心が出たときの属性ダメージの倍率（武器の種類ごと）
  var CRIT_ELEM = { 'great-sword': 1.5, hammer: 1.5, 'hunting-horn': 1.5, 'heavy-bowgun': 1.5, 'light-bowgun': 1.25, other: 1.35 };
  var TRUE_CRIT_ELEM = { 'great-sword': 1.7, hammer: 1.7, 'hunting-horn': 1.7, 'heavy-bowgun': 1.7, 'light-bowgun': 1.4, other: 1.55 };
  function critElemMul(type, level) {
    var t = level === 2 ? TRUE_CRIT_ELEM : CRIT_ELEM;
    return t[type] != null ? t[type] : t.other;
  }

  /* ---- 武器の種類ごとの「攻撃の内わけ」（判断。画面で変えられます） ----
   * art：爆発を伴う攻撃（砲撃・竜撃砲・盾斧のビン攻撃・徹甲榴弾など。データの「砲術」の説明より）の割合。砲術だけが効くとして計算します。
   * special：ボウガンの特殊弾、弓の竜の一矢・千々矢（データの「特殊射撃強化」の説明より）の割合。
   * jump：ジャンプ攻撃（飛燕が効く）の割合。 */
  var PARTS_DEFAULT = {
    gunlance: { art: 0.3, special: 0, jump: 0 },
    'charge-blade': { art: 0.2, special: 0, jump: 0 },
    'light-bowgun': { art: 0.05, special: 0.1, jump: 0 },
    'heavy-bowgun': { art: 0.05, special: 0.1, jump: 0 },
    bow: { art: 0, special: 0.1, jump: 0 },
    'insect-glaive': { art: 0, special: 0, jump: 0.5 }
  };
  function weaponParts(q, type) {
    var d = PARTS_DEFAULT[type] || { art: 0, special: 0, jump: 0 };
    var o = q.parts || {};
    var cl = function (x) { x = +x; return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; };
    var r = { art: cl(o.art != null ? o.art : d.art), special: cl(o.special != null ? o.special : d.special), jump: cl(o.jump != null ? o.jump : d.jump) };
    // 爆発と特殊弾の合計が 100% を超えるときは、合計が 100% になるように縮めます（ふつうの攻撃の割合が負にならないように）
    var sum = r.art + r.special;
    if (sum > 1) { r.art /= sum; r.special /= sum; }
    return r;
  }

  function weaponInfo(g, q) {
    var I = indexGame(g);
    var w = q.weaponId != null ? I.weaponById[q.weaponId] : null;
    var info;
    if (w) {
      var el = w.elements.filter(function (e) { return ELEMS.indexOf(e[0]) >= 0; });
      // 属性と状態異常を 1 つずつ持つ武器（例：氷と爆破）は、属性が攻撃の半分に乗るとして、属性の数（状態異常も含む）で割ります
      info = { w: w, raw: w.attack / WEAPON_BLOAT[w.type], aff: w.affinity, elems: w.elemHidden ? [] : el, hidden: w.elemHidden ? el : [],
        elemDiv: Math.max(1, w.elements.length), defense: w.defense, slots: w.slots.slice(), skills: w.skills, bonus: w.bonus, type: w.type };
    } else {
      // 武器を選ばないときの「基準の武器」（判断）：基礎攻撃力 200、会心率 0%、属性なし
      info = { w: null, raw: 200, aff: 0, elems: [], hidden: [], elemDiv: 1, defense: 0, slots: (q.weaponSlots || []).slice().sort(function (a, b) { return b - a; }), skills: [], bonus: null, type: q.weaponType || null };
    }
    // カスタム強化・覚醒のあとの数値を自分で入れたとき（データにない強化なので、入れた値をそのまま使います）
    var ov = q.weaponOverride;
    if (ov && info.type) {
      if (ov.attack) info.raw = +ov.attack / WEAPON_BLOAT[info.type];
      if (ov.affinity != null && ov.affinity !== '') info.aff = +ov.affinity;
      // 入れた属性：もとが隠し属性の武器なら、隠し属性として扱います（属性解放が要るのは変わらないため）
      if (ov.element && ov.element[0] && !(ov.element[1] > 0)) { info.elems = []; info.hidden = []; info.elemDiv = 1; } // 0 を入れたら属性なし
      else if (ov.element && ov.element[0] && ov.element[1] > 0) {
        if (w && w.elemHidden) { info.hidden = [[ov.element[0], +ov.element[1]]]; info.elems = []; }
        else { info.elems = [[ov.element[0], +ov.element[1]]]; info.hidden = []; }
        info.elemDiv = 1;
      }
      if (ov.slots) info.slots = ov.slots.filter(function (x) { return x > 0; }).map(Number).sort(function (a, b) { return b - a; });
      if (ov.defense != null && ov.defense !== '') info.defense = +ov.defense;
      info.overridden = true;
    }
    info.parts = weaponParts(q, info.type);
    return info;
  }

  /* ---- 点数の計算（速い計算と通常の計算で同じ式を使います） ----
   * effContrib：スキル 1 つ・レベル 1 つの効果を、足し合わせやすい形にします。 */
  var FREE_FRAC = null;
  function freeFrac(g, lv) {
    if (!FREE_FRAC) {
      var I = indexGame(g), s = I.skillByEn['Free Elem/Ammo Up'];
      FREE_FRAC = [0].concat(s.levels.map(function (l) { return (l.eff && l.eff.hiddenFrac) || 0; }));
    }
    return FREE_FRAC[Math.min(lv, FREE_FRAC.length - 1)] || 0;
  }
  function effContrib(g, s, lv, q, wi) {
    var I = indexGame(g);
    var L = s.levels[Math.min(lv, s.levels.length) - 1], e = L && L.eff;
    var nE = wi.elems.length, nH = wi.hidden.length;
    var o = { atk: 0, atkMul: 1, aff: 0, crit: 0, critElem: 0, eAdd: [0, 0], eMul: [1, 1], hAdd: [0, 0], hMul: [1, 1], hidden: 0, accelFrac: 0, accelW: 0,
      art: 1, special: 1, jump: 1, def: 0, defMul: 1, resAll: 0, res: [0, 0, 0, 0, 0], resMul: 1, health: 0, cut: 0,
      surv: I.survival[s.id] ? lv : 0, comf: I.comfort[s.id] ? lv : 0, fireCounted: false };
    if (s.en === 'Critical Element') o.critElem = 1;
    if (s.en === 'True Critical Element') o.critElem = 2;
    if (o.critElem && (nE || nH)) o.fireCounted = true;
    if (!e) return o;
    var cw = condWeight(e.cond, s, q, wi);
    if (cw > 0) {
      if (e.atk) o.atk = cw * e.atk;
      if (e.atkMul) o.atkMul = 1 + cw * (e.atkMul - 1);
      if (e.aff) o.aff = cw * e.aff;
      for (var j = 0; j < 2; j++) {
        var t = j < nE ? wi.elems[j][0] : null, th = j < nH ? wi.hidden[j][0] : null;
        if (t) {
          if (e.elemAdd && e.elemAdd[t]) o.eAdd[j] += cw * e.elemAdd[t];
          if (e.elemAddAll) o.eAdd[j] += cw * e.elemAddAll;
          if (e.elemMul && e.elemMul[t]) o.eMul[j] = 1 + cw * (e.elemMul[t] - 1);
        }
        if (th) {
          if (e.elemAdd && e.elemAdd[th]) o.hAdd[j] += cw * e.elemAdd[th];
          if (e.elemAddAll) o.hAdd[j] += cw * e.elemAddAll;
          if (e.elemMul && e.elemMul[th]) o.hMul[j] = 1 + cw * (e.elemMul[th] - 1);
        }
      }
      if (e.accelFreeLv) { o.accelFrac = freeFrac(g, e.accelFreeLv); o.accelW = cw; }
      if (e.def) o.def = cw * e.def;
      if (e.defMul) o.defMul = 1 + cw * (e.defMul - 1);
      if (e.resAll) o.resAll = cw * e.resAll;
      if (e.res) for (var t3 in e.res) o.res[ELEMS.indexOf(t3)] = cw * e.res[t3];
      if (e.health) o.health = cw * e.health;
      if (e.dmgCut) o.cut = cw * e.dmgCut;
    }
    if (e.critMul) o.crit = e.critMul;
    if (e.hiddenFrac) o.hidden = e.hiddenFrac;
    if (e.resMul) o.resMul = e.resMul;
    if (e.artMul) o.art = e.artMul;
    if (e.specialMul) o.special = e.specialMul;
    if (e.jumpMul) o.jump = e.jumpMul;
    var P = wi.parts;
    o.fireCounted = o.fireCounted || !!(o.atk || o.atkMul !== 1 || o.aff || o.crit ||
      (nE && (o.eAdd[0] || o.eAdd[1] || o.eMul[0] !== 1 || o.eMul[1] !== 1)) ||
      (nH && (o.hidden || o.accelFrac || o.hAdd[0] || o.hAdd[1] || o.hMul[0] !== 1 || o.hMul[1] !== 1)) ||
      (o.art !== 1 && P.art > 0) || (o.special !== 1 && P.special > 0) || (o.jump !== 1 && P.jump > 0));
    return o;
  }
  function newAgg(wi) {
    return { atk: 0, atkMul: 1, aff: wi.aff, crit: 0, critElem: 0, eAdd: [0, 0], eMul: [1, 1], hAdd: [0, 0], hMul: [1, 1], hidden: 0, accelFrac: 0, accelW: 0,
      art: 1, special: 1, jump: 1, def: 0, defMul: 1, resAll: 0, res: [0, 0, 0, 0, 0], resMul: 1, health: 0, cut: 0, surv: 0, comf: 0 };
  }
  function resetAgg(a, wi) {
    a.atk = 0; a.atkMul = 1; a.aff = wi.aff; a.crit = 0; a.critElem = 0;
    a.eAdd[0] = 0; a.eAdd[1] = 0; a.eMul[0] = 1; a.eMul[1] = 1; a.hAdd[0] = 0; a.hAdd[1] = 0; a.hMul[0] = 1; a.hMul[1] = 1;
    a.hidden = 0; a.accelFrac = 0; a.accelW = 0; a.art = 1; a.special = 1; a.jump = 1;
    a.def = 0; a.defMul = 1; a.resAll = 0; a.res[0] = 0; a.res[1] = 0; a.res[2] = 0; a.res[3] = 0; a.res[4] = 0;
    a.resMul = 1; a.health = 0; a.cut = 0; a.surv = 0; a.comf = 0;
  }
  function addContrib(a, o) {
    a.atk += o.atk; a.atkMul *= o.atkMul; a.aff += o.aff; if (o.crit > a.crit) a.crit = o.crit; if (o.critElem > a.critElem) a.critElem = o.critElem;
    a.eAdd[0] += o.eAdd[0]; a.eAdd[1] += o.eAdd[1]; a.eMul[0] *= o.eMul[0]; a.eMul[1] *= o.eMul[1];
    a.hAdd[0] += o.hAdd[0]; a.hAdd[1] += o.hAdd[1]; a.hMul[0] *= o.hMul[0]; a.hMul[1] *= o.hMul[1];
    if (o.hidden > a.hidden) a.hidden = o.hidden;
    if (o.accelFrac > a.accelFrac) { a.accelFrac = o.accelFrac; a.accelW = o.accelW; }
    if (o.art > a.art) a.art = o.art; if (o.special > a.special) a.special = o.special; if (o.jump > a.jump) a.jump = o.jump;
    a.def += o.def; a.defMul *= o.defMul; a.resAll += o.resAll;
    for (var i = 0; i < 5; i++) a.res[i] += o.res[i];
    a.resMul *= o.resMul; a.health += o.health; if (o.cut > a.cut) a.cut = o.cut; a.surv += o.surv; a.comf += o.comf;
  }
  // 足し合わせた効果から、火力点・守り点・快適点を出します
  function evalAgg(g, q, wi, a, spare, nSpare, baseDef, baseRes, wantDetail) {
    var critBase = g._critBase || 1.25;
    var critMul = a.crit || critBase;
    var affC = a.aff > 100 ? 100 : (a.aff < -100 ? -100 : a.aff);
    var critF = affC >= 0 ? 1 + affC / 100 * (critMul - 1) : 1 + affC / 100 * NEG_CRIT;
    var phys = (wi.raw + a.atk) * a.atkMul * critF;
    var aff0 = wi.aff > 100 ? 100 : (wi.aff < -100 ? -100 : wi.aff);
    var phys0 = wi.raw * (aff0 >= 0 ? 1 + aff0 / 100 * (critBase - 1) : 1 + aff0 / 100 * NEG_CRIT);
    // 属性：会心撃【属性】があれば、会心が出たときに武器の種類ごとの倍率がかかります（マイナス会心では属性は変わらないとして計算）
    var ceF = (a.critElem && affC > 0) ? 1 + affC / 100 * (critElemMul(wi.type, a.critElem) - 1) : 1;
    var ew = q.elemWeight == null ? 1 : +q.elemWeight;
    var elem = 0, elem0 = 0, elemShown = [];
    var nE = wi.elems.length, nH = wi.hidden.length;
    for (var j = 0; j < nE; j++) {
      var v = wi.elems[j][1] * a.eMul[j] + a.eAdd[j];
      elemShown.push([wi.elems[j][0], v]);
      elem += v / ELEM_DIV / wi.elemDiv * ceF * ew; elem0 += wi.elems[j][1] / ELEM_DIV / wi.elemDiv * ew;
    }
    // 隠し属性：属性解放（データ：Lv1 で 1/3、Lv2 で 2/3、Lv3 で全部）と属性加速（データ：属性解放 Lv2・Lv3 として働く）
    var hf = a.hidden;
    if (a.accelFrac > hf) hf = hf + a.accelW * (a.accelFrac - hf);
    for (var k = 0; k < nH; k++) {
      if (hf <= 0) { elemShown.push([wi.hidden[k][0], 0]); continue; }
      var hv = wi.hidden[k][1] * hf * a.hMul[k] + a.hAdd[k];
      elemShown.push([wi.hidden[k][0], hv]);
      elem += hv / ELEM_DIV / wi.elemDiv * ceF * ew;
    }
    var hit = phys + elem, hit0 = phys0 + elem0;
    var P = wi.parts;
    var normal = 1 - P.art - P.special;
    var ratio = hit / hit0;
    var fire = 100 * (normal * ratio * (1 + P.jump * (a.jump - 1)) + P.art * a.art + P.special * a.special * ratio);
    var defense = (baseDef + wi.defense) * a.defMul + a.def;
    var r0 = (baseRes[0] + a.resAll + a.res[0]) * a.resMul, r1 = (baseRes[1] + a.resAll + a.res[1]) * a.resMul, r2 = (baseRes[2] + a.resAll + a.res[2]) * a.resMul,
      r3 = (baseRes[3] + a.resAll + a.res[3]) * a.resMul, r4 = (baseRes[4] + a.resAll + a.res[4]) * a.resMul;
    var def = (defense + W.resPt * (r0 + r1 + r2 + r3 + r4) + W.healthPt * a.health + W.surv * a.surv + W.cutPt * a.cut) / W.defDiv;
    var spareP = 0;
    for (var i = 0; i < nSpare; i++) spareP += W.spare[spare[i]];
    var comfort = spareP + W.comfortLv * a.comf;
    var ow = OBJECTIVES[q.objective || 'fire'].w;
    var total = ow[0] * fire + ow[1] * def + ow[2] * comfort;
    if (!wantDetail) return total;
    return {
      total: total, fire: fire, def: def, comfort: comfort,
      detail: { phys: phys, phys0: phys0, elem: elem, elem0: elem0, elemShown: elemShown, critElem: a.critElem ? critElemMul(wi.type, a.critElem) : 0, hiddenFrac: hf,
        raw: wi.raw + a.atk, atkMul: a.atkMul, affinity: a.aff, critMul: critMul, art: a.art, special: a.special, jump: a.jump, parts: P, elemWeight: ew,
        defense: defense, defBase: baseDef + wi.defense, res: [r0, r1, r2, r3, r4], health: a.health, cut: a.cut, survLv: a.surv, comfortLv: a.comf, spareP: spareP }
    };
  }

  /* levels: {skillId: level}（上限で切った後）, spare: 余りスロットの大きさの配列 */
  function scoreParts(g, q, wi, levels, spare, baseDef, baseRes) {
    var I = indexGame(g);
    var a = newAgg(wi), notCounted = [];
    for (var k in levels) {
      var lv = levels[k]; if (!lv) continue;
      var s = I.skillById[k];
      var o = effContrib(g, s, lv, q, wi);
      addContrib(a, o);
      var defCounted = o.def || o.defMul !== 1 || o.resAll || o.res.some(function (x) { return x; }) || o.resMul !== 1 || o.health || o.cut || o.surv || o.comf;
      if (!o.fireCounted && !defCounted) notCounted.push(+k);
    }
    var r = evalAgg(g, q, wi, a, spare, spare.length, baseDef, baseRes, true);
    // 極意スキルと Inheritance は、上限を上げる働きで計算に入っているので、「数値に入れていないスキル」から外します
    var over = false;
    for (var k2 in levels) { var s2 = I.skillById[k2]; if (levels[k2] > s2.max) over = true; }
    r.notCounted = notCounted.filter(function (id) {
      var s3 = I.skillById[id];
      if (s3.unlocks != null && (levels[s3.unlocks] || 0) > I.skillById[s3.unlocks].max) return false;
      if (id === I.inheritId && over) return false;
      return true;
    });
    return r;
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
    q.minRarity = q.minRarity || 1;         // マスターランクの防具の下限レア度（序盤の防具を外すときに使う。上位・下位の防具には使わない）
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
    function fireRel(s) {
      for (var lv = 1; lv <= s.maxAll; lv++) if (effContrib(g, s, lv, q, wi).fireCounted) return true;
      return false;
    }
    // 防御・耐性の下限があるときは、防御・耐性のスキルも関わるものとします（それを持つ防具を外さないため）
    var hasMin = q.minDefense > 0 || q.minRes.some(function (x) { return x != null && x !== ''; });
    g.skills.forEach(function (s) {
      if (hasMin && I.defSkill[s.id]) rel[s.id] = 1;
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
        def: defOf(q, a), res: a.res, rarity: a.rarity };
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
      if (q.fixedArmor[p] != null) list = [mkCand(armorOf(g, q, q.fixedArmor[p]))];
      else list = g.armors.filter(function (a) {
        return a.part === p && a.rank && q.ranks.indexOf(a.rank) >= 0 && !ex[a.id] && a.rarity <= q.maxRarity && (a.rank !== 'MR' || a.rarity >= q.minRarity);
      }).map(function (a) { return mkCand(armorOf(g, q, a.id)); });
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

  /* 速い点数計算：点数に関わるスキルだけを配列で持ち、scoreParts と同じ式（evalAgg）で計算します（試験で一致を確かめます） */
  function compileScorer(P) {
    if (P._fast) return P._fast;
    var R = P.relList.length, q = P.q, wi = P.wi, I = P.I, g = P.g;
    var sk = P.relList.map(function (id) { return I.skillById[id]; });
    var unlockIdx = sk.map(function (s) { return s.unlockedBy != null && P.relPos[s.unlockedBy] != null ? P.relPos[s.unlockedBy] : -1; });
    var hasSecret = sk.map(function (s) { return s.unlockedBy != null; });
    var inheritIdx = I.inheritId != null && P.relPos[I.inheritId] != null ? P.relPos[I.inheritId] : -1;
    // T[i][lv] = その段階の効果
    var T = sk.map(function (s) {
      var arr = [null];
      for (var lv = 1; lv <= s.maxAll; lv++) arr.push(effContrib(g, s, lv, q, wi));
      return arr;
    });
    var lvBuf = new Int16Array(R);
    function levels(pts) {
      for (var i = 0; i < R; i++) {
        var s = sk[i], p = pts[i];
        var cap = ((unlockIdx[i] >= 0 && pts[unlockIdx[i]] > 0) || (hasSecret[i] && inheritIdx >= 0 && pts[inheritIdx] > 0)) ? s.maxAll : s.max;
        lvBuf[i] = p < cap ? p : cap;
      }
      return lvBuf;
    }
    // 速くするため、効果を「欄の番号・値・足し方」の短い一覧にして、数の配列に足し込みます（足し方は addContrib と同じ）
    var F = ['atk', 'atkMul', 'aff', 'crit', 'critElem', 'eAdd0', 'eAdd1', 'eMul0', 'eMul1', 'hAdd0', 'hAdd1', 'hMul0', 'hMul1', 'hidden', 'accelFrac', 'accelW',
      'art', 'special', 'jump', 'def', 'defMul', 'resAll', 'r0', 'r1', 'r2', 'r3', 'r4', 'resMul', 'health', 'cut', 'surv', 'comf'];
    var OP = { atkMul: 'mul', eMul0: 'mul', eMul1: 'mul', hMul0: 'mul', hMul1: 'mul', defMul: 'mul', resMul: 'mul', crit: 'max', critElem: 'max', hidden: 'max', art: 'max', special: 'max', jump: 'max', cut: 'max', accelFrac: 'acc', accelW: 'skip' };
    var NEUTRAL = new Float64Array(F.length);
    F.forEach(function (f, i) { NEUTRAL[i] = OP[f] === 'mul' || f === 'art' || f === 'special' || f === 'jump' ? 1 : 0; });
    function flat(o) {
      return { atk: o.atk, atkMul: o.atkMul, aff: o.aff, crit: o.crit, critElem: o.critElem, eAdd0: o.eAdd[0], eAdd1: o.eAdd[1], eMul0: o.eMul[0], eMul1: o.eMul[1],
        hAdd0: o.hAdd[0], hAdd1: o.hAdd[1], hMul0: o.hMul[0], hMul1: o.hMul[1], hidden: o.hidden, accelFrac: o.accelFrac, accelW: o.accelW, art: o.art, special: o.special, jump: o.jump,
        def: o.def, defMul: o.defMul, resAll: o.resAll, r0: o.res[0], r1: o.res[1], r2: o.res[2], r3: o.res[3], r4: o.res[4], resMul: o.resMul, health: o.health, cut: o.cut, surv: o.surv, comf: o.comf };
    }
    // S[i][lv] = [欄の番号, 値, 種類(0 足す・1 かける・2 大きい方・3 属性加速), ...]
    var S = T.map(function (arr) {
      return arr.map(function (o) {
        if (!o) return null;
        var fo = flat(o), out = [];
        F.forEach(function (f, k) {
          var op = OP[f] || 'add', v = fo[f];
          if (op === 'skip') return;
          if (v === NEUTRAL[k]) return;
          out.push(k, v, op === 'add' ? 0 : op === 'mul' ? 1 : op === 'max' ? 2 : 3);
          if (op === 'acc') out.push(fo.accelW);
        });
        return out;
      });
    });
    var ACC = new Float64Array(F.length), iAW = F.indexOf('accelW');
    var A = newAgg(wi);
    function total(lv, spare, nSpare, baseDef, baseRes) {
      ACC.set(NEUTRAL);
      ACC[2] = wi.aff;
      for (var i = 0; i < R; i++) {
        var l = lv[i]; if (l <= 0) continue;
        var e = S[i][l];
        for (var j = 0; j < e.length; j += 3) {
          var k = e[j], v = e[j + 1], op = e[j + 2];
          if (op === 0) ACC[k] += v;
          else if (op === 1) ACC[k] *= v;
          else if (op === 2) { if (v > ACC[k]) ACC[k] = v; }
          else { if (v > ACC[k]) { ACC[k] = v; ACC[iAW] = e[j + 3]; } j++; }
        }
      }
      var a = A;
      a.atk = ACC[0]; a.atkMul = ACC[1]; a.aff = ACC[2]; a.crit = ACC[3]; a.critElem = ACC[4];
      a.eAdd[0] = ACC[5]; a.eAdd[1] = ACC[6]; a.eMul[0] = ACC[7]; a.eMul[1] = ACC[8]; a.hAdd[0] = ACC[9]; a.hAdd[1] = ACC[10]; a.hMul[0] = ACC[11]; a.hMul[1] = ACC[12];
      a.hidden = ACC[13]; a.accelFrac = ACC[14]; a.accelW = ACC[15]; a.art = ACC[16]; a.special = ACC[17]; a.jump = ACC[18];
      a.def = ACC[19]; a.defMul = ACC[20]; a.resAll = ACC[21]; a.res[0] = ACC[22]; a.res[1] = ACC[23]; a.res[2] = ACC[24]; a.res[3] = ACC[25]; a.res[4] = ACC[26];
      a.resMul = ACC[27]; a.health = ACC[28]; a.cut = ACC[29]; a.surv = ACC[30]; a.comf = ACC[31];
      return evalAgg(g, q, wi, a, spare, nSpare, baseDef, baseRes, false);
    }
    // 点数を下げることがあるスキル（全属性耐性強化：耐性がマイナスだと、もっとマイナスになる）の位置
    var downIdx = [];
    T.forEach(function (arr, i) { if (arr.some(function (o) { return o && o.resMul !== 1; })) downIdx.push(i); });
    P._fast = { levels: levels, total: total, R: R, downIdx: downIdx };
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
      var a = c.a; add(a.skills); def += defOf(P.q, a); for (var i = 0; i < 5; i++) res[i] += a.res[i];
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

  /* 余りスロットの埋め方。
   * 1. どのスロットでもよいので点数が一番上がる装飾品を選び、入る一番小さいスロットに入れる（欲張り法）。
   * 2. スロットを 1 つずつ見て、中身を「空き」かほかの装飾品に入れかえて上がるなら入れかえる。2 つのスロットの中身の入れかえも試す。
   * effort 2 以上：1 の各手で、次の 1 手まで見て選ぶ（2 手先読み）。最後の上位の案を磨くときに使います。
   * rp は点数に関わるスキルのポイント（必要な装飾品まで入れたもの）。終わったときは元の値に戻します。 */
  function fillSpare(P, F, rp, spare0, def, res, effort) {
    var cand = P.fillDecos || (P.fillDecos = fillCandidates(P));
    var candV = P.fillVec || (P.fillVec = cand.map(function (d) { return d.skills.filter(function (x) { return P.relPos[x[0]] != null; }).map(function (x) { return [P.relPos[x[0]], x[1]]; }); }));
    var slots = spare0.slice().sort(function (a, b) { return b - a; });
    var n = slots.length, asg = new Int16Array(n).fill(-1);
    var buf = new Int8Array(n + 1);
    function add(ci, sign) { var v = candV[ci]; for (var k = 0; k < v.length; k++) rp[v[k][0]] += sign * v[k][1]; }
    function total() {
      var m = 0; for (var j = 0; j < n; j++) if (asg[j] < 0) buf[m++] = slots[j];
      return F.total(F.levels(rp), buf, m, def, res);
    }
    function smallestFree(size) { for (var j = n - 1; j >= 0; j--) if (asg[j] < 0 && slots[j] >= size) return j; return -1; }
    var cur = total();
    // 1. 欲張り法：同じ装飾品を 1〜3 個まとめて入れる手も比べ、「1 個あたりの点数の上がり方」が一番大きい手を選びます。
    //    （防御のように、何レベルか重ねて初めて大きく上がるスキルを見落とさないため）
    var KMAX = effort >= 2 ? 3 : 2;
    var js = new Int16Array(KMAX);
    while (true) {
      var bestEff = 1e-9, bestC = -1, bestK = 0, bestJs = null;
      for (var c = 0; c < cand.length; c++) {
        var placed = 0, base = cur;
        for (var k = 0; k < KMAX; k++) {
          var j = smallestFree(cand[c].size); if (j < 0) break;
          add(c, 1); asg[j] = c; js[k] = j; placed++;
          var t = total(), eff = (t - base) / placed;
          if (effort >= 2 && placed === 1) {
            // 2 手先読み：もう 1 個（別の装飾品でもよい）入れたときの一番よい点数も見ます
            for (var c2 = 0; c2 < cand.length; c2++) {
              var j2 = smallestFree(cand[c2].size); if (j2 < 0) continue;
              add(c2, 1); asg[j2] = c2;
              var t2 = total(); if ((t2 - base) / 2 > eff) eff = (t2 - base) / 2;
              asg[j2] = -1; add(c2, -1);
            }
          }
          if (t > cur + 1e-9 && (eff > bestEff + 1e-9 || (bestC >= 0 && Math.abs(eff - bestEff) <= 1e-9 && cand[c].size < cand[bestC].size))) {
            bestEff = eff; bestC = c; bestK = placed; bestJs = Array.prototype.slice.call(js, 0, placed);
          }
        }
        for (var u = placed - 1; u >= 0; u--) { asg[js[u]] = -1; add(c, -1); }
      }
      if (bestC < 0) break;
      // 先読みの値で選んだときも、実際に入れるのは選んだ装飾品だけです（1 個ずつ確かめながら進みます）
      for (var u2 = 0; u2 < bestK; u2++) { add(bestC, 1); asg[bestJs[u2]] = bestC; }
      cur = total();
    }
    // 2. 入れかえ（1 つずつ、そして 2 つの中身の交換）。探している途中（effort 1）は 1 つずつを 1 回だけにして速くします
    var passes = effort >= 2 ? 4 : 1;
    for (var pass = 0; pass < passes; pass++) {
      var improved = false;
      for (var j3 = 0; j3 < n; j3++) {
        var old = asg[j3];
        if (old >= 0) add(old, -1);
        asg[j3] = -1;
        var bT = total(), bC = -1;
        for (var c3 = 0; c3 < cand.length; c3++) {
          if (cand[c3].size > slots[j3]) continue;
          add(c3, 1); asg[j3] = c3;
          var t3 = total();
          asg[j3] = -1; add(c3, -1);
          if (t3 > bT + 1e-9) { bT = t3; bC = c3; }
        }
        if (bC !== old && bT > cur + 1e-9) { if (bC >= 0) add(bC, 1); asg[j3] = bC; cur = bT; improved = true; }
        else { if (old >= 0) add(old, 1); asg[j3] = old; }
      }
      // 2 つのスロットの中身を入れかえる（大きいスロットを空けて、別の装飾品を入れられるように）。最後に磨くときだけ
      if (effort >= 2) for (var a1 = 0; a1 < n; a1++) for (var a2 = a1 + 1; a2 < n; a2++) {
        var x1 = asg[a1], x2 = asg[a2];
        if (x1 === x2) continue;
        if ((x2 >= 0 && cand[x2].size > slots[a1]) || (x1 >= 0 && cand[x1].size > slots[a2])) continue;
        asg[a1] = x2; asg[a2] = x1;
        // 入れかえただけでは点数は同じなので、空いたスロットに 1 つ足せるかを見ます
        var fj = -1; for (var z = 0; z < n; z++) if (asg[z] < 0) { fj = z; break; }
        var gainC = -1, gainT = cur + 1e-9;
        if (fj >= 0) {
          for (var c4 = 0; c4 < cand.length; c4++) {
            if (cand[c4].size > slots[fj]) continue;
            add(c4, 1); asg[fj] = c4;
            var t4 = total();
            asg[fj] = -1; add(c4, -1);
            if (t4 > gainT) { gainT = t4; gainC = c4; }
          }
        }
        if (gainC >= 0) { add(gainC, 1); asg[fj] = gainC; cur = gainT; improved = true; }
        else { asg[a1] = x1; asg[a2] = x2; }
      }
      if (!improved) break;
    }
    // 3. 最後に磨くとき（effort 3）：ビーム探索（途中の埋め方を上位 12 通り残しながら進む）と、
    //    残りのスロットが 3 つ以下なら全部の埋め方を試し、一番よいものを使います
    if (effort >= 3 && n > 0) {
      var keepAsg = Array.prototype.slice.call(asg);
      for (var r0 = 0; r0 < n; r0++) if (asg[r0] >= 0) { add(asg[r0], -1); asg[r0] = -1; }
      var evalPlan = function (plan) {
        for (var q1 = 0; q1 < n; q1++) if (plan[q1] >= 0) { add(plan[q1], 1); asg[q1] = plan[q1]; }
        var tt = total();
        for (var q2 = 0; q2 < n; q2++) if (plan[q2] >= 0) { add(plan[q2], -1); asg[q2] = -1; }
        return tt;
      };
      var bestPlan = keepAsg, bestTotal = cur;
      if (n <= 3) {
        var plan = new Array(n).fill(-1);
        var rec = function (i) {
          if (i === n) { var tt = evalPlan(plan); if (tt > bestTotal + 1e-9) { bestTotal = tt; bestPlan = plan.slice(); } return; }
          plan[i] = -1; rec(i + 1);
          for (var cc = 0; cc < cand.length; cc++) if (cand[cc].size <= slots[i]) { plan[i] = cc; rec(i + 1); }
          plan[i] = -1;
        };
        rec(0);
      } else {
        var W = 12, beam = [{ plan: new Array(n).fill(-1), t: evalPlan(new Array(n).fill(-1)) }];
        for (var bi = 0; bi < n; bi++) {
          var next = [];
          beam.forEach(function (st) {
            next.push({ plan: st.plan, t: st.t });
            for (var cc = 0; cc < cand.length; cc++) {
              if (cand[cc].size > slots[bi]) continue;
              var p2 = st.plan.slice(); p2[bi] = cc;
              next.push({ plan: p2, t: evalPlan(p2) });
            }
          });
          next.sort(function (x, y) { return y.t - x.t; });
          beam = next.slice(0, W);
        }
        if (beam[0].t > bestTotal + 1e-9) { bestTotal = beam[0].t; bestPlan = beam[0].plan; }
      }
      for (var r1 = 0; r1 < n; r1++) if (bestPlan[r1] >= 0) { add(bestPlan[r1], 1); asg[r1] = bestPlan[r1]; }
      cur = total();
    }
    var picks = [], left = [];
    for (var j5 = 0; j5 < n; j5++) { if (asg[j5] >= 0) { picks.push(asg[j5]); add(asg[j5], -1); } else left.push(slots[j5]); }
    return { picks: picks, spare: left, total: cur };
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
    // 防御・耐性の下限があるときは、足りない分を先に、防御・耐性の装飾品で埋めます（足りない量が一番減る物を 1 つずつ）
    var hasMinQ = P.q.minDefense > 0 || P.q.minRes.some(function (x) { return x != null && x !== ''; });
    if (hasMinQ) {
      var shortOf = function (sc) {
        var d = 0;
        if (P.q.minDefense) d += Math.max(0, P.q.minDefense - sc.detail.defense);
        for (var i = 0; i < 5; i++) { var mm = P.q.minRes[i]; if (mm != null && mm !== '') d += Math.max(0, +mm - sc.detail.res[i]) * 10; }
        return d;
      };
      var deficit = shortOf(evalWith(decoList, spare).sc);
      var defDecos = P.minDecos || (P.minDecos = P.decos.filter(function (d) { return d.skills.some(function (x) { return P.I.defSkill[x[0]]; }); }));
      var guardN = 0;
      while (deficit > 1e-9 && spare.length && guardN++ < 30) {
        spare.sort(function (x, y) { return x - y; });
        var bestD = null, bestDef = deficit, bestIdx = -1;
        for (var dd = 0; dd < defDecos.length; dd++) {
          var d0 = defDecos[dd], jj = -1;
          for (var z = 0; z < spare.length; z++) if (spare[z] >= d0.size) { jj = z; break; }
          if (jj < 0) continue;
          var sp2 = spare.slice(); sp2.splice(jj, 1);
          var df = shortOf(evalWith(decoList.concat([d0]), sp2).sc);
          if (df < bestDef - 1e-9 || (bestD && Math.abs(df - bestDef) <= 1e-9 && d0.size < bestD.size)) { bestD = d0; bestDef = df; bestIdx = jj; }
        }
        if (!bestD) break;
        decoList.push(bestD); spare.splice(bestIdx, 1); deficit = bestDef;
      }
    }
    var F = compileScorer(P), R = F.R;
    var rp = new Int16Array(R);
    for (var kk in G.pts) if (P.relPos[kk] != null) rp[P.relPos[kk]] += G.pts[kk];
    for (var kb in bonusSk) if (P.relPos[kb] != null) rp[P.relPos[kb]] += 1;
    decoList.forEach(function (d) { d.skills.forEach(function (x) { if (P.relPos[x[0]] != null) rp[P.relPos[x[0]]] += x[1]; }); });
    var cand = P.fillDecos || (P.fillDecos = fillCandidates(P));
    var candV = P.fillVec || (P.fillVec = cand.map(function (d) { return d.skills.filter(function (x) { return P.relPos[x[0]] != null; }).map(function (x) { return [P.relPos[x[0]], x[1]]; }); }));
    // 余ったスロットに、目的の点数が上がる装飾品を入れます（fillSpare：欲張り法と入れかえ。上がらなければ空けたまま）
    var fr = fillSpare(P, F, rp, spare, G.def, G.res, P.q.fillEffort || 1);
    fr.picks.forEach(function (ci) { decoList.push(cand[ci]); });
    spare = fr.spare;
    var curTotal = fr.total;
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
      weaponType: P.wi.type,
      weaponSlots: P.wi.slots,
      decos: placed,
      spare: freeSlots.map(function (s) { return { slot: s.ref, size: s.size }; }),
      levels: cur.L.lv, points: cur.L.total,
      bonuses: Object.keys(G.bcount).map(function (b) { return { id: +b, count: G.bcount[b], active: P.I.bonusById[b].skills.filter(function (x) { return G.bcount[b] >= x[1]; }).map(function (x) { return x[0]; }) }; }),
      mods: modsOf(P.q, armorCands.map(function (c) { return c.a.id; })),
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
      var ub = FS.total(lvB, spB, n, curDef + sufDef[d], resB);
      if (FS.downIdx.length) {
        // そのスキルがない場合も計算し、大きいほうを上限にします
        var keep = FS.downIdx.map(function (i) { var v = lvB[i]; lvB[i] = 0; return v; });
        var ub2 = FS.total(lvB, spB, n, curDef + sufDef[d], resB);
        FS.downIdx.forEach(function (i, k) { lvB[i] = keep[k]; });
        if (ub2 > ub) ub = ub2;
      }
      return ub;
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
    // 見つけた上位の案の装飾品の入れ方を、もっと丁寧に磨き直してから並べ直します（fillSpare の effort 3）
    var savedEffort = q.fillEffort;
    q.fillEffort = 3;
    // 磨き直しに使う時間：探す時間の 2 割（1.5 秒から 20 秒の間）。点数の高い案から順に磨きます
    var budget = Math.min(20000, Math.max(1500, isFinite(q.timeLimitMs) ? q.timeLimitMs * 0.2 : 20000));
    var tr = Date.now(), refined = [], nRef = 0;
    for (var hi = 0; hi < heap.length; hi++) {
      var b0 = heap[hi];
      if (Date.now() - tr > budget || (q.stopSignal && q.stopSignal() && hi > 0)) { refined.push(b0); continue; }
      var armorC = b0.armor.map(function (id) { return { a: armorOf(g, q, id) }; });
      var charmC = b0.charm != null ? { a: P.I.charmById[b0.charm] } : null;
      var nb = finishBuild(P, armorC, charmC, null);
      refined.push(nb && !nb.below && nb.score.total >= b0.score.total - 1e-9 ? nb : b0);
      nRef++;
      if (Date.now() - lastYield > 100) { lastYield = Date.now(); yield { progress: true, refining: true, refined: nRef, total: heap.length, nodes: stats.nodes, leaves: stats.leaves, found: heap.length, ms: Date.now() - t0, pass: stats.passes, passes: widths.length }; }
    }
    stats.refined = nRef;
    q.fillEffort = savedEffort;
    refined.sort(function (x, y) { return y.score.total - x.score.total; });
    heap = refined;
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
  // 案に付ける「強化の入力」（URL や検算でも同じ数値を使えるように、案と一緒に持ち歩きます）
  function modsOf(q, armorIds) {
    var m = {};
    if (q.weaponOverride) m.weaponOverride = q.weaponOverride;
    if (q.armorAugMax) m.armorAugMax = true;
    if (q.armorOverrides) {
      var ao = {}; armorIds.forEach(function (id) { if (q.armorOverrides[id]) ao[id] = q.armorOverrides[id]; });
      if (Object.keys(ao).length) m.armorOverrides = ao;
    }
    if (q.parts) m.parts = q.parts;
    if (q.elemWeight != null && +q.elemWeight !== 1) m.elemWeight = +q.elemWeight;
    return Object.keys(m).length ? m : null;
  }
  function evaluateBuild(g, spec, q0) {
    var q = normalizeQuery(g, Object.assign({}, q0 || {}, spec.mods || {}));
    var P = prepare(g, Object.assign({}, q, { skills: [], weaponId: spec.weapon, weaponSlots: spec.weaponSlots, weaponType: spec.weaponType || q.weaponType, fixedArmor: {}, minRarity: 1 }));
    var I = P.I;
    var armorC = spec.armor.map(function (id) { return { a: armorOf(g, q, id) }; });
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
      armor: spec.armor.slice(), charm: spec.charm, weapon: spec.weapon, weaponType: P.wi.type, weaponSlots: P.wi.slots,
      decos: spec.decos.map(function (x) { return { slot: x.slot, slotSize: slotSize[x.slot], deco: x.deco }; }),
      spare: spare.map(function (s) { return { slot: s.ref, size: s.size }; }),
      levels: L.lv, points: L.total,
      bonuses: Object.keys(G.bcount).map(function (b) { return { id: +b, count: G.bcount[b], active: I.bonusById[b].skills.filter(function (y) { return G.bcount[b] >= y[1]; }).map(function (y) { return y[0]; }) }; }),
      mods: spec.mods || null,
      score: sc, objective: q.objective
    };
  }

  var API = {
    PARTS: PARTS, PART_JA: PART_JA, ELEMS: ELEMS, ELEM_JA: ELEM_JA, RANK_JA: RANK_JA, WEAPON_TYPES: WEAPON_TYPES, WEAPON_JA: WEAPON_JA,
    WEAPON_BLOAT: WEAPON_BLOAT, UPTIME: UPTIME, CRIT_ELEM: CRIT_ELEM, TRUE_CRIT_ELEM: TRUE_CRIT_ELEM, PARTS_DEFAULT: PARTS_DEFAULT, critElemMul: critElemMul, effContrib: effContrib, GUARD_WEAPONS: GUARD_WEAPONS, NEG_CRIT: NEG_CRIT, ELEM_DIV: ELEM_DIV, W: W, OBJECTIVES: OBJECTIVES, SURVIVAL: SURVIVAL, COMFORT: COMFORT, RANGED: RANGED,
    indexGame: indexGame, armorOf: armorOf, modsOf: modsOf, prepare: prepare, search: search, searchGen: searchGen, finishBuild: finishBuild, evaluateBuild: evaluateBuild,
    scoreParts: scoreParts, compileScorer: compileScorer, weaponInfo: weaponInfo, normalizeQuery: normalizeQuery, solveDecos: solveDecos, diversify: diversify, rankOfRarity: rankOfRarity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MHEngine = API;
})(typeof self !== 'undefined' ? self : this);
