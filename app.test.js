// Testes automáticos do Read & Learn.
// Rodam no GitHub a cada envio (Actions > Testes) e antes de gerar o APK.
// Uso local: APP=/caminho/index.html node app.test.js
const { chromium } = require('playwright');
const path = require('path');
const APP = 'file://' + path.resolve(process.env.APP || 'index.html');

const MOCKS = () => {
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  window.__tts = []; window.__ln = []; window.__heard = 'every morning'; window.__exit = 0;
  window.Capacitor = { Plugins: {
    TextToSpeech: { speak: o => { __tts.push(o.text); return new Promise(r => setTimeout(r, 30000)); }, stop: async () => { __tts.push('«stop»'); } },
    SpeechRecognition: { available: async () => ({ available: true }), requestPermissions: async () => ({ speechRecognition: 'granted' }), start: async () => ({ matches: [window.__heard] }), stop: async () => {} },
    LocalNotifications: { cancel: async () => { __ln.push('cancel'); }, requestPermissions: async () => ({ display: 'granted' }), schedule: async o => { __ln.push('schedule:' + o.notifications[0].schedule.on.hour); } },
    App: { addListener: (n, f) => { window.__bk = f; }, exitApp: () => { window.__exit++; } } } };
};

let browser, passed = 0; const fails = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
const click = (pg, s) => pg.evaluate(x => document.querySelector(x).click(), s);
const tab = (pg, t) => pg.evaluate(x => document.querySelector('nav button[data-t=' + x + ']').click(), t);
const wait = (pg, ms = 300) => pg.waitForTimeout(ms);
const login = async pg => { await pg.fill('#nm', 'Teste'); await click(pg, '#enter'); await wait(pg); await click(pg, '#tskip'); };
const openText = async (pg, level = 0, idx = 0) => { await tab(pg, 'lib'); await wait(pg, 200); await pg.evaluate(l => { const t = document.querySelectorAll('.lvt')[l]; if (!t.classList.contains('on')) t.click(); }, level); await pg.evaluate(i => document.querySelectorAll('.tc')[i].click(), idx); await wait(pg, 500); };
const saveWords = (pg, n) => pg.evaluate(n => { const ws = dictPool(false).slice(0, n); saved[cur.id] = {}; ws.forEach(k => saved[cur.id][k] = trOf(k)); persist(); }, n);
const hover = (pg, i) => pg.evaluate(i => document.querySelectorAll('#txt .w')[i].dispatchEvent(new Event('mouseenter')), i);

async function test(name, fn, vp = { width: 390, height: 844 }, setup = true) {
  const ctx = await browser.newContext({ viewport: vp });
  const pg = await ctx.newPage(); const errs = [];
  pg.setDefaultTimeout(8000);
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept('x'));
  await pg.addInitScript(MOCKS);
  try {
    await pg.goto(APP);
    if (setup) await login(pg);
    await fn(pg);
    if (errs.length) throw new Error('erros de JavaScript: ' + errs.join(' | '));
    passed++; console.log('OK    ', name);
  } catch (e) {
    fails.push(name + ' -> ' + e.message); console.log('FALHOU', name, '->', e.message);
    try { await pg.screenshot({ path: 'falha-' + name.replace(/\W+/g, '_') + '.png' }); } catch (x) {}
  }
  await ctx.close();
}

(async () => {
  browser = await chromium.launch();

  await test('Dados: 40 textos, 10 por nível, ids únicos', async pg => {
    const r = await pg.evaluate(() => ({ n: TEXTS.length, ids: new Set(TEXTS.map(t => t.id)).size, lv: LV.map(l => TEXTS.filter(t => t.lv === l).length), img: Object.keys(IMG).length, orfas: Object.keys(IMG).filter(k => !TEXTS.some(t => t.id === k)) }));
    eq(r.n, 40, 'textos'); eq(r.ids, 40, 'ids únicos'); eq(r.lv.join(','), '10,10,10,10', 'textos por nível');
    ok(r.img >= 37, 'imagens embutidas: ' + r.img); eq(r.orfas.length, 0, 'imagens sem texto');
  }, undefined, false);

  await test('Todas as palavras dos 40 textos têm tradução offline', async pg => {
    const miss = await pg.evaluate(() => { const o = []; TEXTS.forEach(t => { cur = t; t.body.split(' ').forEach(w => { const k = clean(w); if (k && !dw(k) && !lem(k)) o.push(t.id + ':' + k); }); }); return o; });
    eq(miss.length, 0, 'palavras sem tradução (' + miss.slice(0, 5).join(', ') + ')');
  }, undefined, false);

  await test('Início enxuto e Biblioteca com níveis e 10 textos por nível', async pg => {
    ok((await pg.$eval('#hi', e => e.textContent)).includes('Seja bem-vindo(a)'), 'saudação');
    ok(await pg.$('#goal') !== null, 'cartão da meta'); ok(await pg.$('#cont2 .hc') !== null, 'cartão continuar');
    eq(await pg.$$eval('.lvt', e => e.length), 0, 'níveis não ficam mais no início');
    await tab(pg, 'lib'); await wait(pg, 250);
    eq(await pg.$eval('#ttl', e => e.textContent), 'Biblioteca', 'título da biblioteca');
    eq(await pg.$$eval('.lvt', e => e.length), 4, 'níveis');
    eq(await pg.$$eval('.tc', e => e.length), 0, 'textos antes de escolher o nível');
    await pg.evaluate(() => document.querySelectorAll('.lvt')[2].click());
    eq(await pg.$$eval('.tc', e => e.length), 10, 'textos do nível');
  });

  await test('Abrir cada um dos 40 textos', async pg => {
    const bad = await pg.evaluate(() => { const o = []; TEXTS.forEach(t => { openText(t.id); if (!document.querySelectorAll('#txt .w').length || document.querySelector('#ttl').textContent !== t.title || !document.querySelector('#ill img,#ill svg')) o.push(t.id); }); return o; });
    eq(bad.length, 0, 'textos que não abriram bem (' + bad.join(',') + ')');
  });

  await test('Traduzir e salvar uma palavra', async pg => {
    await openText(pg); await hover(pg, 3); await wait(pg, 200);
    eq(await pg.$eval('#pop', e => e.style.display), 'block', 'painel de tradução');
    ok((await pg.$eval('#pw', e => e.textContent)).length > 0, 'palavra no painel');
    await click(pg, '#save'); await wait(pg, 800);
    eq(await pg.evaluate(() => Object.keys(saved[cur.id] || {}).length), 1, 'palavras salvas');
    eq(await pg.$eval('#pop', e => e.style.display), 'none', 'painel fecha ao salvar');
    eq(await pg.$eval('#fcnt', e => e.textContent), '1', 'contador de flashcards');
  });

  await test('Narração: pausa ao tocar na palavra e continua dali', async pg => {
    await openText(pg); await click(pg, '#mpPlay'); await wait(pg, 400);
    const full = await pg.evaluate(() => cur.body.length);
    await pg.evaluate(() => { acc = 3000; }); await hover(pg, 12); await wait(pg, 200);
    eq(await pg.evaluate(() => __tts[__tts.length - 1]), '«stop»', 'narração pausada');
    await click(pg, '#cont'); await wait(pg, 400);
    const last = await pg.evaluate(() => __tts[__tts.length - 1]);
    ok(last !== '«stop»' && last.length < full, 'retomou no meio do texto');
  });

  await test('Barra fixa: Início, Ler, Palavras, Praticar', async pg => {
    eq((await pg.$$eval('nav button', e => e.map(b => b.dataset.t))).join(','), 'home,lib,words,prac', 'abas');
    const on = () => pg.$eval('nav button.on', e => e.dataset.t), ttl = () => pg.$eval('#ttl', e => e.textContent);
    eq(await on(), 'home', 'aba ativa no início');
    await tab(pg, 'lib'); await wait(pg, 200); eq(await on(), 'lib', 'aba Ler'); eq(await ttl(), 'Biblioteca', 'título Ler');
    await openText(pg); eq(await on(), 'lib', 'aba durante a leitura');
    await tab(pg, 'words'); await wait(pg, 200); eq(await on(), 'words', 'aba Palavras'); eq(await ttl(), 'Palavras', 'título Palavras');
    await tab(pg, 'prac'); await wait(pg, 200); eq(await on(), 'prac', 'aba Praticar'); eq(await ttl(), 'Praticar', 'título Praticar');
    await tab(pg, 'home'); await wait(pg, 200); eq(await on(), 'home', 'volta ao Início');
    eq(await pg.$eval('nav', e => getComputedStyle(e).display), 'flex', 'barra visível');
  });

  await test('Biblioteca: banner "Continuar leitura" leva ao último texto', async pg => {
    await tab(pg, 'lib'); await wait(pg, 200);
    eq(await pg.$('#libGo'), null, 'sem banner antes de abrir um texto');
    await openText(pg, 1, 2); const t = await pg.$eval('#ttl', e => e.textContent);
    await tab(pg, 'prac'); await wait(pg, 200); await tab(pg, 'lib'); await wait(pg, 300);
    const txt = await pg.$eval('#libGo', e => e.innerText);
    ok(txt.includes('Continuar leitura'), 'texto do banner'); ok(txt.includes(t), 'título do último texto');
    await click(pg, '#libGo'); await wait(pg, 400);
    eq(await pg.$eval('#ttl', e => e.textContent), t, 'abre o último texto');
    ok(await pg.evaluate(() => !document.querySelector('#read').hidden), 'na leitura');
    await click(pg, '#finBtn'); await wait(pg, 300); await tab(pg, 'lib'); await wait(pg, 300);
    ok((await pg.$eval('#libGo', e => e.innerText)).includes('Próximo texto'), 'sugere o próximo texto após concluir');
  });

  await test('Palavras: lista com Último texto / Todas as palavras e sem botão Praticar', async pg => {
    await openText(pg); await saveWords(pg, 4); await openText(pg, 0, 1); await saveWords(pg, 3);
    await tab(pg, 'words'); await wait(pg, 250);
    eq(await pg.$('#wPrac'), null, 'botão Praticar removido de Palavras');
    eq((await pg.$$eval('#wSeg button', e => e.map(b => b.textContent))).join('|'), 'Último texto|Todas as palavras', 'divisão');
    eq(await pg.$$eval('#wlist .item', e => e.length), 3, 'palavras do último texto');
    await pg.evaluate(() => document.querySelectorAll('#wSeg button')[1].click()); await wait(pg, 200);
    eq(await pg.$$eval('#wlist .item', e => e.length), 7, 'todas as palavras');
  });

  await test('Texto de treino: padrão em ordem, texto aberto e troca manual', async pg => {
    await tab(pg, 'prac'); await wait(pg, 200);
    eq(await pg.$eval('#ptSel', e => e.value), 't01', 'sem histórico usa o primeiro texto');
    await pg.evaluate(() => { doneT = { t01: 1, t02: 1 }; localStorage.setItem('rl_done', JSON.stringify(doneT)); }); await pg.reload(); await wait(pg, 400);
    await tab(pg, 'prac'); await wait(pg, 200);
    eq(await pg.$eval('#ptSel', e => e.value), 't03', 'sem texto aberto usa o próximo da fila');
    await openText(pg, 0, 4); await tab(pg, 'prac'); await wait(pg, 200);
    eq(await pg.$eval('#ptSel', e => e.value), 't05', 'usa o texto aberto na sessão');
    await pg.evaluate(() => { const s = document.querySelector('#ptSel'); s.value = 't12'; s.dispatchEvent(new Event('change')); }); await wait(pg, 200);
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=dict]').click()); await wait(pg, 500);
    eq(await pg.evaluate(() => cur.id + '/' + dx.id), 't12/t12', 'Ditado usa o texto escolhido');
  });

  await test('Texto concluído: treinar este texto e próximo texto no Início', async pg => {
    await openText(pg); await click(pg, '#finBtn'); await wait(pg, 300);
    eq(await pg.$eval('#ttl', e => e.textContent), 'Concluído', 'tela de conclusão');
    ok(await pg.$('#dPr') !== null && await pg.$('#dDi') !== null && await pg.$('#dLs') !== null, 'botões da conclusão');
    await click(pg, '#dPr'); await wait(pg, 400);
    eq(await pg.evaluate(() => cur.id + '/' + !document.querySelector('#pron').hidden), 't01/true', 'Pronúncia deste texto');
    await tab(pg, 'home'); await wait(pg, 300);
    ok((await pg.$eval('#cont2', e => e.innerText)).includes('Próximo texto'), 'Início sugere o próximo texto');
    await click(pg, '#goCont'); await wait(pg, 400);
    eq(await pg.$eval('#ttl', e => e.textContent), 'The Missing Wallet', 'abre o próximo texto');
  });

  await test('Flashcards: baralho, treino e revisão espaçada', async pg => {
    await openText(pg); await saveWords(pg, 3); await tab(pg, 'prac'); await wait(pg);
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=cards]').click()); await wait(pg, 300);
    eq(await pg.$$eval('.deck', e => e.length), 1, 'baralhos');
    await click(pg, '.dk'); await wait(pg, 400); await click(pg, '#cd'); await wait(pg, 200); await click(pg, '#ok'); await wait(pg, 800);
    eq(await pg.evaluate(() => Object.values(srs[cur.id])[0].b), 1, 'caixa da revisão espaçada');
  });

  await test('Pronúncia com microfone simulado', async pg => {
    await openText(pg); await tab(pg, 'prac'); await wait(pg);
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=pron]').click()); await wait(pg, 300);
    await pg.evaluate(() => { window.__heard = sents()[0]; });
    await click(pg, '#mic'); await wait(pg, 600);
    eq(await pg.$eval('.big-sc', e => e.textContent), '100%', 'nota');
  });

  await test('Ditado: erro, dica, acerto, traduções e resumo', async pg => {
    await openText(pg); await tab(pg, 'prac');
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=dict]').click()); await wait(pg, 700);
    ok(await pg.evaluate(() => !document.activeElement || document.activeElement.id !== 'dxIn'), 'teclado não abre sozinho');
    await pg.fill('#dxIn', 'zzzz'); await click(pg, '#dxChk'); await wait(pg, 150);
    ok((await pg.$eval('#dxMsg', e => e.textContent)).includes('Ainda não'), 'mensagem de erro');
    for (let i = 0; i < 10; i++) {
      const k = await pg.evaluate(() => dx.q[dx.i]); await pg.fill('#dxIn', k); await click(pg, '#dxChk'); await wait(pg, 600);
      const r = await pg.evaluate(k => trOf(k), k); const opts = await pg.$$eval('.opt', e => e.map(x => x.textContent));
      eq(opts.length, 4, 'opções'); ok(opts.includes(r), 'opção certa presente');
      await pg.evaluate(r => [...document.querySelectorAll('.opt')].find(x => x.textContent === r).click(), r); await wait(pg, 150); await click(pg, '#dxNext'); await wait(pg, 150);
    }
    ok((await pg.$eval('#dict', e => e.innerText)).includes('Exercício concluído'), 'resumo final');
  });

  await test('Jogos: aviso com poucas palavras e menu', async pg => {
    await openText(pg); await saveWords(pg, 3); await tab(pg, 'prac');
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=games]').click()); await wait(pg, 250);
    ok((await pg.$eval('#prac', e => e.innerText)).includes('Salve mais palavras'), 'aviso');
    await saveWords(pg, 16); await click(pg, '#gBack'); await wait(pg, 150);
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=games]').click()); await wait(pg, 250);
    eq(await pg.$$eval('#prac .gcard', e => e.length), 4, 'jogos no menu');
  });

  const toGame = async (pg, g) => { await openText(pg); await saveWords(pg, 16); await tab(pg, 'prac');
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=games]').click()); await wait(pg, 200);
    await pg.evaluate(g => document.querySelector('.gcard[data-g=' + g + ']').click(), g); await wait(pg, 300); };

  await test('Jogo: forca (6 palavras, vitória conta na revisão)', async pg => {
    await toGame(pg, 'hang');
    for (let i = 0; i < 6; i++) { const w = await pg.evaluate(() => gm.h.q[gm.h.i].k); for (const c of new Set(w)) await pg.evaluate(c => document.querySelector('.gkb[data-k=' + c + ']').click(), c); await wait(pg, 80); await click(pg, '#hNext'); await wait(pg, 80); }
    ok((await pg.$eval('#prac', e => e.innerText)).includes('6 de 6'), 'resultado da forca');
    ok(await pg.evaluate(() => Object.keys(srs[cur.id] || {}).length) > 0, 'revisão espaçada atualizada');
  });

  await test('Jogo: combinar', async pg => {
    await toGame(pg, 'match'); const n = await pg.evaluate(() => gm.m.pairs.length); ok(n >= 4, 'pares');
    for (let k = 0; k < n; k++) await pg.evaluate(() => { const m = gm.m, i = m.L.find(x => !m.done.includes(x)); if (m.sel !== i) document.querySelector('.mb[data-s=L][data-i="' + i + '"]').click(); document.querySelector('.mb[data-s=R][data-i="' + i + '"]').click(); });
    ok((await pg.$eval('#prac', e => e.innerText)).includes('Tudo combinado'), 'fim do combinar');
  });

  await test('Jogo: caça-palavras (arrastar o dedo)', async pg => {
    await toGame(pg, 'search'); const words = await pg.evaluate(() => gm.s.words.map(w => w.cells));
    ok(words.length >= 5, 'palavras na grade');
    const pos = ([r, c]) => pg.$eval('.sc[data-r="' + r + '"][data-c="' + c + '"]', e => { const x = e.getBoundingClientRect(); return [x.x + x.width / 2, x.y + x.height / 2]; });
    for (const cells of words) { const [x0, y0] = await pos(cells[0]), [x1, y1] = await pos(cells[cells.length - 1]);
      await pg.mouse.move(x0, y0); await pg.mouse.down(); for (let i = 1; i <= 6; i++) await pg.mouse.move(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await pg.mouse.up(); await wait(pg, 100); }
    eq(await pg.evaluate(() => gm.s.found), words.length, 'palavras achadas');
  });

  await test('Jogo: cruzadinha completa', async pg => {
    await toGame(pg, 'cross'); ok(await pg.evaluate(() => gm.x.words.length) >= 4, 'palavras na grade');
    await pg.evaluate(() => { gm.x.cells.flat().forEach(c => { if (c) c.g = c.ch; }); }); await click(pg, '#xChk'); await wait(pg, 200);
    eq(await pg.$eval('.dxm', e => e.textContent), 'Cruzadinha completa!', 'mensagem final');
    ok(await pg.evaluate(() => getComputedStyle(document.querySelector('.xdock') || document.body).position) !== undefined, 'ok');
  });

  await test('Cruzadinha: 100 grades geradas são válidas e cabem em 12x12', async pg => {
    const r = await pg.evaluate(() => {
      const all = []; const seen = new Set();
      TEXTS.forEach(t => { cur = t; t.body.split(' ').forEach(w => { const k = clean(w); if (!k || seen.has(k) || !/^[a-z]{3,9}$/.test(k)) return; const tr = dw(k); if (!tr || tr === 'nome próprio') return; seen.add(k); all.push({ k, pt: String(tr) }); }); });
      let bad = 0, big = 0;
      for (let n = 0; n < 100; n++) {
        const pl = genCross(shuffle(all.slice()).slice(0, 8)), g = new Map();
        pl.forEach(p => { for (let i = 0; i < p.k.length; i++) g.set((p.r + (p.dir ? i : 0)) + ',' + (p.c + (p.dir ? 0 : i)), p.k[i]); });
        const runs = new Set();
        g.forEach((ch, key) => { const [r, c] = key.split(',').map(Number);
          if (!g.has(r + ',' + (c - 1))) { let s = '', cc = c; while (g.has(r + ',' + cc)) { s += g.get(r + ',' + cc); cc++; } if (s.length > 1) runs.add('a' + r + ',' + c + ':' + s); }
          if (!g.has((r - 1) + ',' + c)) { let s = '', rr = r; while (g.has(rr + ',' + c)) { s += g.get(rr + ',' + c); rr++; } if (s.length > 1) runs.add('d' + r + ',' + c + ':' + s); } });
        const exp = new Set(pl.map(p => (p.dir ? 'd' : 'a') + p.r + ',' + p.c + ':' + p.k));
        if (pl.length < 4 || runs.size !== exp.size || [...runs].some(x => !exp.has(x))) bad++;
        let r0 = 1e9, c0 = 1e9, r1 = -1e9, c1 = -1e9; pl.forEach(p => { const L = p.k.length; r0 = Math.min(r0, p.r); c0 = Math.min(c0, p.c); r1 = Math.max(r1, p.r + (p.dir ? L - 1 : 0)); c1 = Math.max(c1, p.c + (p.dir ? 0 : L - 1)); });
        if (r1 - r0 + 1 > 12 || c1 - c0 + 1 > 12) big++;
      }
      return { bad, big };
    });
    eq(r.bad, 0, 'grades inválidas'); eq(r.big, 0, 'grades maiores que 12x12');
  }, undefined, false);

  await test('Backup e restauração', async pg => {
    await openText(pg); await saveWords(pg, 5);
    await pg.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); show('backup'); });
    await click(pg, '#bkCopy'); await wait(pg, 200);
    const txt = await pg.evaluate(() => window.__copied); ok(txt && txt.includes('read-learn'), 'backup copiado');
    await pg.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('rl_')).forEach(k => localStorage.removeItem(k)); });
    await pg.fill('#bkTxt', txt);
    await Promise.all([pg.waitForNavigation({ timeout: 6000 }).catch(() => {}), click(pg, '#bkImp')]); await wait(pg, 600);
    eq(await pg.evaluate(() => Object.values(JSON.parse(localStorage.getItem('rl_saved'))).reduce((a, o) => a + Object.keys(o).length, 0)), 5, 'palavras restauradas');
  });

  await test('Progresso, meta diária e lembrete', async pg => {
    await openText(pg); await hover(pg, 3); await click(pg, '#save'); await wait(pg, 700);
    ok(await pg.evaluate(() => meta.n) >= 1, 'meta conta a palavra salva');
    await pg.evaluate(() => show('stats')); await wait(pg, 300);
    ok((await pg.$eval('#stats', e => e.innerText)).includes('palavras salvas'), 'tela de progresso');
    await pg.evaluate(() => { document.querySelector('#remSeg button[data-r="1"]').click(); }); await wait(pg, 300);
    ok((await pg.evaluate(() => __ln.join(','))).includes('schedule:20'), 'lembrete agendado');
  });

  await test('Botão voltar do Android', async pg => {
    await openText(pg); await hover(pg, 3); await wait(pg, 150);
    await pg.evaluate(() => __bk()); await wait(pg, 300);
    ok(await pg.$eval('#pop', e => e.style.display !== 'block'), 'fecha o painel');
    await pg.evaluate(() => __bk()); await wait(pg, 300);
    eq(await pg.$eval('#ttl', e => e.textContent), 'Biblioteca', 'da leitura volta à biblioteca');
    await pg.evaluate(() => __bk()); await wait(pg, 300);
    eq(await pg.$eval('#ttl', e => e.textContent), 'Read & Learn', 'da biblioteca volta ao início');
    await pg.evaluate(() => __bk()); eq(await pg.evaluate(() => __exit), 0, 'não sai no primeiro toque');
    await pg.evaluate(() => __bk()); eq(await pg.evaluate(() => __exit), 1, 'sai no segundo toque');
  });

  await test('Layout em 360 px: sem rolagem lateral e abas com tamanho de toque', async pg => {
    const side = async n => ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'rolagem lateral em ' + n);
    await side('início'); await openText(pg); await side('leitura');
    for (const t of ['words', 'prac', 'lib', 'home']) { await tab(pg, t); await wait(pg, 400); await side(t); }
    const w = await pg.$$eval('nav button', e => e.map(b => Math.round(b.getBoundingClientRect().width)));
    ok(w.every(x => x >= 44), 'largura das abas: ' + w.join(','));
    const h = await pg.$$eval('nav button', e => e.map(b => Math.round(b.getBoundingClientRect().height)));
    ok(h.every(x => x >= 44), 'altura das abas: ' + h.join(','));
  }, { width: 360, height: 740 });

  await test('Teclado aberto esconde a barra de abas', async pg => {
    await openText(pg); await tab(pg, 'prac');
    await pg.evaluate(() => document.querySelector('#prac .gcard[data-g=dict]').click()); await wait(pg, 700);
    eq(await pg.$eval('nav', e => getComputedStyle(e).display), 'flex', 'barra visível sem teclado');
    await pg.setViewportSize({ width: 390, height: 500 }); await pg.evaluate(() => document.querySelector('#dxIn').focus()); await wait(pg, 400);
    eq(await pg.$eval('nav', e => getComputedStyle(e).display), 'none', 'barra escondida com teclado');
    await pg.setViewportSize({ width: 390, height: 844 }); await wait(pg, 400);
    eq(await pg.$eval('nav', e => getComputedStyle(e).display), 'flex', 'barra volta ao fechar o teclado');
  });

  await browser.close();
  console.log(`\n${passed} testes passaram, ${fails.length} falharam.`);
  if (fails.length) { console.log('\nFalhas:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
