/* data/presets_raw.json（検索の結果）から data/presets.json（理由の文つき）を作ります。
 * 理由の文は、検索プログラムが計算した数だけを使って組み立てます。装備名や数値を手で書き足しません。
 *   node tools/finish_presets.js */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const ROOT = path.join(__dirname, '..');
const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'game.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'presets_raw.json'), 'utf8'));
const I = E.indexGame(game);
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const sj = id => I.skillById[id].ja;
const OBJ_JA = { fire: '火力', balance: '守りとの両立', comfort: '快適さ' };

// 目的ごとの説明（作者の判断。数値は書きません）
const OBJ_NOTE = {
  fire: '「火力」は火力点（スキルなしを 100 とした物理と属性の期待値）だけで順位を付けています。条件付きスキルは「点数の付け方」の表の割合で数えています。',
  balance: '「守りとの両立」は 火力点 ＋ 守り点 × 0.5 で順位を付けています。火力を少し下げても、体力・防御・耐性・生存スキルが大きく上がる案が上に来ます。',
  comfort: '「快適さ」は、余るスロットと便利スキル（回避距離・高速設置など）で順位を付けています。余るスロットには、あとから好きな装飾品を差せます。'
};

function keyOf(b) { return b.armor.join(',') + '|' + b.charm + '|' + b.weapon + '|' + b.decos.map(d => d.slot + ':' + d.deco).sort().join(','); }
function topSkills(b, n) {
  return Object.keys(b.levels).filter(k => b.levels[k] > 0)
    .map(k => ({ k, lv: b.levels[k], s: I.skillById[k] }))
    .sort((a, c) => c.lv - a.lv || a.k - c.k).slice(0, n).map(x => x.s.ja + x.lv).join('・');
}
function bonusText(b) {
  const a = (b.bonuses || []).filter(x => x.active.length).map(x => I.bonusById[x.id].ja + '（' + x.active.map(sj).join('・') + '）');
  return a.length ? 'シリーズスキルは ' + a.join('、') + ' が発動します。' : 'シリーズスキルは使っていません。';
}
function reasonFor(b, ev, first, q, accRank, access) {
  const w = I.weaponById[b.weapon];
  const parts = [];
  const sc = ev.score;
  const objLabel = OBJ_JA[q.objective];
  parts.push((access === 'easy' ? '入手しやすい装備だけで' : '入手が難しい装備も使って') + '、「' + objLabel + '」の合計が ' + (accRank === 1 ? '一番高かった' : accRank + ' 番目に高かった') + '案です（合計 ' + f1(sc.total) + '）。');
  parts.push('武器は ' + w.ja + '（スキルなしの期待値が条件の中で一番高い武器）。');
  parts.push('主なスキルは ' + topSkills(ev, 6) + '。');
  parts.push(bonusText(ev));
  if (q.objective === 'fire') parts.push('火力点 ' + f1(sc.fire) + '、会心率 ' + Math.round(sc.detail.affinity) + '%。');
  if (q.objective === 'balance') parts.push('火力点 ' + f1(sc.fire) + '、守り点 ' + f1(sc.def) + '（防御力 ' + Math.round(sc.detail.defense) + '、体力 +' + Math.round(sc.detail.health) + '）。');
  if (q.objective === 'comfort') parts.push('快適点 ' + f1(sc.comfort) + '、余るスロット ' + (ev.spare.length ? ev.spare.map(s => s.size).join('・') : 'なし') + '。');
  if (first && first !== ev) {
    let diff = 0; for (let i = 0; i < 5; i++) if (first.armor[i] !== ev.armor[i]) diff++;
    const d = [];
    if (first.weapon === ev.weapon) d.push('同じ武器の 1 位の案と防具が ' + diff + ' 部位違います');
    const dDef = ev.score.detail.defense - first.score.detail.defense;
    if (Math.abs(dDef) >= 5) d.push('防御力が ' + Math.abs(Math.round(dDef)) + (dDef > 0 ? ' 高い' : ' 低い'));
    const dSp = ev.score.comfort - first.score.comfort;
    if (Math.abs(dSp) >= 2) d.push('快適点が ' + f1(Math.abs(dSp)) + (dSp > 0 ? ' 高い' : ' 低い'));
    if (d.length) parts.push(d.join('、') + '。');
  }
  const nc = (sc.notCounted || []).map(sj);
  if (nc.length) parts.push('数値に入れていないスキル：' + nc.join('、') + '。');
  return parts.join('');
}

const groups = [];
for (const type of E.WEAPON_TYPES) for (const obj of ['fire', 'balance', 'comfort']) {
  const jh = raw.jobs.find(j => j.type === type && j.obj === obj && j.acc === 'hard');
  const je = raw.jobs.find(j => j.type === type && j.obj === obj && j.acc === 'easy');
  const builds = [];
  const seen = new Set();
  const take = (j, n, access) => {
    let r = 0, firstEv = null;
    for (const b of j.builds) {
      const ev = E.evaluateBuild(game, b, j.query);
      if (r === 0) firstEv = ev;
      r++;
      if (seen.has(keyOf(b)) || builds.filter(x => x.access === access).length >= n) continue;
      seen.add(keyOf(b));
      builds.push({ access, rankInAccess: r, query: j.query, weapon: b.weapon, weaponSlots: b.weaponSlots, armor: b.armor, charm: b.charm, decos: b.decos.map(d => ({ slot: d.slot, deco: d.deco })), levels: ev.levels, spare: ev.spare, bonuses: ev.bonuses, reason: reasonFor(b, ev, firstEv, j.query, r, access), truncated: j.stats.truncated });
    }
  };
  take(jh, 3, 'hard');
  take(je, 2, 'easy');
  const trunc = [jh, je].map(j => j.stats.truncated);
  const note = E.WEAPON_JA[type] + '・' + OBJ_JA[obj] + '：' + OBJ_NOTE[obj] +
    (jh.query.skills.length ? ' この組み合わせでは ' + jh.query.skills.map(x => sj(x.id) + ' Lv' + x.lv).join('、') + ' を必ず付ける条件にしました（ガードで受ける武器のため）。' : '') +
    ' 検索は 1 回 ' + raw.seconds + ' 秒で、' + (trunc[0] ? '入手が難しい案は時間切れで途中まで' : '入手が難しい案は最後まで') + '、' + (trunc[1] ? '入手しやすい案は時間切れで途中まで' : '入手しやすい案は最後まで') + '調べました。';
  groups.push({ weaponType: type, objective: obj, query: jh.query, note, builds });
}
fs.writeFileSync(path.join(ROOT, 'data', 'presets.json'), JSON.stringify({ seconds: raw.seconds, groups }));
console.log('groups ' + groups.length + ', builds ' + groups.reduce((a, g) => a + g.builds.length, 0));
