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
<li>属性期待値 ＝（武器の属性値 × スキルの倍率 ＋ スキルで足す属性値）÷ ${E.ELEM_DIV} × 会心時の属性の補正 × 属性の重み。属性が 2 つある武器は平均です。毒・麻痺・睡眠・爆破は数えません。</li>
<li>会心時の属性の補正：会心撃【属性】か真・会心撃【属性】があるとき、1 ＋ 会心率 ×（倍率 − 1）をかけます。倍率は下の表のとおりで、検索で調べた値です（会心率がマイナスのときは属性は変わらないとして計算します）。</li>
<li>隠し属性（属性解放で出る属性）：属性解放／装填拡張 Lv1 で 1/3、Lv2 で 2/3、Lv3 で全部（データの説明文より）。属性加速と真・属性加速は、データの説明文のとおり属性解放 Lv2・Lv3 として、働いている時間の割合をかけて数えます。属性加速の「属性攻撃力も少し上昇」の量は調べきれなかったので入れていません。</li>
<li>属性の重み：属性ダメージを物理と比べてどれだけ重く見るかを、画面で 0.5 倍から 3 倍まで選べます（はじめは 1 倍）。手数の多い武器や、属性がよく効く相手では大きくしてください。</li>
<li>Inheritance（Fatalis Legend の 2 部位）：データの英語の説明（Removes the skill level cap for the skill secrets.）のとおり、極意スキルと同じように上限を上げるものとして扱います。</li>
<li>スキルの数値は、すべて <code>skill_levels.csv</code> の日本語の説明文（description_ja）から読み取りました。読み取れたものは下の表のとおりです。数値が読めないスキル（たとえば 匠、会心撃【属性】、無属性強化）は点数に入れず、案ごとに「数値に入れていないスキル」として表示します。</li>
</ul>
<h3>会心撃【属性】の倍率（検索で調べた値）</h3>
<table><tr><th>武器</th><th>会心撃【属性】</th><th>真・会心撃【属性】</th></tr>
<tr><td>大剣・ハンマー・狩猟笛・ヘビィボウガン</td><td>1.5</td><td>1.7</td></tr>
<tr><td>ライトボウガン</td><td>1.25</td><td>1.4</td></tr>
<tr><td>そのほか（太刀・片手剣・双剣・ランス・ガンランス・スラッシュアックス・チャージアックス・操虫棍・弓）</td><td>1.35</td><td>1.55</td></tr></table>
<p class="muted">出典：wikiwiki.jp/nenaiko（スキル/属性会心）、monsterhunterworld.wiki.fextralife.com（Critical Element・True Critical Element）、mhwg.org。ハンマーの会心撃【属性】は 1.7 倍とする出典もあり食い違っていたため、2 つの出典がそろう 1.5 倍にしました。ライトボウガンの 1.25 倍も、1.30 倍とする記事がありました。2 回目の別の確かめは、検索の回数の上限で行えていません。</p>
<h3>武器の種類ごとの数値</h3>
<ul>
<li>砲術：データの説明文のとおり「ガンランスの砲撃、竜撃砲、盾斧のビン攻撃、徹甲榴弾など、爆発を伴う攻撃」の威力に、データの倍率（Lv1 の 1.1 倍から Lv5 の 1.5 倍）をかけます。爆発を伴う攻撃がダメージの何割かは、画面で選べます（初めの値は作者の判断：ガンランス 30%、チャージアックス 20%、ボウガン 5%）。爆発の攻撃のダメージがほかのスキル（攻撃など）で変わるかは調べきれなかったため、砲術だけが効くとして計算します。</li>
<li>特殊射撃強化：データの説明文のとおり、ボウガンの特殊弾と弓の竜の一矢・竜の千々矢に、データの倍率（1.1 倍・1.2 倍）をかけます。割合の初めの値はボウガンと弓で 10%（作者の判断）です。</li>
<li>飛燕：データの説明文のとおり、ジャンプ攻撃の威力を 1.3 倍にします。割合の初めの値は操虫棍で 50%（作者の判断）、ほかの武器で 0% です。</li>
<li>通常弾・通常矢強化、貫通弾・竜の一矢強化、散弾・剛射強化は、データに倍率がなく、検索でも調べきれなかったため、点数に入れていません。</li>
</ul>
<h3>カスタム強化</h3>
<ul>
<li>カスタム強化の決まり（強化できる回数・上がる量）は検索で調べきれなかったため、ゲームの画面で見た「強化のあとの数値」を入れる形にしました。入れた値は、そのまま計算に使い、案と URL にも残ります。</li>
<li>防具の防御力は、選べば、データの <code>defense_augment_max</code>（カスタム強化の最大）で計算します。</li>
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
<li>カスタム強化の決まり（何をどれだけ強化できるか）。強化のあとの数値は、自分で入れれば計算に入ります。</li>
<li>覚醒武器（赤龍の武器など）の覚醒能力、ムフェト・ジーヴァの武器の追加能力（データにないため）。</li>
<li>斬れ味（匠などの効果を含む）、モーション値（技ごとの威力）、モンスターの肉質、属性値の上限、弾やビンの種類ごとの倍率、狩猟笛の旋律、猟虫。火力点には入っていません。属性値の上限は検索で調べきれなかったため、上限なしで計算しています（属性攻撃強化を多く積む案は、点数が高めに出るおそれがあります）。</li>
<li>属性加速の「属性攻撃力の上昇」、耐性変換【属性】、龍脈覚醒、飛燕【属性】、無属性強化の数値（検索で調べきれなかったため）。</li>
<li>「会心撃【属性】」「無属性強化」「抜刀術【力】」「龍脈覚醒」「属性変換」などの、説明文に数値がないスキルの火力（スキルの付け外しはできます）。「伝説の継承」「真・伝説の継承」（Inheritance・Transcendance）はデータに説明文がありません。</li>
<li>「不屈」（力尽きた回数で変わる）と「抜刀術【技】」（武器出し攻撃だけ）は火力点に数えません。</li>
<li>装飾品を持っている個数。持っていない装飾品を指定することはできますが、「1 個だけ持っている」は扱えません。</li>
<li>重ね着、性別ごとの見た目、モンスターごとの弱点。</li>
<li>武器のデータの「skill」列にシリーズスキルの名前（例：Kulve Taroth Essence）がある武器は、そのシリーズの 1 部位として数えます。これはデータの書き方から作者が判断したものです。</li>
<li>日本語名がデータにない装備（${report.missing_ja.length} 件。Fatalis の防具と武器など）は、記憶で埋めず、英語の名前のまま「日本語名なし」の印を付けて表示します。一覧は「データについて」にあります。</li>
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
<details><summary>検索で見つけた日本語名（${report.searched_ja.length} 件）</summary><p>データにも、データの中のほかの名前にも日本語名がなかったものは、検索の道具（WebSearch）の結果に出てくる攻略サイトや wiki の題名・説明から日本語名を見つけました（2026-11-02）。ページは開いていません。名前ごとの出典は <code>data/ja_names_extra.json</code> にあります。2 回目の別の確かめは、検索の回数の上限で行えていません。</p><ul>${report.searched_ja.map(x => '<li>' + esc(x.name_en) + '：' + esc(x.name_ja) + '（出典 ' + x.domains.length + ' サイト：' + esc(x.domains.join('、')) + '）</li>').join('')}</ul></details>
<details><summary>データの中のほかの名前から作った日本語名（${report.derived_ja.length} 件）</summary><p>翻訳の行がない γ+ の防具とシリーズは、同じ名前の β+ の日本語名の最後の「β」を「γ」に変えました。護石は、一つ前の段階の日本語名の最後の数字を、この段階の数字に変えました。どちらもデータの中の名前から作ったもので、記憶では埋めていません。</p><ul>${report.derived_ja.map(x => '<li>' + esc(x.name_en) + '：' + esc(x.name_ja) + '（もと：' + esc(x.from) + '）</li>').join('')}</ul></details>
<details><summary>日本語名がデータにない名前（${report.missing_ja.length} 件）</summary><p>データのどこにも日本語名がなく、ほかの名前から作ることもできなかったものです。記憶で埋めず、英語名のまま「日本語名なし」の印を付けて表示します。</p><ul>${miss}</ul></details>`;
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
