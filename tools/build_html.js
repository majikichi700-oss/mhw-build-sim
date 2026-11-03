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
<li>スキルの数値は、すべて <code>skill_levels.csv</code> の日本語の説明文（description_ja）から読み取りました。読み取れたものは下の表のとおりです。数値が読めないスキル（たとえば 匠、無属性強化）は点数に入れず、案ごとに「数値に入れていないスキル」として表示します。</li>
</ul>
<h3>会心撃【属性】の倍率（検索で調べた値）</h3>
<table><tr><th>武器</th><th>会心撃【属性】</th><th>真・会心撃【属性】</th></tr>
<tr><td>大剣・ハンマー・狩猟笛・ヘビィボウガン</td><td>1.5</td><td>1.7</td></tr>
<tr><td>ライトボウガン</td><td>1.25</td><td>1.4</td></tr>
<tr><td>そのほか（太刀・片手剣・双剣・ランス・ガンランス・スラッシュアックス・チャージアックス・操虫棍・弓）</td><td>1.35</td><td>1.55</td></tr></table>
<p class="muted">出典：wikiwiki.jp/nenaiko（スキル/属性会心）、monsterhunterworld.wiki.fextralife.com（Critical Element・True Critical Element）、mhwg.org。ハンマーの会心撃【属性】は 1.7 倍とする出典もあり食い違っていたため、2 つの出典がそろう 1.5 倍にしました。ライトボウガンの 1.25 倍も、1.30 倍とする記事がありました。2 回目の別の確かめは、検索の回数の上限で行えていません。</p>
<h3>武器の種類ごとの決まり（v1.1、2026-11-03 に検索で調べた結果）</h3>
<p>どの攻撃・弾・矢にどのスキルが効くかを、武器の種類ごとに分けて計算します。攻撃のうち何割がそれに当たるか（攻撃の内わけ）は、ゲームのデータではなく見込みなので、「くわしい条件」で変えられます。調べた事実と出典の URL は、リポジトリの <code>data/research_mechanics.json</code> にあります。</p>
<table><tr><th>武器</th><th>計算に入れた決まり</th><th>入れていないこと（調べきれなかった・食い違った）</th></tr>
<tr><td>ガンランス</td><td>砲撃・竜撃砲は肉質を無視する固定のダメージで、攻撃・会心・属性のスキルでは変わらず、砲術（Lv1 1.1 倍〜Lv5 1.5 倍）だけが効く。初めの割合 30%。</td><td>砲撃タイプ・砲撃 Lv ごとの値、竜杭砲・起爆竜杭への砲術のかかり方、ネコの砲撃術との合計の上限</td></tr>
<tr><td>チャージアックス</td><td>武器のデータのビンで分けます。榴弾ビン：ビン爆発に砲術が効く（会心なし）。強属性ビン：砲術は効かず、ビン爆発は属性値で伸びる（会心なし）。初めの割合 20%。</td><td>ビン爆発の係数、剣・盾・斧の強化の倍率、会心撃【属性】が強属性ビンに効くか</td></tr>
<tr><td>スラッシュアックス</td><td>強撃ビンの武器は、剣モードの物理が 1.2 倍。砲術はどのビン爆発にも効かない。剣モードの初めの割合 50%。</td><td>強属性ビンの倍率（1.25 倍と 1.45 倍で食い違い）、滅龍・毒・麻痺・減気ビン、覚醒の倍率</td></tr>
<tr><td>ライトボウガン・ヘビィボウガン</td><td>主に使う弾を選びます。通常弾：通常弾・通常矢強化（Lv1 1.1 倍・Lv2 1.2 倍）。貫通弾：貫通弾・竜の一矢強化（1.1 倍・1.2 倍）。散弾：散弾・剛射強化（1.1 倍・1.15 倍。1.2 倍は誤りとの指摘あり）。徹甲榴弾：砲術が効き、会心は乗らない。拡散弾：会心も砲術も効かない。特殊弾：特殊射撃強化（データの倍率）。ヘビィボウガンの竜撃弾：砲術が効く（初めの割合 5%）。特殊弾の初めの割合 10%。</td><td>属性弾の係数（武器の攻撃力 × 弾ごとの係数）、斬裂弾の式、会心距離の倍率、速射の細かい補正。ボウガンは武器に属性値がないので、属性弾の点数は入りません</td></tr>
<tr><td>弓</td><td>主に使う矢：連射なら通常弾・通常矢強化が効く（貫通・拡散の矢には弾の強化は数えない）。剛射：散弾・剛射強化（初めの割合 10%）。竜の一矢・千々矢：特殊射撃強化と、竜の一矢には貫通弾・竜の一矢強化（初めの割合 10%）。ビン：強撃ビン 1.35 倍・接撃ビン 1.18 倍（物理にかける。どちらも出典は 1 つ）。</td><td>溜め段階ごとの倍率、ビンが属性にもかかるか、弓での真・会心撃【属性】の値</td></tr>
<tr><td>操虫棍</td><td>ジャンプ攻撃に飛燕（1.3 倍、データの説明文）。初めの割合 50%。</td><td>赤エキスの倍率、猟虫のダメージ</td></tr>
<tr><td>大剣・太刀・片手剣・双剣・ハンマー・狩猟笛・ランス</td><td>ふつうの攻撃として計算（攻撃・会心・属性のスキルが効く）。攻めの守勢はガードできる武器だけ。</td><td>溜めの倍率、太刀の練気の倍率、双剣の鬼人化の属性補正、狩猟笛の旋律の倍率（どれも検索で値が見つからない、または食い違った）。集中・KO術・笛吹き名人は火力の倍率ではないので数えません</td></tr>
</table>
<h3>説明文に数値がなく、検索で調べた数値を使うスキル</h3>
<ul>
<li>属性加速：属性値 +60、真・属性加速：属性値 +150（属性解放 Lv2・Lv3 として働くのはデータの説明文のとおり）。続けて当てたあと一定時間なので、割合 0.6 で数えます。</li>
<li>龍脈覚醒：会心率 +20%・属性値 +80、真・龍脈覚醒：会心率 +40%・属性値 +150（抜刀中。割合 0.8 で数えます）。属性値の +75 とする出典もありました。</li>
<li>無属性強化：属性も状態異常もない武器の元の攻撃力を 1.05 倍（アイスボーンの値。無印は 1.1 倍）。</li>
<li>属性値の上限：「元の値の 1.3 倍」と「1.6 倍か +150 の大きいほう」で食い違ったため、画面で選べるようにしました（はじめは上限なし）。</li>
<li>耐性変換【属性】・飛燕【属性】・抜刀術【力】は、式や値が確かめられなかったため、点数に入れていません。</li>
</ul>
<h3>カスタム強化</h3>
<ul>
<li>武器：攻撃力強化は 1 回で基礎攻撃力 +5（累計の枠 3・5・7・9）、会心率強化は 1 回目 +10%・2 回目から +5%（1 回目の枠 2）。枠を広げたあとの最大はレア度 10 で 10、11 で 8、12 で 6（調べた結果）。画面では回数を選ぶと数値が入ります。会心率強化の 2 回目からの枠、属性強化・スロット強化の量は調べきれなかったので、ゲームの画面の数値を入れてください。</li>
<li>防具：アイスボーンの防具のカスタム強化は、強化の上限を上げる（防御力が上がる）だけでした。防御力は、選べばデータの <code>defense_augment_max</code>（カスタム強化の最大）で計算します。</li>
<li>覚醒武器（赤龍の武器）の覚醒能力は、値が出典で食い違ったため、ゲームの画面の数値を入れる形です。</li>
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
<li>武器倍率：データの攻撃力は表示の値です。スキルの「基礎攻撃力＋3」と同じ単位にするため、次の数で割ります。データからは一つに決まらないため、はじめは作者が知っている値を選びましたが、v1.1 で検索して 2 つのサイトで同じ値だと確かめました（公式の資料は見つかっていません）。</li>
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
<li>決めた時間で終わらないときは、そこで止めて、何段まで調べたかを表示します。最後の段まで終われば、防具と護石の組み合わせは全部調べたのと同じ結果になります（小さな例で総当たりと同じになることを自動の試験で確かめています）。</li>
<li>装飾品の入れ方（余ったスロットに何を差すか）は、全部の入れ方を試すと間に合わないため、工夫した欲張り法（同じ装飾品をまとめて入れる手も比べる）と入れかえで決めます。最後に、上位の案だけ、もっと丁寧な方法（2 手先読み、ビーム探索、スロットが 3 つ以下なら全部の入れ方）で磨き直します。それでも一番よい入れ方になるとは限りません。</li>
<li>似た案ばかりにならないよう、上位の案のうち、すでに選んだ案と防具が 2 部位以上違う案を先に並べます。</li>
</ul>
<details><summary>説明文から読み取ったスキルの数値（${game.skills.filter(s => s.levels.some(l => l.eff)).length} 個）</summary><table><tr><th>スキル</th><th>条件</th><th>読み取った数値</th></tr>${parsed}</table></details>`;
}

function unsupported() {
  return `<ul>
<li>武器のカスタム強化のうち、会心率強化の 2 回目からの枠・属性強化・スロット強化の量、覚醒能力の値（ゲームの画面の数値を入れれば計算に入ります）。</li>
<li>覚醒武器（赤龍の武器など）の覚醒能力、ムフェト・ジーヴァの武器の追加能力（データにないため）。</li>
<li>斬れ味（匠などの効果を含む）：斬れ味ごとの倍率は調べられましたが、匠で何色まで伸びるかがデータにないため、入れていません。モーション値（技ごとの威力）、モンスターの肉質、狩猟笛の旋律、猟虫も入っていません。</li>
<li>耐性変換【属性】、飛燕【属性】、抜刀術【力】の数値（検索で確かめられなかったため）。ボウガンの属性弾、斬裂弾の点数。</li>
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
