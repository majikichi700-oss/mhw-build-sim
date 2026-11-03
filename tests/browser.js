/* ヘッドレスのブラウザ（画面を出さないブラウザ）で dist/index.html を開いて確かめます。
 *   node tests/browser.js */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  失敗: ' + m); } };

async function page(browser, viewport, initScript) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push(String(e)));
  if (initScript) await p.addInitScript(initScript);
  await p.goto(FILE);
  await p.waitForFunction(() => window.__app);
  return { p, ctx, errors };
}

async function conditionSearch(p) {
  await p.fill('#skill-input', '見切り');
  await p.selectOption('#skill-lv', '3');
  await p.click('#add-skill');
  await p.fill('#skill-input', '弱点特効');
  await p.click('#add-skill');
  await p.click('summary:has-text("くわしい条件")');
  // 試験を短くするため、試験の中だけ 5 秒の選択肢を足します（画面の選択肢は 30 秒から）
  await p.evaluate(() => { const o = document.createElement('option'); o.value = '5'; o.textContent = '5 秒（試験用）'; document.getElementById('time-limit').appendChild(o); });
  await p.selectOption('#time-limit', '5');
  await p.click('#go');
  // 探している間に「途中の結果」が出ることと、終わったあとの結果を確かめます
  let liveSeen = false;
  try { await p.waitForSelector('#results .note:has-text("途中の結果")', { timeout: 8000 }); liveSeen = true; } catch (e) { liveSeen = false; }
  await p.waitForSelector('#go:not([disabled])', { timeout: 60000 });
  await p.waitForSelector('#results .card', { timeout: 60000 });
  p.__liveSeen = liveSeen;
  return p.$$eval('#results .card', els => els.length);
}

(async () => {
  const browser = await chromium.launch();
  for (const [name, vp] of [['パソコンの幅', { width: 1280, height: 900 }], ['スマホの幅', { width: 375, height: 760 }]]) {
    console.log('■ ' + name);
    const { p, ctx, errors } = await page(browser, vp);
    await p.waitForTimeout(500);
    ok(await p.evaluate(() => window.__app.workerOk()), name + ': Web Worker が動く');
    ok(await p.$eval('#nl', e => e.hidden), name + ': window.claude がないので言葉の入り口は隠れる');
    ok(!(await p.$eval('#nl-off', e => e.hidden)), name + ': 代わりの案内が出る');
    ok((await p.$$eval('#preset-out .card', e => e.length)) >= 3, name + ': 作っておいた案が出る');
    const rar = await p.$$eval('#weapon option', os => os.filter(o => /^\d+$/.test(o.value)).map(o => +(/レア(\d+)/.exec(o.textContent) || [0, 0])[1]));
    ok(rar.length > 0 && rar.every(r => r === 11 || r === 12), name + ': 武器の一覧はレア度 11 と 12 だけ');
    const n = await conditionSearch(p);
    ok(n >= 1, name + ': 条件検索で案が出る（' + n + '）');
    ok(p.__liveSeen, name + ': 探している間に途中の結果が出る');
    // 止めるボタン：止めても、それまでの結果が残る
    await p.evaluate(() => { document.getElementById('time-limit').value = '0'; });
    await p.click('#go');
    await p.waitForSelector('#results .note:has-text("途中の結果")', { timeout: 15000 });
    await p.click('#stop');
    await p.waitForSelector('#go:not([disabled])', { timeout: 15000 });
    ok(/止めました/.test(await p.textContent('#status')) && (await p.$$eval('#results .card', e => e.length)) >= 1, name + ': 「最後まで」で探して止めると、それまでの結果が残る');
    await p.selectOption('#time-limit', '5');
    await p.click('#go');
    await p.waitForSelector('#go:not([disabled])', { timeout: 60000 });
    const st = await p.textContent('#status');
    console.log('  ' + st.slice(0, 160));
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= vp.width + 1, name + ': 横にはみ出さない（' + sw + 'px）');
    // コピーと URL
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await p.click('#results .card [data-share]');
    await p.waitForTimeout(300);
    const url = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(/#b=/.test(url), name + ': 案の URL ができる');
    if (url) {
      const p2 = await ctx.newPage();
      const e2 = []; p2.on('pageerror', e => e2.push(String(e)));
      await p2.goto(url); await p2.waitForSelector('#shared-out .card');
      ok(!(await p2.$eval('#shared', e => e.hidden)), name + ': URL から案を開ける');
      const a1 = await p.$eval('#results .card', e => e.querySelector('table.parts').textContent);
      const a2 = await p2.$eval('#shared-out .card', e => e.querySelector('table.parts').textContent);
      ok(a1 === a2, name + ': URL で開いた案が同じ');
      const s1 = await p.$eval('#results .card', e => e.querySelector('.pts').textContent);
      const s2 = await p2.$eval('#shared-out .card', e => e.querySelector('.pts').textContent);
      ok(s1 === s2, name + ': URL で開いた案の点数が同じ（' + s1 + ' / ' + s2 + '）');
      ok(e2.length === 0, name + ': URL のページでエラーがない ' + e2.join(' '));
      await p2.close();
    }
    await p.click('#results .card [data-copy]');
    await p.waitForTimeout(300);
    const txt = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(/【MHW:IB 装備案】/.test(txt) && /頭: /.test(txt), name + ': 一覧をコピーできる');
    // 作っておいた案を全部の武器・目的で開く
    for (const t of await p.$$eval('#preset-type option', os => os.map(o => o.value))) {
      for (const o of ['fire', 'balance', 'comfort']) {
        await p.selectOption('#preset-type', t); await p.selectOption('#preset-obj', o);
        const c = await p.$$eval('#preset-out .card', e => e.length);
        ok(c >= 3 && c <= 5, name + ': ' + t + ' ' + o + ' の案が 3〜5 個（' + c + '）');
      }
    }
    if (vp.width < 500) await p.screenshot({ path: path.join(__dirname, '..', 'tmp', 'mobile.png'), fullPage: false });
    ok(errors.length === 0, name + ': コンソールにエラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ カスタム強化の入力');
  {
    const { p, ctx, errors } = await page(browser, { width: 900, height: 900 });
    await p.waitForTimeout(500);
    await p.click('summary:has-text("くわしい条件")');
    const wid = await p.$eval('#weapon', s => Array.from(s.options).find(o => /^\d+$/.test(o.value)).value);
    await p.selectOption('#weapon', wid);
    await p.fill('#wo-attack', '1000');
    await p.selectOption('#wo-s1', '4'); await p.selectOption('#wo-s2', '4'); await p.selectOption('#wo-s3', '2');
    await p.check('#armor-augmax');
    // 強化した防具：スロットは「データのまま」、スキルだけ足す
    const label = await p.$eval('#armor-list', dl => Array.from(dl.options).map(o => o.value).find(v => /｜頭｜マスターランク｜/.test(v)));
    await p.fill('#ao-input', label);
    await p.fill('#ao-skill', '攻撃'); await p.selectOption('#ao-lv', '1');
    await p.click('#add-ao');
    ok(/データのまま/.test(await p.textContent('#ao-chips')), '強化した防具のスロットを「データのまま」にできる');
    await p.evaluate(() => { const o = document.createElement('option'); o.value = '5'; document.getElementById('time-limit').appendChild(o); });
    await p.selectOption('#time-limit', '5');
    await p.click('#go');
    await p.waitForSelector('#go:not([disabled])', { timeout: 60000 });
    const card = await p.$('#results .card');
    ok(!!card, '強化を入れて探すと案が出る');
    if (card) {
      const wslots = await p.$eval('#results .card table.parts tr', tr => tr.querySelectorAll('.slot').length);
      ok(wslots === 3, '入れた武器のスロット（3 つ）が表に出る（' + wslots + '）');
      const txt = await p.textContent('#results .card');
      ok(/武器（入力した値）：表示攻撃力 1000/.test(txt) && /カスタム強化の最大/.test(txt), '強化の入力と、防御力の書き方がカードに出る');
    }
    // 武器を変えたら、入れた数値は消える
    const wid2 = await p.$eval('#weapon', s => Array.from(s.options).filter(o => /^\d+$/.test(o.value))[1].value);
    await p.selectOption('#weapon', wid2);
    ok((await p.inputValue('#wo-attack')) === '', '武器を変えると、前の武器のための数値が消える');
    ok(errors.length === 0, 'エラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ 使わないシリーズ');
  {
    const { p, ctx, errors } = await page(browser, { width: 375, height: 760 });
    await p.waitForTimeout(500);
    await p.click('summary:has-text("くわしい条件")');
    const lab = await p.$eval('#series-list', dl => Array.from(dl.options).map(o => o.value).find(v => v.startsWith('EXドラゴンα｜')));
    await p.fill('#exs-input', lab);
    await p.click('#add-exs');
    const chips = await p.textContent('#exs-chips');
    ok(/EXドラゴンα/.test(chips) && /EXドラゴンβ/.test(chips), 'α を選ぶと β もまとめて外す（' + chips.replace(/\s+/g, ' ') + '）');
    await p.evaluate(() => { const o = document.createElement('option'); o.value = '5'; document.getElementById('time-limit').appendChild(o); });
    await p.selectOption('#time-limit', '5');
    await p.click('#go');
    await p.waitForSelector('#go:not([disabled])', { timeout: 60000 });
    const txt = await p.textContent('#results');
    ok((await p.$$eval('#results .card', e => e.length)) > 0 && !/EXドラゴン/.test(txt), '外したシリーズの防具が結果に出ない');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 376, 'スマホの幅で横にはみ出さない（' + sw + 'px）');
    ok(errors.length === 0, 'エラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ 武器もおまかせ・使わない武器のシリーズ');
  {
    const { p, ctx, errors } = await page(browser, { width: 375, height: 760 });
    await p.waitForTimeout(500);
    await p.check('#wx-kulve');
    const hasKulve = await p.$$eval('#weapon option', os => os.some(o => /皇金/.test(o.textContent)));
    ok(!hasKulve, '皇金の武器を外すと、武器の一覧から消える');
    await p.selectOption('#weapon', 'auto');
    ok(!(await p.$eval('#weapon-auto-box', e => e.hidden)), 'おまかせを選ぶと説明と候補の数が出る');
    await p.selectOption('#weapon-top', '4');
    await p.click('summary:has-text("くわしい条件")');
    await p.evaluate(() => { const o = document.createElement('option'); o.value = '8'; document.getElementById('time-limit').appendChild(o); });
    await p.selectOption('#time-limit', '8');
    await p.click('#go');
    await p.waitForSelector('#go:not([disabled])', { timeout: 90000 });
    const st = await p.textContent('#status');
    ok(/武器はおまかせ/.test(st) && (await p.$$eval('#results .card', e => e.length)) > 0, 'おまかせで探すと、武器ごとの結果と案が出る');
    ok(!/皇金/.test(await p.textContent('#results')), '外した皇金の武器は案に出ない');
    ok(errors.length === 0, 'エラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ まねた window.claude（選んだモデルがそのまま答える）');
  {
    const { p, ctx, errors } = await page(browser, { width: 800, height: 800 }, () => {
      const s = async function (input, opts) {
        const T = n => opts.tools.find(t => t.name === n);
        const r = await T('searchBuilds').execute({ weaponType: 'bow', objective: 'comfort', skills: [{ name: '回避距離ＵＰ', level: 1 }] });
        return { text: JSON.stringify({ summary: 'ok', ranking: [{ buildId: r.builds[0].buildId, reason: 'r' }], relax: '' }), truncated: false, modelTierApplied: 'default', modelApplied: opts.model };
      };
      window.claude = { use: (n) => Promise.resolve(n === 'sample' ? s : null) };
    });
    await p.waitForSelector('#nl:not([hidden])');
    await p.selectOption('#nl-model', 'claude-sonnet-5-5');
    await p.click('#nl-go');
    await p.waitForSelector('#nl-out .card', { timeout: 60000 });
    ok(/Sonnet 5\.5（claude-sonnet-5-5）が答えました/.test(await p.textContent('#nl-status')), '選んだモデルが答えたときは、そのことを出す');
    ok(errors.length === 0, 'エラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ Web Worker が使えないとき');
  {
    const { p, ctx, errors } = await page(browser, { width: 800, height: 800 }, () => { window.Worker = undefined; });
    const n = await conditionSearch(p);
    ok(n >= 1, 'Worker なしでも案が出る');
    ok(errors.length === 0, 'Worker なしでエラーがない ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('■ まねた window.claude（use が null を返す）');
  {
    const { p, ctx, errors } = await page(browser, { width: 800, height: 800 }, () => { window.claude = { use: () => Promise.resolve(null) }; });
    await p.waitForTimeout(300);
    ok(await p.$eval('#nl', e => e.hidden), 'null のとき入り口は隠れる');
    ok(errors.length === 0, 'エラーがない');
    await ctx.close();
  }

  console.log('■ まねた window.claude（not_granted で断られる）');
  {
    const { p, ctx, errors } = await page(browser, { width: 800, height: 800 }, () => {
      const s = function () { return Promise.reject({ code: 'not_granted', message: 'no' }); };
      window.claude = { use: () => Promise.resolve(s) };
    });
    await p.waitForSelector('#nl:not([hidden])');
    await p.click('#nl-go');
    await p.waitForSelector('#nl', { state: 'hidden' });
    ok(await p.$eval('#nl', e => e.hidden), 'not_granted のとき入り口を閉じる');
    ok(!(await p.$eval('#nl-off', e => e.hidden)), '代わりの案内が出る');
    ok(errors.length === 0, 'エラーがない');
    await ctx.close();
  }

  console.log('■ まねた window.claude（道具を使って答える）');
  {
    const { p, ctx, errors } = await page(browser, { width: 375, height: 760 }, () => {
      window.__calls = [];
      const s = async function (input, opts) {
        window.__calls.push({ input, model: opts.model, tier: opts.modelTier, effort: opts.effort, tools: opts.tools.map(t => t.name) });
        const T = n => opts.tools.find(t => t.name === n);
        const f = await T('findSkills').execute({ query: '見切り' });
        window.__findSize = JSON.stringify(f).length;
        const r = await T('searchBuilds').execute({ weaponType: 'long-sword', objective: 'fire', skills: [{ name: '見切り', level: 4 }, { name: '超会心', level: 3 }, { name: '弱点特効', level: 3 }] });
        window.__searchSize = JSON.stringify(r).length;
        const g = await T('getBuild').execute({ buildId: r.builds[0].buildId });
        window.__getSize = JSON.stringify(g).length;
        let bad = null; try { await T('searchBuilds').execute({ weaponType: 'long-sword', objective: 'fire', skills: [{ name: 'ありえない', level: 1 }] }); } catch (e) { bad = e.message; }
        window.__bad = bad;
        opts.onText({ text: '...', delta: '...' });
        return { text: '考えました。\n' + JSON.stringify({ summary: '太刀・火力で探しました。', ranking: [{ buildId: r.builds[1].buildId, reason: '理由1' }, { buildId: 's99-b1', reason: 'ない案' }, { buildId: r.builds[0].buildId, reason: '理由2' }], relax: '' }), truncated: false, modelTierApplied: 'default' };
      };
      window.claude = { use: (n) => Promise.resolve(n === 'sample' ? s : null) };
    });
    await p.waitForSelector('#nl:not([hidden])');
    ok(await p.evaluate(() => window.__calls.length === 0), 'ボタンを押す前は呼ばない');
    await p.click('#nl-go');
    await p.waitForSelector('#nl-out .card', { timeout: 60000 });
    const calls = await p.evaluate(() => window.__calls);
    ok(calls.length === 1, '1 回だけ呼ぶ');
    ok(calls[0].model === 'claude-opus-5-5', 'model に claude-opus-5-5 を渡す');
    ok(['findSkills', 'searchBuilds', 'getBuild'].every(n => calls[0].tools.includes(n)), '道具を渡す');
    const sizes = await p.evaluate(() => [window.__findSize, window.__searchSize, window.__getSize]);
    ok(sizes.every(x => x < 32000), '道具の答えが 32KB 以内（' + sizes.join(', ') + '）');
    ok(await p.evaluate(() => /見つからないスキル名/.test(window.__bad)), 'ない名前は道具がエラーで返す');
    ok((await p.$$eval('#nl-out .card', e => e.length)) === 2, '検索結果にない buildId は出さない');
    ok(/ない案が 1 個/.test(await p.textContent('#nl-out')), '出さなかったことを書く');
    ok(/別のモデル/.test(await p.textContent('#nl-status')), 'Opus でないときにそのことを出す');
    // Claude の性能を選ぶ
    await p.selectOption('#nl-model', 'claude-haiku-5-5');
    await p.selectOption('#nl-effort', 'low');
    await p.click('#nl-go');
    await p.waitForFunction(() => window.__calls.length === 2, null, { timeout: 60000 });
    await p.waitForSelector('#nl-go:not([disabled])', { timeout: 60000 });
    const c2 = await p.evaluate(() => window.__calls[1]);
    ok(c2.model === 'claude-haiku-5-5' && c2.tier === 'quick' && c2.effort === 'low', '選んだモデル・段階・考える深さを渡す（' + JSON.stringify([c2.model, c2.tier, c2.effort]) + '）');
        ok(errors.length === 0, 'エラーがない ' + errors.join(' | '));
    await p.screenshot({ path: path.join(__dirname, '..', 'tmp', 'nl-mock.png') });
    await ctx.close();
  }
  await browser.close();
  console.log('\n合格 ' + pass + '、失敗 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
