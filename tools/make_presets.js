/* あらかじめ作った順位付きの案を、検索プログラムを実際に動かして作ります。
 *   node tools/make_presets.js [秒数=25] [並列数=4]
 * 結果は data/presets_raw.json に書きます。理由の文は tools/finish_presets.js が付けます。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const E = require('../src/engine.js');
const ROOT = path.join(__dirname, '..');
const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'game.json'), 'utf8'));
const I = E.indexGame(game);
const sk = n => I.skillByEn[n].id;
const CRIT_BASE = (E.prepare(game, { ranks: ['LR'], maxRarity: 1 }), game._critBase);

const OBJ = ['fire', 'balance', 'comfort'];
// 入手のしやすさ（判断）：hard はすべて使う。easy は武器・防具・護石・装飾品のレア度 10 以下。
const ACCESS = { hard: { maxRarity: 12, decoMaxRarity: 12 }, easy: { maxRarity: 10, decoMaxRarity: 10 } };
// 目的ごとに外せないスキル（判断）。ガードで受ける武器の「守りとの両立」だけ、ガード性能 Lv3 を条件にします。
function required(type, obj) {
  if (obj === 'balance' && (type === 'lance' || type === 'gunlance')) return [{ id: sk('Guard'), lv: 3 }];
  return [];
}
function pickWeapon(type, maxRarity) {
  // 武器の基準の火力（スキルなしの期待値）が一番高いもの。同じなら スロットの合計が多いもの。
  let best = null, bestV = -1;
  for (const w of game.weapons) {
    if (w.type !== type || w.rarity > maxRarity || w.rarity < 9) continue;
    const wi = E.weaponInfo(game, { weaponId: w.id });
    const crit = CRIT_BASE;
    const v = wi.raw * (wi.aff >= 0 ? 1 + wi.aff / 100 * (crit - 1) : 1 + wi.aff / 100 * E.NEG_CRIT) + wi.elems.reduce((a, x) => a + x[1] / E.ELEM_DIV / wi.elems.length, 0);
    const sl = w.slots.reduce((a, b) => a + b, 0);
    if (v > bestV + 1e-9 || (Math.abs(v - bestV) < 1e-9 && sl > best.slots.reduce((a, b) => a + b, 0))) { best = w; bestV = v; }
  }
  return best;
}

function jobs() {
  const out = [];
  for (const type of E.WEAPON_TYPES) for (const obj of OBJ) for (const acc of Object.keys(ACCESS)) {
    const w = pickWeapon(type, ACCESS[acc].maxRarity);
    out.push({ type, obj, acc, query: Object.assign({ weaponId: w.id, weaponType: type, objective: obj, ranks: ['MR'], skills: required(type, obj) }, ACCESS[acc]) });
  }
  return out;
}

if (process.argv[2] === '--child') {
  process.on('message', (m) => {
    const q = Object.assign({}, m.query, { timeLimitMs: m.sec * 1000, topK: 80, resultCount: 5 });
    const r = E.search(game, q);
    process.send({ key: m.key, builds: r.builds.map(b => ({ armor: b.armor, charm: b.charm, weapon: b.weapon, weaponSlots: b.weaponSlots, decos: b.decos, levels: b.levels, spare: b.spare, bonuses: b.bonuses, total: b.score.total })), stats: r.stats });
  });
} else {
  const sec = +(process.argv[2] || 25), par = +(process.argv[3] || 4);
  const list = jobs();
  const results = {};
  let next = 0, done = 0;
  const t0 = Date.now();
  for (let k = 0; k < par; k++) {
    const ch = fork(__filename, ['--child']);
    const give = () => {
      if (next >= list.length) { ch.kill(); return; }
      const j = list[next++];
      ch.send({ key: j.type + '|' + j.obj + '|' + j.acc, query: j.query, sec });
    };
    ch.on('message', (m) => {
      results[m.key] = m; done++;
      console.log(done + '/' + list.length + ' ' + m.key + ' ' + m.builds.length + '案 打ち切り=' + m.stats.truncated + ' ' + Math.round((Date.now() - t0) / 1000) + '秒');
      if (done === list.length) {
        const outList = list.map(j => Object.assign({}, j, results[j.type + '|' + j.obj + '|' + j.acc]));
        fs.writeFileSync(path.join(ROOT, 'data', 'presets_raw.json'), JSON.stringify({ seconds: sec, jobs: outList }));
        console.log('書きました');
      }
      give();
    });
    give();
  }
}
