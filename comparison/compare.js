/* 攻略サイトのテンプレ装備と、v1.0 の案を比べるプログラム（comparison/PLAN.md の手順どおり）。
 *
 *   node comparison/compare.js [テンプレのファイル=comparison/templates.json] [比べ方 A の秒数=60] [比べ方 B の秒数=120]
 *
 * - 計算はすべて v1.0（commit 3021806）のプログラムとデータで行います。v1.0 は git worktree で
 *   /home/user/mhw-v1.0 に取り出したものを読み込みます（環境変数 MHW_V10 で場所を変えられます）。
 * - v1.0 のファイルは変えません。条件を振るときは、読み込んだ v1.0 のプログラムの「条件付きスキルの割合の表」を、
 *   計算のあいだだけ書きかえ、終わったら元に戻します。
 * - 結果は comparison/results.json に書きます。報告の表は comparison/report_tables.js が作ります。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V10_COMMIT = '3021806d351d7cf4cef63c6740aad03fe23bd0da';
const V10 = process.env.MHW_V10 || '/home/user/mhw-v1.0';

function ensureV10() {
  if (!fs.existsSync(path.join(V10, 'src', 'engine.js'))) {
    execSync('git worktree add -f ' + JSON.stringify(V10) + ' ' + V10_COMMIT, { cwd: ROOT, stdio: 'inherit' });
  }
  const head = execSync('git rev-parse HEAD', { cwd: V10 }).toString().trim();
  if (head !== V10_COMMIT) throw new Error('v1.0 の取り出し先の版が違います: ' + head);
  const dirty = execSync('git status --porcelain', { cwd: V10 }).toString().trim();
  if (dirty) throw new Error('v1.0 の取り出し先に変更があります: ' + dirty);
}

function loadV10() {
  ensureV10();
  const E = require(path.join(V10, 'src', 'engine.js'));
  const game = JSON.parse(fs.readFileSync(path.join(V10, 'data', 'game.json'), 'utf8'));
  const presets = JSON.parse(fs.readFileSync(path.join(V10, 'data', 'presets.json'), 'utf8'));
  E.indexGame(game);
  E.prepare(game, { ranks: ['LR'], maxRarity: 1 });
  return { E, game, presets };
}

/* ---------- 名前の対応 ---------- */
// 表記ゆれ（全角・半角、空白、記号）をそろえます。名前の中身は変えません。
function normName(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/[【】\[\]]/g, '').replace(/[＋+]/g, '+').toLowerCase();
}
function buildNameIndex(game, extra) {
  const idx = { armor: new Map(), weapon: new Map(), deco: new Map(), charm: new Map(), skill: new Map() };
  const add = (m, name, obj) => { const k = normName(name); if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(obj)) m.get(k).push(obj); };
  game.armors.forEach(a => { add(idx.armor, a.ja, a); });
  game.weapons.forEach(w => { add(idx.weapon, w.ja, w); });
  game.decos.forEach(d => { add(idx.deco, d.ja, d); });
  game.charms.forEach(c => { add(idx.charm, c.ja, c); });
  game.skills.forEach(s => { add(idx.skill, s.ja, s); });
  // データに日本語名がない名前は、調べた対応表（出典つき）で引けるようにします
  for (const x of (extra || [])) {
    const kind = { armor: 'armor', weapon: 'weapon', decoration: 'deco', charm: 'charm', skill: 'skill' }[x.kind];
    if (!kind || !x.name_ja) continue;
    const list = kind === 'armor' ? game.armors : kind === 'weapon' ? game.weapons : kind === 'deco' ? game.decos : kind === 'charm' ? game.charms : game.skills;
    const obj = list.find(o => o.en.replace(/\s+/g, ' ').trim() === x.name_en.replace(/\s+/g, ' ').trim());
    if (obj) add(idx[kind], x.name_ja, obj);
  }
  return idx;
}
function lookup(idx, kind, name, filter) {
  let list = idx[kind].get(normName(name)) || [];
  if (filter) list = list.filter(filter);
  if (list.length === 1) return { ok: list[0] };
  if (list.length === 0) return { err: 'データに対応する名前がありません: ' + name };
  // 上位とマスターランクで同じ日本語名の物があるときは、計画どおりマスターランク（レア度 9 以上）の物にします
  if (list.every(x => x.rarity != null)) {
    const mr = list.filter(x => x.rarity >= 9);
    if (mr.length === 1) return { ok: mr[0] };
  }
  return { err: '同じ名前が複数あります: ' + name };
}

/* ---------- 条件を振る ---------- */
// cond: { weak: 0〜1, active: 0〜1 } または null（v1.0 の初めの設定）
function withCondition(E, game, cond, fn) {
  const saved = Object.assign({}, E.UPTIME);
  try {
    if (cond) {
      game.skills.forEach(s => {
        const c = (s.levels.map(l => l.eff && l.eff.cond).filter(Boolean))[0];
        if (c === 'weak') E.UPTIME[s.en] = cond.weak;
        else if (c === 'active') E.UPTIME[s.en] = cond.active;
      });
    }
    return fn(cond ? { uptimeScale: 1 } : {});
  } finally {
    Object.keys(E.UPTIME).forEach(k => { delete E.UPTIME[k]; });
    Object.assign(E.UPTIME, saved);
  }
}
const CONDITIONS = [
  { id: 'v1.0初め', cond: null },
  { id: '弱点100%・条件100%', cond: { weak: 1, active: 1 } },
  { id: '弱点100%・条件50%', cond: { weak: 1, active: 0.5 } },
  { id: '弱点50%・条件100%', cond: { weak: 0.5, active: 1 } },
  { id: '弱点50%・条件50%', cond: { weak: 0.5, active: 0.5 } },
];

/* ---------- テンプレ装備を、データの装備に直す ---------- */
const PART_KEYS = ['head', 'chest', 'arms', 'waist', 'legs'];
function resolveTemplate(V, idx, t) {
  const { E, game } = V;
  const reasons = [];
  if (t.requiresAugment) reasons.push('データにない強化（カスタム強化や覚醒）が前提です: ' + t.requiresAugment);
  const w = lookup(idx, 'weapon', t.weapon, x => x.type === t.weaponType);
  if (w.err) reasons.push('武器: ' + w.err);
  const armor = [];
  PART_KEYS.forEach(p => {
    const a = lookup(idx, 'armor', t.armor && t.armor[p], x => x.part === p);
    if (a.err) reasons.push(E.PART_JA[p] + ': ' + a.err); else armor.push(a.ok);
  });
  let charm = null;
  if (t.charm) { const c = lookup(idx, 'charm', t.charm); if (c.err) reasons.push('護石: ' + c.err); else charm = c.ok; }
  const decos = [];
  (t.decorations || []).forEach(d => {
    const r = lookup(idx, 'deco', d.name);
    if (r.err) reasons.push('装飾品: ' + r.err); else for (let i = 0; i < (d.count || 1); i++) decos.push(r.ok);
  });
  const skills = [];
  (t.skills || []).forEach(s => {
    const r = lookup(idx, 'skill', s.name);
    if (r.err) reasons.push('スキル: ' + r.err); else skills.push({ id: r.ok.id, lv: s.level, name: r.ok.ja });
  });
  if (reasons.length) return { excluded: true, reasons };
  // 装飾品をスロットに置く（大きい装飾品から、入る一番小さいスロットへ）
  const slots = [];
  w.ok.slots.forEach((s, j) => slots.push({ ref: 'weapon#' + j, size: s }));
  armor.forEach(a => a.slots.forEach((s, j) => slots.push({ ref: a.part + '#' + j, size: s })));
  slots.sort((a, b) => a.size - b.size);
  const placed = [];
  for (const d of decos.slice().sort((a, b) => b.size - a.size)) {
    const j = slots.findIndex(s => s.size >= d.size);
    if (j < 0) return { excluded: true, reasons: ['装飾品がデータの防具・武器のスロットに入りきりません（' + d.ja + '）。データにない強化が前提だと考えて除きます'] };
    placed.push({ slot: slots[j].ref, deco: d.id });
    slots.splice(j, 1);
  }
  const spec = { weapon: w.ok.id, weaponSlots: w.ok.slots, armor: armor.map(a => a.id), charm: charm ? charm.id : null, decos: placed };
  return { excluded: false, spec, siteSkills: skills, weapon: w.ok };
}

function objectiveOf(t) { return { '火力': 'fire', '不明': 'fire', '汎用': 'balance', '快適': 'comfort' }[t.purpose] || 'fire'; }

function access(V, b) {
  const I = V.E.indexGame(V.game);
  const ar = b.armor.map(id => I.armorById[id]);
  return {
    maxArmorRarity: Math.max.apply(null, ar.map(a => a.rarity)),
    rarity12Armor: ar.filter(a => a.rarity === 12).length,
    decoRarity12: b.decos.filter(d => I.decoById[d.deco].rarity >= 12).length,
    weaponRarity: b.weapon != null ? I.weaponById[b.weapon].rarity : null,
  };
}
function summarize(V, b) {
  const I = V.E.indexGame(V.game);
  return {
    total: b.score.total, fire: b.score.fire, def: b.score.def, comfort: b.score.comfort,
    phys: b.score.detail.phys, elem: b.score.detail.elem, defense: b.score.detail.defense,
    notCounted: (b.score.notCounted || []).map(k => I.skillById[k].ja),
    skills: Object.keys(b.levels).filter(k => b.levels[k] > 0).map(k => I.skillById[k].ja + b.levels[k]),
  };
}
function verdict(ours, theirs) {
  const d = (ours - theirs) / Math.abs(theirs);
  return { diff: d, result: Math.abs(d) < 0.01 ? '引き分け' : (d > 0 ? 'このサイトの計算では上' : 'このサイトの計算では下') };
}

function compareOne(V, idx, t, secA, secB) {
  const { E, game, presets } = V;
  const r = resolveTemplate(V, idx, t);
  if (r.excluded) return { id: t.id, excluded: true, reasons: r.reasons };
  const objective = objectiveOf(t);
  const tq = { objective, weaponId: r.spec.weapon };
  // 比べ方 A：v1.0 の案（入手が難しい装備も使う案の 1 位）
  const grp = presets.groups.find(gp => gp.weaponType === t.weaponType && gp.objective === objective);
  const pre = grp && grp.builds.find(b => b.access === 'hard' && b.rankInAccess === 1) || (grp && grp.builds.find(b => b.access === 'hard'));
  const out = { id: t.id, weaponType: t.weaponType, objective, url: t.url, fetchedAt: t.fetchedAt, excluded: false, conditions: {} };
  // 装飾品の差し直し（テンプレの武器にそろえる）は v1.0 の初めの設定で 1 回だけ行います
  let presetOnTemplateWeapon = null;
  if (pre) {
    const I = E.indexGame(game);
    const nextOf = {}; game.charms.forEach(c => { if (c.prev != null) nextOf[c.prev] = c.id; });
    const res = E.search(game, {
      weaponId: r.spec.weapon, weaponType: t.weaponType, objective, ranks: ['MR'],
      fixedArmor: { head: pre.armor[0], chest: pre.armor[1], arms: pre.armor[2], waist: pre.armor[3], legs: pre.armor[4] },
      excludeCharms: game.charms.filter(c => c.id !== pre.charm).map(c => c.id),
      timeLimitMs: secA * 1000, resultCount: 1,
    });
    presetOnTemplateWeapon = res.builds[0] ? { armor: res.builds[0].armor, charm: res.builds[0].charm, weapon: res.builds[0].weapon, weaponSlots: res.builds[0].weaponSlots, decos: res.builds[0].decos.map(d => ({ slot: d.slot, deco: d.deco })) } : null;
    out.presetA = { weapon: pre.weapon, armor: pre.armor, charm: pre.charm, decos: pre.decos, truncated: res.stats.truncated };
  }
  // 比べ方 B：テンプレのスキルを条件にして v1.0 で探す
  const tb = E.evaluateBuild(game, r.spec, tq);
  const req = r.siteSkills.map(s => ({ id: s.id, lv: Math.min(s.lv, tb.levels[s.id] || 0) })).filter(s => s.lv > 0);
  const mism = r.siteSkills.filter(s => (tb.levels[s.id] || 0) !== s.lv).map(s => s.name + '（サイト ' + s.lv + '、計算 ' + (tb.levels[s.id] || 0) + '）');
  out.skillMismatch = mism;
  const resB = E.search(game, { weaponId: r.spec.weapon, weaponType: t.weaponType, objective, ranks: ['MR'], skills: req, timeLimitMs: secB * 1000, resultCount: 1 });
  const bestB = resB.builds[0] ? { armor: resB.builds[0].armor, charm: resB.builds[0].charm, weapon: resB.builds[0].weapon, weaponSlots: resB.builds[0].weaponSlots, decos: resB.builds[0].decos.map(d => ({ slot: d.slot, deco: d.deco })) } : null;
  out.bTruncated = resB.stats.truncated;
  out.requiredB = req.map(s => E.indexGame(game).skillById[s.id].ja + s.lv);
  for (const c of CONDITIONS) {
    const row = withCondition(E, game, c.cond, (extra) => {
      const q = Object.assign({}, tq, extra);
      const T = E.evaluateBuild(game, r.spec, q);
      const row = { template: summarize(V, T) };
      if (presetOnTemplateWeapon) {
        const A = E.evaluateBuild(game, presetOnTemplateWeapon, q);
        row.A = Object.assign(summarize(V, A), verdict(A.score.total, T.score.total));
        const A0 = E.evaluateBuild(game, out.presetA, Object.assign({}, q, { weaponId: out.presetA.weapon }));
        row.A_ownWeapon = summarize(V, A0);
      }
      if (bestB) { const B = E.evaluateBuild(game, bestB, q); row.B = Object.assign(summarize(V, B), verdict(B.score.total, T.score.total)); }
      return row;
    });
    out.conditions[c.id] = row;
  }
  out.access = { template: access(V, Object.assign({}, r.spec)), A: presetOnTemplateWeapon ? access(V, presetOnTemplateWeapon) : null, B: bestB ? access(V, bestB) : null };
  out.builds = { template: r.spec, A: presetOnTemplateWeapon, B: bestB };
  return out;
}

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, 'templates.json');
  const secA = +(process.argv[3] || 60), secB = +(process.argv[4] || 120);
  const V = loadV10();
  const T = JSON.parse(fs.readFileSync(file, 'utf8'));
  const extraPath = path.join(ROOT, 'data', 'ja_names_extra.json');
  const extra = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, 'utf8')).names : [];
  const idx = buildNameIndex(V.game, extra);
  const results = T.templates.map(t => { const r = compareOne(V, idx, t, secA, secB); console.log(t.id, r.excluded ? '除外: ' + r.reasons.join(' / ') : 'A ' + (r.conditions['v1.0初め'].A ? r.conditions['v1.0初め'].A.result : 'なし') + '、B ' + (r.conditions['v1.0初め'].B ? r.conditions['v1.0初め'].B.result : 'なし')); return r; });
  const out = { v10: V10_COMMIT, templatesFile: path.relative(ROOT, file), site: T.site, results };
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
  console.log('comparison/results.json に書きました');
}

module.exports = { loadV10, buildNameIndex, resolveTemplate, compareOne, withCondition, CONDITIONS, normName, verdict };
