/* 自動の試験。 node tests/run.js で動きます。 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const game = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'game.json'), 'utf8'));
const { makeChecker } = require('./checker.js');
const C = makeChecker(game);
const I = E.indexGame(game);
const sk = n => { const s = I.skillByEn[n]; if (!s) throw new Error('no skill ' + n); return s.id; };

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  失敗: ' + msg); } }
function section(t) { console.log('■ ' + t); }

function checkResult(r, q, label) {
  for (const b of r.builds) {
    const c = C.check(b, q.skills);
    ok(c.ok, label + ' 案' + b.rank + ': ' + c.errors.join(' / '));
    ok(Math.abs(b.fastTotal - b.score.total) < 1e-6, label + ' 速い計算と通常の計算の点数が違います ' + b.fastTotal + ' ' + b.score.total);
    const ev = E.evaluateBuild(game, b, q);
    ok(ev && Math.abs(ev.score.total - b.score.total) < 1e-6, label + ' 案を計算し直すと点数が違います');
    // 共有 URL と同じく、案に付いている情報（武器の種類・強化の入力）と目的・見込みだけで計算し直しても同じになるか
    const ev2 = E.evaluateBuild(game, { armor: b.armor, charm: b.charm, weapon: b.weapon, weaponType: b.weaponType, weaponSlots: b.weaponSlots, decos: b.decos.map(d => ({ slot: d.slot, deco: d.deco })), mods: b.mods }, { objective: q.objective, uptimeScale: q.uptimeScale });
    ok(ev2 && Math.abs(ev2.score.total - b.score.total) < 1e-6, label + ' URL と同じ情報だけで計算し直すと点数が違います（' + (ev2 && ev2.score.total) + ' と ' + b.score.total + '）');
    // 防御力の下限
    if (q.minDefense) ok(b.score.detail.defense >= q.minDefense, label + ' 防御力の下限');
  }
}

// ---- 1. データの行数
section('データの行数');
const rep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'report.json'), 'utf8'));
ok(rep.counts.armors === 1595, '防具 1595 行');
ok(rep.counts.sets === 351, 'シリーズ 351 行');
ok(rep.counts.decos === 404, '装飾品 404 行');
ok(rep.counts.charms === 317, '護石 317 行');
ok(rep.counts.skills === 178, 'スキル 178 行');
ok(rep.missing_ref.length === 0, '参照先のない名前がない');

// ---- 2. 決まりの試験
section('決まり（上限・極意・シリーズ・スロット）');
{
  // 挑戦者 Lv7 は極意が必要
  const q = { weaponType: 'long-sword', weaponSlots: [], objective: 'fire', skills: [{ id: sk('Agitator'), lv: 7 }], timeLimitMs: 15000 };
  const r = E.search(game, q);
  ok(r.builds.length > 0, '挑戦者 Lv7 の案がある');
  for (const b of r.builds) ok((b.levels[sk('Agitator Secret')] || 0) >= 1 || (b.levels[sk('Inheritance')] || 0) >= 1, '挑戦者 Lv7 の案に挑戦者・極意か Inheritance がある');
  checkResult(r, q, '挑戦者7');
  // 上限を超えると止める
  let threw = false; try { E.search(game, { skills: [{ id: sk('Critical Eye'), lv: 8 }] }); } catch (e) { threw = true; }
  ok(threw, '見切り Lv8 は上限を超えるので止める');
  // スロットの大きさ：大きさ 1 のスロットしかないとき 4 の装飾品は入らない
  const g2 = { ...game };
  const q2 = { ranks: ['LR'], objective: 'comfort', skills: [{ id: sk('Attack Boost'), lv: 1 }], timeLimitMs: 15000 };
  const r2 = E.search(game, q2);
  for (const b of r2.builds) for (const d of b.decos) ok(I.decoById[d.deco].size <= d.slotSize, '装飾品の大きさ <= スロットの大きさ');
  checkResult(r2, q2, '下位');
}

// ---- 3. 普通の検索
section('いろいろな条件の検索（検算プログラムで全案を確かめる）');
const longsword = game.weapons.filter(w => w.type === 'long-sword' && w.rarity === 12).sort((a, b) => b.attack - a.attack)[0];
const queries = [
  { weaponId: longsword.id, objective: 'fire', skills: [{ id: sk('Weakness Exploit'), lv: 3 }, { id: sk('Critical Boost'), lv: 3 }, { id: sk('Critical Eye'), lv: 4 }], timeLimitMs: 6000 },
  { weaponType: 'lance', weaponSlots: [2, 1], objective: 'defense', skills: [{ id: sk('Guard'), lv: 5 }, { id: sk('Guard Up'), lv: 1 }], timeLimitMs: 6000 },
  { weaponType: 'bow', weaponSlots: [4], objective: 'comfort', ranks: ['HR'], skills: [{ id: sk('Evade Extender'), lv: 2 }], timeLimitMs: 6000 },
  { weaponType: 'hammer', weaponSlots: [3], objective: 'balance', ranks: ['MR'], minDefense: 700, skills: [{ id: sk('Attack Boost'), lv: 4 }, { id: sk('Health Boost'), lv: 3 }], timeLimitMs: 6000 },
];
for (const q of queries) {
  const r = E.search(game, q);
  ok(r.builds.length > 0, q.objective + ' の案がある');
  checkResult(r, q, q.objective);
  for (const b of r.builds) for (const x of q.skills) ok((b.levels[x.id] || 0) >= x.lv, '条件のスキルを満たす');
  console.log('  ' + q.objective + ': ' + r.builds.length + ' 案、' + r.stats.leaves + ' 通りを調べた、打ち切り=' + r.stats.truncated + '、' + r.stats.timeMs + 'ms');
}

// ---- 3b. v1.1 で足した計算
section('v1.1 の計算（属性・武器の種類ごとの数値・カスタム強化）');
{
  const wpick = (type, f) => game.weapons.filter(w => w.type === type && w.rarity >= 11 && f(w)).sort((a, b) => b.attack - a.attack)[0];
  // 会心撃【属性】：属性のある武器なら属性期待値が上がる（調べた倍率）
  const ce = sk('Critical Element');
  const ew = wpick('dual-blades', w => !w.elemHidden && w.elements.length && ['fire', 'water', 'thunder', 'ice', 'dragon'].includes(w.elements[0][0]));
  const wi = E.weaponInfo(game, { weaponId: ew.id, objective: 'fire' });
  const base = E.scoreParts(game, { objective: 'fire' }, wi, { [sk('Critical Eye')]: 7 }, [], 0, [0, 0, 0, 0, 0]);
  const withCE = E.scoreParts(game, { objective: 'fire' }, wi, { [sk('Critical Eye')]: 7, [ce]: 1 }, [], 0, [0, 0, 0, 0, 0]);
  ok(withCE.detail.elem > base.detail.elem && Math.abs(withCE.detail.critElem - 1.35) < 1e-9, '双剣の会心撃【属性】は 1.35 倍として属性期待値が上がる');
  ok(base.notCounted.indexOf(ce) < 0 && withCE.notCounted.indexOf(ce) < 0, '属性のある武器では会心撃【属性】を「数値に入れていないスキル」にしない');
  // 隠し属性：属性解放なしでは 0、Lv3 で全部
  const hw = wpick('great-sword', w => w.elemHidden && w.elements.length && ['fire', 'water', 'thunder', 'ice', 'dragon'].includes(w.elements[0][0]));
  if (hw) {
    const hwi = E.weaponInfo(game, { weaponId: hw.id });
    const h0 = E.scoreParts(game, { objective: 'fire' }, hwi, {}, [], 0, [0, 0, 0, 0, 0]);
    const h3 = E.scoreParts(game, { objective: 'fire' }, hwi, { [sk('Free Elem/Ammo Up')]: 3 }, [], 0, [0, 0, 0, 0, 0]);
    ok(h0.detail.elem === 0 && Math.abs(h3.detail.elemShown[0][1] - hw.elements[0][1]) < 1e-9, '隠し属性は属性解放 Lv3 で全部出る（' + hw.ja + '）');
  } else ok(false, '隠し属性の大剣が見つからない');
  // 砲術：ガンランスだけ点数が上がる
  const gl = wpick('gunlance', () => true), ls = wpick('long-sword', () => true);
  const art = sk('Artillery');
  const g1 = E.scoreParts(game, { objective: 'fire' }, E.weaponInfo(game, { weaponId: gl.id }), { [art]: 3 }, [], 0, [0, 0, 0, 0, 0]);
  const l1 = E.scoreParts(game, { objective: 'fire' }, E.weaponInfo(game, { weaponId: ls.id }), { [art]: 3 }, [], 0, [0, 0, 0, 0, 0]);
  ok(Math.abs(g1.fire - (100 * (0.7 + 0.3 * 1.3))) < 1e-6, 'ガンランスの砲術 Lv3：爆発の割合 30% に 1.3 倍がかかる（' + g1.fire.toFixed(2) + '）');
  ok(Math.abs(l1.fire - 100) < 1e-9 && l1.notCounted.indexOf(art) >= 0, '太刀では砲術は点数に入らず、「数値に入れていないスキル」になる');
  // 武器の数値を自分で入れる（カスタム強化）
  const qo = { weaponId: ls.id, objective: 'fire', weaponOverride: { attack: ls.attack + 33, affinity: 30, slots: [4, 4, 1] }, skills: [{ id: sk('Critical Eye'), lv: 4 }], timeLimitMs: 4000, minRarity: 10 };
  const ro = E.search(game, qo);
  ok(ro.builds.length && ro.builds[0].weaponSlots.join() === '4,4,1', '入れた武器のスロットで探す');
  checkResult(ro, qo, '武器の強化');
  ok(ro.builds.every(b => C.check(b, qo.skills).ok), '武器の強化を入れた案も検算が合う');
  const wiO = E.weaponInfo(game, qo), wiN = E.weaponInfo(game, { weaponId: ls.id });
  ok(Math.abs(wiO.raw - (ls.attack + 33) / E.WEAPON_BLOAT['long-sword']) < 1e-9 && wiO.aff === 30 && wiN.aff === ls.affinity, '入れた表示攻撃力と会心率が、武器の基礎攻撃力と会心率になる');
  const sO = E.scoreParts(game, { objective: 'fire' }, wiO, {}, [], 0, [0, 0, 0, 0, 0]), sN = E.scoreParts(game, { objective: 'fire' }, wiN, {}, [], 0, [0, 0, 0, 0, 0]);
  ok(sO.detail.phys0 > sN.detail.phys0, '入れた攻撃力・会心率で、スキルなしの物理期待値が上がる');
  // 防具の強化を自分で入れる・防御力をカスタム強化の最大で計算する
  const someHead = game.armors.find(a => a.part === 'head' && a.rarity === 12);
  const qa = { weaponType: 'hammer', weaponSlots: [2], objective: 'defense', armorAugMax: true, fixedArmor: { head: someHead.id }, armorOverrides: { [someHead.id]: { slots: [4, 4, 4], addSkills: [[sk('Health Boost'), 1]] } }, skills: [{ id: sk('Health Boost'), lv: 3 }], timeLimitMs: 4000 };
  const ra = E.search(game, qa);
  ok(ra.builds.length && ra.builds[0].mods && ra.builds[0].mods.armorOverrides && ra.builds[0].mods.armorAugMax, '防具の強化の入力が案に付く');
  checkResult(ra, qa, '防具の強化');
  ok(ra.builds.every(b => b.score.detail.defBase === C.recompute(b).defenseBase), '防御力をカスタム強化の最大で計算した値が、検算と合う');
  // Inheritance（データの英語の説明：極意の上限をなくす）
  const qi = { weaponType: 'long-sword', weaponSlots: [2, 2], objective: 'fire', skills: [{ id: sk('Agitator'), lv: 7 }], timeLimitMs: 8000, minRarity: 10 };
  const ri = E.search(game, qi);
  ok(ri.builds.length > 0 && ri.builds.every(b => (b.levels[sk('Agitator Secret')] || 0) > 0 || (b.levels[sk('Inheritance')] || 0) > 0), '挑戦者 Lv7 は極意か Inheritance で上限が上がる');
  checkResult(ri, qi, 'Inheritance');
  // 防具のレア度の下限
  const qm = { weaponType: 'bow', weaponSlots: [1], objective: 'comfort', minRarity: 11, skills: [], timeLimitMs: 3000 };
  const rm = E.search(game, qm);
  ok(rm.builds.length && rm.builds.every(b => b.armor.every(id => I.armorById[id].rarity >= 11)), '防具のレア度の下限を守る');
}

// ---- 3c. 見直しで見つかった問題の試験
section('見直しで見つかった問題が直っていること');
{
  // 防具のレア度の下限は、マスターランクの防具だけにかける
  const rh = E.search(game, { weaponType: 'long-sword', weaponSlots: [2], ranks: ['HR'], skills: [{ id: sk('Attack Boost'), lv: 1 }], minRarity: 10, timeLimitMs: 3000 });
  ok(rh.builds.length > 0, '上位だけで探しても、レア度の下限で案が 0 件にならない');
  // 攻撃の内わけの合計が 100% を超えても、スキルで点数が下がらない
  const ig = game.weapons.find(w => w.type === 'insect-glaive' && w.rarity === 12);
  const wiP = E.weaponInfo(game, { weaponId: ig.id, parts: { art: 0.6, special: 0.5, jump: 0.5 } });
  const p0 = E.scoreParts(game, { objective: 'fire', parts: { art: 0.6, special: 0.5, jump: 0.5 } }, wiP, {}, [], 0, [0, 0, 0, 0, 0]);
  const p1 = E.scoreParts(game, { objective: 'fire', parts: { art: 0.6, special: 0.5, jump: 0.5 } }, wiP, { [sk('Airborne')]: 1, [sk('Attack Boost')]: 7 }, [], 0, [0, 0, 0, 0, 0]);
  ok(p1.fire >= p0.fire, '内わけの合計が 100% を超えても、スキルを足して火力点が下がらない（' + p0.fire.toFixed(2) + ' → ' + p1.fire.toFixed(2) + '）');
  // 属性と状態異常を持つ武器は、属性を状態異常と半分ずつとして数える
  const dual = game.weapons.find(w => w.elements.length === 2 && ['fire', 'water', 'thunder', 'ice', 'dragon'].includes(w.elements[0][0]) && !['fire', 'water', 'thunder', 'ice', 'dragon'].includes(w.elements[1][0]));
  if (dual) {
    const d0 = E.scoreParts(game, { objective: 'fire' }, E.weaponInfo(game, { weaponId: dual.id }), {}, [], 0, [0, 0, 0, 0, 0]);
    ok(Math.abs(d0.detail.elem0 - dual.elements[0][1] / 10 / 2) < 1e-9, '属性と状態異常を持つ武器（' + dual.ja + '）は、属性を半分として数える');
  }
  // 隠し属性の武器に属性の強化を入れても、属性解放が要る
  const hw = game.weapons.find(w => w.elemHidden && w.rarity >= 11 && w.elements.length && ['fire', 'water', 'thunder', 'ice', 'dragon'].includes(w.elements[0][0]));
  if (hw) {
    const hq = { weaponId: hw.id, weaponOverride: { element: [hw.elements[0][0], hw.elements[0][1] + 30] } };
    const h0 = E.scoreParts(game, Object.assign({ objective: 'fire' }, hq), E.weaponInfo(game, hq), {}, [], 0, [0, 0, 0, 0, 0]);
    ok(h0.detail.elem === 0, '隠し属性の武器に属性の強化を入れても、属性解放なしでは属性は出ない');
  }
  // 全属性耐性強化があっても、守りの検索で取りこぼさない（小さな例で総当たりと比べる）
  const alat = game.sets.filter(st => st.bonus != null && game.bonuses[st.bonus].skills.some(x => game.skills[x[0]].en === 'All Elemental Resistance')).map(st => st.id);
  const keepIds = new Set();
  const pick = {};
  for (const p of E.PARTS) {
    const list = game.armors.filter(a => a.part === p && a.rank === 'MR' && (alat.includes(a.set) || a.res.some(r => r < 0))).slice(0, 4);
    pick[p] = list; list.forEach(a => keepIds.add(a.id));
  }
  const qd = { weaponType: 'hammer', weaponSlots: [1], ranks: ['MR'], objective: 'defense', excludeArmor: game.armors.filter(a => !keepIds.has(a.id)).map(a => a.id), excludeCharms: game.charms.map(c => c.id), timeLimitMs: 60000, topK: 20 };
  const rd = E.search(game, qd);
  const Pd = E.prepare(game, qd);
  let best = -Infinity;
  for (const h of pick.head) for (const c of pick.chest) for (const a of pick.arms) for (const w of pick.waist) for (const l of pick.legs) {
    const b = E.finishBuild(Pd, [h, c, a, w, l].map(x => ({ a: x })), null);
    if (b && !b.below && b.score.total > best) best = b.score.total;
  }
  ok(rd.builds.length && Math.abs(rd.builds[0].score.total - best) < 1e-6, '全属性耐性強化と耐性マイナスの防具でも、守りの最良を取りこぼさない（総当たり ' + best.toFixed(3) + '、検索 ' + (rd.builds[0] && rd.builds[0].score.total.toFixed(3)) + '）');
  // 強化したスロットに差した装飾品の場所が、入れたスロットの中にある
  const zw = game.weapons.find(w => w.type === 'long-sword' && w.rarity === 12 && w.slots.length === 2);
  const qz = { weaponId: zw.id, weaponOverride: { slots: [4, 4, 2] }, objective: 'fire', skills: [{ id: sk('Critical Eye'), lv: 4 }], timeLimitMs: 3000, minRarity: 10 };
  const rz = E.search(game, qz);
  ok(rz.builds.every(b => b.decos.every(d => d.slot !== 'weapon#2' || d.slotSize === 2)), '強化で足した武器のスロットの大きさで差す');
}

{
  // 防御・耐性の下限：装飾品で埋めれば満たせる防具の組を、案ごと捨てない（見直しで見つかった例）
  const qmr = { weaponType: 'long-sword', objective: 'fire', skills: [], minRarity: 10, fixedArmor: { head: 1576, chest: 1577, arms: 1578, waist: 1579, legs: 1580 }, minRes: [1, null, null, null, null], timeLimitMs: 4000 };
  if (game.armors.find(a => a.id === 1576)) {
    const rmr = E.search(game, qmr);
    ok(rmr.builds.length > 0 && rmr.builds.every(b => b.score.detail.res[0] >= 1), '火耐性の下限を、装飾品で埋めて満たす');
    checkResult(rmr, qmr, '耐性の下限');
  }
}

// ---- 4. 小さな例で総当たりと比べる
section('小さな例で総当たりと比べる');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const objectives = ['fire', 'defense', 'comfort', 'balance'];
const skillPool = ['Attack Boost', 'Critical Eye', 'Weakness Exploit', 'Health Boost', 'Evade Window', 'Critical Boost', 'Agitator', 'Divine Blessing', 'Earplugs', 'Guard'];
const refineStats = { n: 0, hit: 0, miss: [] };
for (let t = 0; t < 24; t++) {
  const R = rng(1000 + t);
  const rank = ['HR', 'MR'][t % 2];
  const keep = {};
  const keepIds = new Set();
  for (const p of E.PARTS) {
    const list = game.armors.filter(a => a.part === p && a.rank === rank);
    const chosen = [];
    while (chosen.length < 4) { const a = list[Math.floor(R() * list.length)]; if (!chosen.includes(a)) chosen.push(a); }
    keep[p] = chosen; chosen.forEach(a => keepIds.add(a.id));
  }
  const excludeArmor = game.armors.filter(a => !keepIds.has(a.id)).map(a => a.id);
  const finals = game.charms.filter(c => c.final && E.rankOfRarity(c.rarity) === rank);
  const charmKeep = [];
  while (charmKeep.length < 4) { const c = finals[Math.floor(R() * finals.length)]; if (!charmKeep.includes(c)) charmKeep.push(c); }
  // 護石の下の段階も外して、選んだものだけにする
  const excludeCharms = game.charms.filter(c => !charmKeep.includes(c)).map(c => c.id);
  const nsk = 1 + Math.floor(R() * 2);
  const skills = [];
  for (let i = 0; i < nsk; i++) { const n = skillPool[Math.floor(R() * skillPool.length)]; if (!skills.some(s => s.id === sk(n))) skills.push({ id: sk(n), lv: 1 + Math.floor(R() * 2) }); }
  // 武器も変えて、属性・砲術・飛燕の計算も総当たりと比べます
  const wlist = game.weapons.filter(w => w.rarity >= 11 && ['gunlance', 'dual-blades', 'insect-glaive', 'bow', 'great-sword', 'light-bowgun'].includes(w.type));
  const wpk = t % 3 === 2 ? null : wlist[Math.floor(R() * wlist.length)];
  const q = { weaponType: wpk ? wpk.type : 'great-sword', weaponId: wpk ? wpk.id : null, weaponSlots: [[3], [2, 1], [], [4, 1]][t % 4], ranks: [rank], objective: objectives[t % 4], skills, excludeArmor, excludeCharms, timeLimitMs: 60000, topK: 30 };
  const r = E.search(game, q);
  // 総当たり
  const P = E.prepare(game, q);
  let best = -Infinity, nFeas = 0;
  const charms = [null].concat(charmKeep);
  for (const h of keep.head) for (const c of keep.chest) for (const a of keep.arms) for (const w of keep.waist) for (const l of keep.legs) for (const ch of charms) {
    const b = E.finishBuild(P, [h, c, a, w, l].map(x => ({ a: x })), ch ? { a: ch } : null);
    if (b && !b.below) { nFeas++; if (b.score.total > best) best = b.score.total; }
  }
  const got = r.builds.length ? r.builds[0].score.total : -Infinity;
  ok(!r.stats.truncated, '例' + t + ' は打ち切らずに終わる');
  // 検索は、探している途中の装飾品の入れ方（effort 1）で全部の組み合わせを比べたときの最良を、必ず下回らない
  ok((nFeas === 0 && r.builds.length === 0) || got >= best - 1e-6, '例' + t + ' 最良の点数が総当たり以上（総当たり ' + best + '、検索 ' + got + '）');
  // 参考：最後に磨くときの入れ方（effort 3）で全部の組み合わせを比べた最良に、届いたかどうか
  if (nFeas && t < 6) { // 時間がかかるので、最初の 6 例だけ
    P.q.fillEffort = 3; P._solveCache = {};
    let best3 = -Infinity;
    for (const h of keep.head) for (const c of keep.chest) for (const a of keep.arms) for (const w of keep.waist) for (const l of keep.legs) for (const ch of charms) {
      const b = E.finishBuild(P, [h, c, a, w, l].map(x => ({ a: x })), ch ? { a: ch } : null);
      if (b && !b.below && b.score.total > best3) best3 = b.score.total;
    }
    refineStats.n++; if (got >= best3 - 1e-6) refineStats.hit++; else refineStats.miss.push('例' + t + '（' + got.toFixed(3) + ' / ' + best3.toFixed(3) + '）');
  }
  checkResult(r, q, '例' + t);
  if (t < 4 || Math.abs(best - got) >= 1e-6) console.log('  例' + t + ' ' + q.objective + ': 条件を満たす組み合わせ ' + nFeas + '、総当たりの最良 ' + (isFinite(best) ? best.toFixed(3) : 'なし') + '、検索の最良 ' + (isFinite(got) ? got.toFixed(3) : 'なし'));
}

console.log('  参考：磨き直しの入れ方で全部の組み合わせを比べた最良に、検索が届いた例 ' + refineStats.hit + ' / ' + refineStats.n + (refineStats.miss.length ? '（届かなかった例：' + refineStats.miss.join('、') + '）' : ''));

// ---- 5. あらかじめ作った案
const presetPath = path.join(__dirname, '..', 'data', 'presets.json');
if (fs.existsSync(presetPath)) {
  section('あらかじめ作った案（全部を検算する）');
  const presets = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  let n = 0;
  const types = new Set();
  for (const grp of presets.groups) {
    types.add(grp.weaponType);
    ok(grp.builds.length >= 3 && grp.builds.length <= 5, grp.weaponType + ' ' + grp.objective + ' ' + grp.access + ' の案が 3〜5 個');
    for (const b of grp.builds) {
      n++;
      const ev = E.evaluateBuild(game, b, grp.query);
      ok(!!ev, 'あらかじめ作った案を計算し直せる');
      const c = C.check(Object.assign({}, b, { levels: ev.levels, spare: ev.spare, bonuses: ev.bonuses }), grp.query.skills);
      ok(c.ok, grp.weaponType + ' ' + grp.objective + ': ' + c.errors.join(' / '));
      // 保存しているレベルとも一致
      const c2 = C.check(b, grp.query.skills);
      ok(c2.ok, grp.weaponType + ' 保存した中身: ' + c2.errors.join(' / '));
      ok(typeof b.reason === 'string' && b.reason.length > 10, '理由の文がある');
    }
  }
  ok(types.size === 14, '14 種類の武器がそろう（' + types.size + '）');
  console.log('  ' + n + ' 案を確かめました');
}

console.log('\n合格 ' + pass + '、失敗 ' + fail);
process.exit(fail ? 1 : 0);
