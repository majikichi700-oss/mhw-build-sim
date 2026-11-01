/* dist/index.html を作ります。外部の読み込みはなく、1 つのファイルにすべてを入れます。
 *   node tools/build_html.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require('../src/engine.js');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const game = JSON.parse(read('data/game.json'));
const report = JSON.parse(read('data/report.json'));
const presetsPath = path.join(ROOT, 'data', 'presets.json');
const presets = fs.existsSync(presetsPath) ? JSON.parse(fs.readFileSync(presetsPath, 'utf8')) : { groups: [] };
const I = E.indexGame(game);
E.prepare(game, { ranks: ['LR'], maxRarity: 1 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ja = en => (I.skillByEn[en] ? I.skillByEn[en].ja : en);

function howto() {
  const up = Object.keys(E.UPTIME).map(k => '<tr><td>' + esc(ja(k)) + '</td><td>' + E.UPTIME[k] + '</td><td>' + esc(I.skillByEn[k].desc.replace(/\s+/g, '')) + '</td></tr>').join('');
  const bloat = E.WEAPON_TYPES.map(t => '<tr><td>' + E.WEAPON_JA[t] + '</td><td>' + E.WEAPON_BLOAT[t] + '</td></tr>').join('');
  const parsed = game.skills.filter(s => s.levels.some(l => l.eff)).map(s => {
    const lv = s.levels.map(l => {
      const e = l.eff; if (!e) return 'Lv' + l.lv + ' なし';
      const p = [];
      if (e.atk) p.push('攻撃+' + e.atk); if (e.atkMul) p.push('攻撃×' + e.atkMul); if (e.aff) p.push('会心+' + e.aff + '%');
      if (e.critMul) p.push('会心倍率' + e.critMul);
      if (e.elemAdd) for (const k in e.elemAdd) p.push(E.ELEM_JA[k] + '+' + e.elemAdd[k]);
      if (e.elemMul) for (const k in e.elemMul) p.push(E.ELEM_JA[k] + '×' + e.elemMul[k]);
      if (e.elemAddAll) p.push('属性+' + e.elemAddAll);
      if (e.def) p.push('防御+' + e.def); if (e.defMul) p.push('防御×' + e.defMul); if (e.resAll) p.push('全耐性+' + e.resAll);
      if (e.res) for (const k in e.res) p.push(E.ELEM_JA[k] + '耐性+' + e.res[k]);
      if (e.resMul) p.push('耐性×' + e.resMul); if (e.health) p.push('体力+' + e.health); if (e.dmgCut) p.push('軽減' + e.dmgCut + '%');
      return 'Lv' + l.lv + ' ' + p.join('・');
    }).join('、');
    const cond = s.levels.map(l => l.eff && l.eff.cond).filter(Boolean)[0];
    const cj = { weak: '有効部位', active: '条件付き', draw: '武器出し攻撃だけ（数えない）', faint: '力尽きたとき（数えない）' }[cond] || '常に';
    return '<tr><td>' + esc(s.ja) + '</td><td>' + cj + '</td><td>' + esc(lv) + '</td></tr>';
  }).join('');
  const W = E.W;
  return `
<p>案ごとに「火力点」「守り点」「快適点」の 3 つを計算し、目的に合わせて足し合わせた「合計」で順位を付けます。重みは作者（Claude）の判断で決めたもので、ゲームの公式な数ではありません。</p>
<table><tr><th>目的</th><th>合計の出し方</th></tr>
<tr><td>火力</td><td>火力点</td></tr><tr><td>守りとの両立</td><td>火力点 ＋ 守り点 × ${W.balanceDef}</td></tr><tr><td>守り</td><td>守り点</td></tr><tr><td>快適さ</td><td>快適点</td></tr></table>
<h3>火力点</h3>
<p>スキルが何もないときの期待値を 100 として、スキル込みの期待値（物理期待値 ＋ 属性期待値）が何倍になるかを表します。</p>
<ul>
<li>物理期待値 ＝（武器の基礎攻撃力 ＋ スキルで足す攻撃力）× スキルの攻撃の倍率 × 会心の補正</li>
<li>会心の補正 ＝ 1 ＋ 会心率 ×（会心の倍率 − 1）。会心率がマイナスのときは 1 ＋ 会心率 × ${E.NEG_CRIT}。会心率は −100% から 100% の間で切ります。</li>
<li>属性期待値 ＝（武器の属性値 × スキルの倍率 ＋ スキルで足す属性値）÷ ${E.ELEM_DIV}。属性が 2 つある武器は平均です。隠し属性と、毒・麻痺・睡眠・爆破は数えません。</li>
<li>スキルの数値は、すべて <code>skill_levels.csv</code> の日本語の説明文（description_ja）から読み取りました。読み取れたものは下の表のとおりです。数値が読めないスキル（たとえば 匠、会心撃【属性】、無属性強化）は点数に入れず、案ごとに「数値に入れていないスキル」として表示します。</li>
</ul>
<h3>条件付きスキルを数える割合（判断）</h3>
<p>説明文に「発動中」などの条件があるスキルは、効果に次の割合をかけて数えます。割合は、スキルの説明（skill_base の description_ja）に書かれた条件から作者が決めました。「くわしい条件」で、全体を 0 倍・0.5 倍・1.5 倍に変えられます（1 を超える分は 1 にします）。表にない条件付きスキルは 0.5 です。</p>
<table><tr><th>スキル</th><th>割合</th><th>データの説明文</th></tr>${up}</table>
<p>攻めの守勢は、ガードできる武器（大剣・片手剣・ランス・ガンランス・チャージアックス）のときだけ数えます。</p>
<h3>データにない前提の数</h3>
<ul>
<li>会心の基本倍率：${game._critBase}。データにはありません。超会心の Lv1（1.3 倍）と Lv2（1.35 倍）の差を Lv1 から引いて求めました。</li>
<li>マイナス会心で減る割合：${E.NEG_CRIT}。データにないため、作者が前提として置いた数です。</li>
<li>属性値を ${E.ELEM_DIV} で割ること：物理と属性を足すための作者の判断です。モンスターの肉質（部位ごとの効きやすさ）は入れていません。</li>
<li>武器倍率：データの攻撃力は表示の値です。スキルの「基礎攻撃力＋3」と同じ単位にするため、次の数で割ります。データからは一つに決まらない（表示攻撃力を割り切れる数が複数ある）ため、割り切れる候補の中から、作者が知っている値を選びました。データだけで決めた数ではないので、ご注意ください。</li>
</ul>
<table><tr><th>武器</th><th>割る数</th></tr>${bloat}</table>
<h3>守り点</h3>
<p>守り点 ＝（防御力 ＋ 耐性の合計 × ${W.resPt} ＋ 体力の増加 × ${W.healthPt} ＋ 生存スキルのレベルの合計 × ${W.surv} ＋ ダメージ軽減% × ${W.cutPt}）÷ ${W.defDiv}</p>
<p>防御力は、防具の強化を最大にした値（<code>defense_max</code>）に、武器の防御ボーナスと、防御・各耐性スキルの数値を足したものです。生存スキル：${esc(E.SURVIVAL.map(ja).join('、'))}</p>
<h3>快適点</h3>
<p>快適点 ＝ 余るスロット（大きさ 1 は ${W.spare[1]} 点、2 は ${W.spare[2]} 点、3 は ${W.spare[3]} 点、4 は ${W.spare[4]} 点）＋ 便利スキルのレベルの合計 × ${W.comfortLv}</p>
<p>便利スキル：${esc(E.COMFORT.map(ja).join('、'))}</p>
<h3>装飾品の入れ方</h3>
<p>まず条件のスキルに足りない分を、余るスロットができるだけ大きく残るように選びます。残ったスロットには、大きいスロットから順に、目的の合計が一番上がる装飾品を 1 つずつ入れます（上がらなければ空けたままにします）。</p>
<h3>探し方</h3>
<ul>
<li>部位ごとに、ほかの防具より「スキルもスロットも防御も上回らない」防具を候補から外します（支配される防具）。さらに、ほかの防具のスロットに装飾品を差すとそのスキルを作れて、しかも同じ大きさ以上のスロットが残る防具も外します。どちらも、外しても一番良い案は変わりません。</li>
<li>候補を良さそうな順に並べ、各部位の上位 2 個、3 個、4 個…と少しずつ広げながら全部の組み合わせを調べます。途中で「この先どう選んでも条件を満たせない」「この先どう選んでもいまの上位の点数に届かない」とわかった枝は切ります。</li>
<li>決めた時間で終わらないときは、そこで止めて、何段まで調べたかを表示します。最後の段まで終われば、全部の組み合わせを調べたのと同じ結果になります（小さな例で総当たりと同じになることを自動の試験で確かめています）。</li>
<li>似た案ばかりにならないよう、上位の案のうち、すでに選んだ案と防具が 2 部位以上違う案を先に並べます。</li>
</ul>
<details><summary>説明文から読み取ったスキルの数値（${game.skills.filter(s => s.levels.some(l => l.eff)).length} 個）</summary><table><tr><th>スキル</th><th>条件</th><th>読み取った数値</th></tr>${parsed}</table></details>`;
}

function unsupported() {
  return `<ul>
<li>防具のカスタム強化と、武器のカスタム強化（データに中身がないため）。防御力は、強化を最大にしたときの値で計算します。</li>
<li>覚醒武器（赤龍の武器など）の覚醒能力、ムフェト・ジーヴァの武器の追加能力（データにないため）。</li>
<li>斬れ味（匠などの効果を含む）、モーション値（技ごとの威力）、モンスターの肉質、属性値の上限、弾やビンの種類、狩猟笛の旋律、猟虫。火力点には入っていません。</li>
<li>「会心撃【属性】」「無属性強化」「抜刀術【力】」「龍脈覚醒」「属性変換」などの、説明文に数値がないスキルの火力（スキルの付け外しはできます）。「伝説の継承」「真・伝説の継承」（Inheritance・Transcendance）はデータに説明文がありません。</li>
<li>「不屈」（力尽きた回数で変わる）と「抜刀術【技】」（武器出し攻撃だけ）は火力点に数えません。</li>
<li>装飾品を持っている個数。持っていない装飾品を指定することはできますが、「1 個だけ持っている」は扱えません。</li>
<li>重ね着、性別ごとの見た目、モンスターごとの弱点。</li>
<li>武器のデータの「skill」列にシリーズスキルの名前（例：Kulve Taroth Essence）がある武器は、そのシリーズの 1 部位として数えます。これはデータの書き方から作者が判断したものです。</li>
<li>日本語の翻訳がデータにない装備（${report.missing_ja.length} 件）は、英語の名前のまま表示します。一覧は「データについて」にあります。</li>
</ul>`;
}

function dataSec() {
  const rows = Object.keys(report.rows).sort().map(k => '<tr><td>' + esc(k) + '</td><td>' + report.rows[k] + '</td></tr>').join('');
  const byKind = {};
  report.missing_ja.forEach(x => { (byKind[x.kind] = byKind[x.kind] || []).push(x.name_en); });
  const kindJa = { armor: '防具', weapon: '武器', charm: '護石', skill: 'スキル', armor_set: 'シリーズ', decoration: '装飾品', set_bonus: 'シリーズスキル' };
  const miss = Object.keys(byKind).map(k => '<li>' + (kindJa[k] || k) + '（' + byKind[k].length + '）：' + esc(byKind[k].join('、')) + '</li>').join('');
  return `<p>使っているデータは GitHub の <code>gatheringhallstudios/MHWorldData</code> の commit <code>${esc(report.commit)}</code>（2021-03-04、Fatalis update）の <code>source_data/</code> です。プログラムのライセンスは MIT で、データの権利はカプコンにあります。攻略記事ではなく、ゲームの数値をまとめたデータです。</p>
<table><tr><th>ファイル</th><th>行数（見出しを除く）</th></tr>${rows}</table>
<p>取り込んだ数：防具 ${report.counts.armors}、シリーズ ${report.counts.sets}、シリーズスキル ${report.counts.bonuses}、装飾品 ${report.counts.decos}、護石 ${report.counts.charms}（うち最終段階 ${report.counts.charms_final}）、スキル ${report.counts.skills}、武器 ${report.counts.weapons}。</p>
<p>参照先のない名前：${report.missing_ref.length ? report.missing_ref.length + ' 件' : 'ありません'}。</p>
<details><summary>日本語の翻訳がない名前（${report.missing_ja.length} 件）</summary><ul>${miss}</ul></details>`;
}

const jsonSafe = s => s.replace(/</g, '\\u003c');
const textSafe = s => s.replace(/<\/script/gi, '<\\/script');
let html = read('src/index.template.html');
const engine = read('src/engine.js'), worker = read('src/worker.js'), app = read('src/app.js');
// ページで使わない英語の説明は外して小さくします
const slim = JSON.parse(JSON.stringify(game));
delete slim._idx; delete slim._critBase;
slim.skills.forEach(s => s.levels.forEach(l => { delete l.en; }));
const rep = (k, v) => { html = html.split(k).join(v); };
rep('@@HOWTO@@', howto());
rep('@@UNSUPPORTED@@', unsupported());
rep('@@DATA@@', dataSec());
rep('@@GAME@@', jsonSafe(JSON.stringify(slim)));
rep('@@PRESETS@@', jsonSafe(JSON.stringify(presets)));
rep('@@ENGINE_TEXT@@', textSafe(engine));
rep('@@WORKER_TEXT@@', textSafe(worker));
rep('@@ENGINE@@', textSafe(engine));
rep('@@APP@@', textSafe(app));
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), html);
const size = Buffer.byteLength(html);
console.log('dist/index.html ' + (size / 1024 / 1024).toFixed(2) + ' MB');
if (size > 16 * 1024 * 1024) { console.error('16MB を超えました'); process.exit(1); }
if (/<(script|link)[^>]+(src|href)=["']https?:/i.test(html)) { console.error('外部の読み込みがあります'); process.exit(1); }
