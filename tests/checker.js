/* 採点プログラム（検算用）。src/engine.js を一切読まずに、data/game.json だけから
 * 案のスキル・スロット・シリーズスキル・防御力を計算し直します。 */
'use strict';

function makeChecker(game) {
  const skill = new Map(game.skills.map(s => [s.id, s]));
  const armor = new Map(game.armors.map(a => [a.id, a]));
  const deco = new Map(game.decos.map(d => [d.id, d]));
  const charm = new Map(game.charms.map(c => [c.id, c]));
  const weapon = new Map(game.weapons.map(w => [w.id, w]));
  const set = new Map(game.sets.map(s => [s.id, s]));
  const bonus = new Map(game.bonuses.map(b => [b.id, b]));
  const PARTS = ['head', 'chest', 'arms', 'waist', 'legs'];
  const inh = game.skills.find(s => s.en === 'Inheritance');
  const inheritId = inh ? inh.id : null;

  // build: {armor:[5 ids], charm, weapon, weaponSlots, decos:[{slot, deco}]}
  function recompute(build) {
    const errors = [];
    const points = {};
    const addPts = (id, n) => { points[id] = (points[id] || 0) + n; };
    const slots = {}; // ref -> size
    let defense = 0;
    const res = [0, 0, 0, 0, 0];
    const bonusCount = {};
    if (!Array.isArray(build.armor) || build.armor.length !== 5) errors.push('防具が 5 部位ありません');
    build.armor.forEach((id, i) => {
      const a = armor.get(id);
      if (!a) { errors.push('防具 ' + id + ' がデータにありません'); return; }
      if (a.part !== PARTS[i]) errors.push(a.ja + ' は ' + PARTS[i] + ' の防具ではありません');
      for (const [s, n] of a.skills) addPts(s, n);
      a.slots.forEach((sz, j) => { slots[a.part + '#' + j] = sz; });
      defense += a.def[1];
      a.res.forEach((r, j) => { res[j] += r; });
      if (a.set != null) {
        const st = set.get(a.set);
        if (st && st.bonus != null) bonusCount[st.bonus] = (bonusCount[st.bonus] || 0) + 1;
      }
    });
    if (build.charm != null) {
      const c = charm.get(build.charm);
      if (!c) errors.push('護石 ' + build.charm + ' がデータにありません');
      else for (const [s, n] of c.skills) addPts(s, n);
    }
    let wslots = build.weaponSlots || [];
    if (build.weapon != null) {
      const w = weapon.get(build.weapon);
      if (!w) errors.push('武器 ' + build.weapon + ' がデータにありません');
      else {
        wslots = w.slots;
        for (const [s, n] of w.skills) addPts(s, n);
        if (w.bonus != null) bonusCount[w.bonus] = (bonusCount[w.bonus] || 0) + 1;
        defense += w.defense;
      }
    }
    wslots.forEach((sz, j) => { slots['weapon#' + j] = sz; });
    const used = new Set();
    for (const x of build.decos) {
      const d = deco.get(x.deco);
      if (!d) { errors.push('装飾品 ' + x.deco + ' がデータにありません'); continue; }
      if (!(x.slot in slots)) { errors.push('スロット ' + x.slot + ' がありません'); continue; }
      if (used.has(x.slot)) errors.push('スロット ' + x.slot + ' に 2 つ差しています');
      used.add(x.slot);
      if (d.size > slots[x.slot]) errors.push(d.ja + '（大きさ ' + d.size + '）は大きさ ' + slots[x.slot] + ' のスロットに入りません');
      for (const [s, n] of d.skills) addPts(s, n);
    }
    const activeBonus = [];
    for (const b in bonusCount) {
      for (const [s, req] of bonus.get(+b).skills) {
        if (bonusCount[b] >= req) { addPts(s, 1); activeBonus.push(s); }
      }
    }
    const levels = {};
    for (const id in points) {
      const s = skill.get(+id);
      // 極意スキル、または Inheritance（skill_levels の英語の説明: Removes the skill level cap for the skill secrets.）で上限が上がる
      const unlocked = s.unlockedBy != null && ((points[s.unlockedBy] || 0) > 0 || (inheritId != null && (points[inheritId] || 0) > 0));
      const cap = unlocked ? s.levels.length : s.levels.length - s.secret;
      levels[id] = Math.min(points[id], cap);
    }
    const spare = Object.keys(slots).filter(r => !used.has(r)).map(r => slots[r]).sort((a, b) => b - a);
    return { errors, points, levels, spare, defenseBase: defense, res, bonusCount, activeBonus };
  }

  // 検索プログラムの答えと突き合わせます
  function check(build, required) {
    const r = recompute(build);
    const errs = r.errors.slice();
    const lvA = {}, lvB = {};
    for (const k in r.levels) if (r.levels[k] > 0) lvA[k] = r.levels[k];
    for (const k in build.levels || {}) if (build.levels[k] > 0) lvB[k] = build.levels[k];
    const keys = new Set([...Object.keys(lvA), ...Object.keys(lvB)]);
    for (const k of keys) if (lvA[k] !== lvB[k]) errs.push('スキル ' + skill.get(+k).ja + ' のレベルが違います（検算 ' + lvA[k] + '、検索 ' + lvB[k] + '）');
    if (build.spare) {
      const sp = build.spare.map(s => s.size).sort((a, b) => b - a).join(',');
      if (sp !== r.spare.join(',')) errs.push('余りスロットが違います（検算 ' + r.spare.join(',') + '、検索 ' + sp + '）');
    }
    if (build.bonuses) {
      const a = Object.keys(r.bonusCount).map(b => b + ':' + r.bonusCount[b]).sort().join(' ');
      const b = build.bonuses.map(x => x.id + ':' + x.count).sort().join(' ');
      if (a !== b) errs.push('シリーズスキルの部位数が違います（検算 ' + a + '、検索 ' + b + '）');
    }
    for (const q of required || []) {
      if ((r.levels[q.id] || 0) < q.lv) errs.push('条件の ' + skill.get(q.id).ja + ' Lv' + q.lv + ' に足りません（' + (r.levels[q.id] || 0) + '）');
    }
    return { ok: errs.length === 0, errors: errs, recomputed: r };
  }
  return { recompute, check };
}

module.exports = { makeChecker };
