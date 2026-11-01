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
  for (const b of r.builds) ok((b.levels[sk('Agitator Secret')] || 0) >= 1, '挑戦者 Lv7 の案に挑戦者・極意がある');
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

// ---- 4. 小さな例で総当たりと比べる
section('小さな例で総当たりと比べる');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const objectives = ['fire', 'defense', 'comfort', 'balance'];
const skillPool = ['Attack Boost', 'Critical Eye', 'Weakness Exploit', 'Health Boost', 'Evade Window', 'Critical Boost', 'Agitator', 'Divine Blessing', 'Earplugs', 'Guard'];
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
  const q = { weaponType: 'great-sword', weaponSlots: [[3], [2, 1], [], [4, 1]][t % 4], ranks: [rank], objective: objectives[t % 4], skills, excludeArmor, excludeCharms, timeLimitMs: 60000, topK: 30 };
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
  ok((nFeas === 0 && r.builds.length === 0) || Math.abs(best - got) < 1e-6, '例' + t + ' 最良の点数が総当たりと同じ（総当たり ' + best + '、検索 ' + got + '）');
  checkResult(r, q, '例' + t);
  if (t < 4 || Math.abs(best - got) >= 1e-6) console.log('  例' + t + ' ' + q.objective + ': 条件を満たす組み合わせ ' + nFeas + '、総当たりの最良 ' + (isFinite(best) ? best.toFixed(3) : 'なし') + '、検索の最良 ' + (isFinite(got) ? got.toFixed(3) : 'なし'));
}

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
