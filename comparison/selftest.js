/* compare.js の動作確認（本物のテンプレではありません）。v1.0 の案を「テンプレの形」に直して流し、
 * 名前の対応・装飾品の置き方・条件の切り替え・比べ方 A と B が動くことだけを確かめます。結果は報告に使いません。 */
'use strict';
const C = require('./compare.js');
const V = C.loadV10();
const { E, game, presets } = V;
const I = E.indexGame(game);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('失敗: ' + m); } };
const grp = presets.groups.find(g => g.weaponType === 'long-sword' && g.objective === 'fire');
const b = grp.builds.find(x => x.access === 'hard' && x.rankInAccess === 2) || grp.builds[1];
const counts = {}; b.decos.forEach(d => { const n = I.decoById[d.deco].ja; counts[n] = (counts[n] || 0) + 1; });
const ev = E.evaluateBuild(game, b, { objective: 'fire', weaponId: b.weapon });
const t = {
  id: 'selftest-1', weaponType: 'long-sword', purpose: '火力', url: '(自己試験)', fetchedAt: '-',
  weapon: I.weaponById[b.weapon].ja,
  armor: { head: I.armorById[b.armor[0]].ja, chest: I.armorById[b.armor[1]].ja, arms: I.armorById[b.armor[2]].ja, waist: I.armorById[b.armor[3]].ja, legs: I.armorById[b.armor[4]].ja },
  charm: b.charm != null ? I.charmById[b.charm].ja : null,
  decorations: Object.keys(counts).map(n => ({ name: n, count: counts[n] })),
  skills: Object.keys(ev.levels).filter(k => ev.levels[k] > 0).map(k => ({ name: I.skillById[k].ja, level: ev.levels[k] })),
};
const idx = C.buildNameIndex(game, []);
const r = C.compareOne(V, idx, t, 5, 5);
if (r.excluded) console.log('除外', r.reasons);
ok(!r.excluded, '自己試験のテンプレが除外されない（データに日本語名のない装備が入っていると除外されます）');
if (!r.excluded) {
  const c0 = r.conditions['v1.0初め'];
  ok(Math.abs(c0.template.total - ev.score.total) < 1e-6, 'テンプレの点数が v1.0 の点数と同じ');
  ok(c0.A && c0.B, '比べ方 A と B の結果がある');
  ok(c0.B.total >= c0.template.total - 1e-6 || r.bTruncated, '同じスキルを条件にした検索は、テンプレ以上の点数（打ち切りがなければ）');
  const totals = Object.values(r.conditions).map(x => x.template.total.toFixed(3));
  ok(new Set(totals).size > 1, '条件を変えると点数が変わる（' + totals.join(', ') + '）');
  ok(r.skillMismatch.length === 0, 'スキルの食い違いがない: ' + r.skillMismatch.join(' / '));
  console.log('条件ごとのテンプレの点数:', totals.join(' / '), 'A:', Object.values(r.conditions).map(x => x.A.result).join(' / '), 'B:', Object.values(r.conditions).map(x => x.B.result).join(' / '));
}
// 名前のない装備は除外される
const bad = Object.assign({}, t, { id: 'selftest-2', armor: Object.assign({}, t.armor, { head: 'そんな防具はない' }) });
const r2 = C.compareOne(V, idx, bad, 1, 1);
ok(r2.excluded && /頭/.test(r2.reasons.join('')), '対応しない名前の装備は理由つきで除外される');
// v1.0 の割合の表が元に戻っている
ok(E.UPTIME['Weakness Exploit'] === 0.8 && E.UPTIME['Heroics'] === 0, 'v1.0 の割合の表が元に戻る');
console.log(fail ? '失敗 ' + fail : '自己試験 合格');
process.exit(fail ? 1 : 0);
