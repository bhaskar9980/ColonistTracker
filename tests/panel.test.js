'use strict';
// Renders the overlay inside jsdom to catch template errors and exercise the
// header buttons. Skipped when the optional jsdom dev-dependency is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT, name, text, img, row, play } = require('./helpers');
const { mapState, roomState } = require('./fixtures');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* optional */ }

function withDom(fn) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://colonist.io/#test1', pretendToBeVisual: true });
  const saved = {};
  for (const k of ['window', 'document', 'localStorage', 'getComputedStyle', 'HTMLElement', 'Node', 'MutationObserver']) {
    saved[k] = globalThis[k];
    globalThis[k] = dom.window[k];
  }
  try { return fn(dom); }
  finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } }
}

function sampleGame() {
  const game = new CT.Game();
  play(game, [
    row([name('Ahab', '#e27174'), text('placed a'), img('settlement')]),
    row([name('Beth', '#223697'), text('placed a'), img('settlement')]),
    row([name('Beth', '#223697'), text('received starting resources'), img('ore'), img('grain')]),
    row([name('Ahab', '#e27174'), text('rolled'), img('dice_3'), img('dice_4')]),
    row([name('Ahab', '#e27174'), text('moved Robber'), img('Robber'), text('to'), img('ore tile')]),
    row([name('Ahab', '#e27174'), text('stole'), img('card'), text('from'), name('Beth', '#223697')]),
    row([name('Beth', '#223697'), text('bought'), img('development card')]),
  ]);
  return game;
}

test('panel renders every tab, and header buttons hide, collapse and open settings', { skip: !JSDOM && 'jsdom not installed (npm install)' }, () => {
  withDom(() => {
    delete CT.Panel;
    delete require.cache[require.resolve('../src/panel.js')];
    require('../src/panel.js');
    const game = sampleGame();
    const board = new CT.Board();
    const calls = { rescans: 0, you: null, settings: [], windows: 0 };
    const panel = new CT.Panel({
      mode: 'overlay',
      data: {
        snapshot: () => game.snapshot(),
        board: () => board.summary(),
        advice: () => CT.advise(board, board.colorOf(game.you)),
        diagnostics: () => ({ ok: true }),
      },
      hooks: {
        onRescan: () => calls.rescans++,
        onSelectYou: (n) => { calls.you = n; game.setYou(n, 'manual'); },
        onSetting: (k, v) => { calls.settings.push([k, v]); game.setSetting(k, v, 'manual'); },
        onResetSettings: () => game.clearManualSettings(),
        onOpenWindow: () => calls.windows++,
      },
    });
    const body = () => panel.refs.body.innerHTML;
    const q = (sel) => panel.shadow.querySelector(sel);
    const css = panel.shadow.querySelector('style').textContent;

    // hidden must beat the flex display rule
    assert.match(css, /\.panel\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/);
    assert.match(body(), /Ahab/);
    assert.match(body(), /Beth/);
    assert.match(body(), /Which player are you\?/);
    assert.match(panel.refs.facts.textContent, /10 to win/);
    assert.match(panel.refs.facts.textContent, /discard over 7/);
    assert.match(panel.refs.status.title, /2 possible hand combinations/);

    for (const tab of ['race', 'spots', 'robber']) {
      q(`[data-tab="${tab}"]`).click();
      assert.equal(panel.prefs.tab, tab);
      assert.ok(body().length > 400, `tab ${tab} rendered`);
    }
    // the event log lives under settings
    assert.doesNotMatch(body(), /Event log/);
    q('[data-act="drawer"]').click();
    q('[data-act="log"]').click();
    assert.equal(panel.prefs.showLog, true);
    assert.match(body(), /Event log/);
    assert.match(body(), /hidden/); // the log notes the hidden steal
    q('.log-section [data-act="log"]').click();
    assert.equal(panel.prefs.showLog, false);
    q('[data-act="drawer"]').click();

    // robber tab: picking a resource repaints at once, even though the select keeps focus
    q('[data-tab="robber"]').click();
    assert.match(body(), /most cards and closest to winning/);
    const need = q('[data-field="need"]');
    need.focus();
    need.value = 'lumber';
    need.dispatchEvent(new globalThis.window.Event('change', { bubbles: true }));
    assert.equal(panel.prefs.need, 'lumber');
    assert.match(body(), /chance of Wood/);
    assert.doesNotMatch(body(), /most cards and closest to winning/);
    q('[data-tab="spots"]').click();
    assert.match(body(), /has not been captured yet/);
    q('[data-tab="race"]').click();
    assert.doesNotMatch(body(), /Where to settle/, 'spots stay out of the race tab');
    q('[data-tab="spots"]').click();

    // board arrives: spots tab gives advice once we know who we are
    board.applyMessage({ type: 'Connected', userSessionId: 's-ahab' });
    board.applyMessage(roomState());
    board.applyMessage({ mapState: mapState() });
    game.setYou('Ahab', 'session');
    panel.render();
    assert.match(body(), /Best first settlement/);
    assert.match(body(), /Ore 8, Sheep 5, Wood 3/);

    // settings drawer
    q('[data-act="drawer"]').click();
    assert.equal(panel.prefs.drawer, true);
    assert.ok(q('[data-field="vpToWin"]'), 'points-to-win input rendered');
    const vp = q('[data-field="vpToWin"]');
    vp.value = '13';
    vp.dispatchEvent(new globalThis.window.Event('change', { bubbles: true }));
    assert.deepEqual(calls.settings, [['vpToWin', 13]]);
    assert.match(panel.refs.facts.textContent, /13 to win/);
    assert.match(body(), /set by you/);
    q('[data-act="resetSettings"]').click();
    assert.match(panel.refs.facts.textContent, /10 to win/);
    q('[data-act="drawer"]').click();
    assert.equal(panel.prefs.drawer, false);

    // display mode + legend toggles
    q('[data-act="drawer"]').click();
    q('[data-act="mode"]').click();
    assert.equal(panel.prefs.mode, 'mean');
    q('[data-act="drawer"]').click();
    assert.match(body(), /class="legend"/);
    q('.legend [data-act="legend"]').click();
    assert.doesNotMatch(body(), /class="legend"/);

    q('[data-act="rescan"]').click();
    assert.equal(calls.rescans, 1);
    assert.equal(q('[data-act="window"]').hidden, false);
    q('[data-act="window"]').click();
    assert.equal(calls.windows, 1);

    // diagnostics (from the settings drawer) are shown in a text box for copying
    q('[data-act="drawer"]').click();
    q('.drawer [data-act="diag"]').click();
    assert.match(body(), /"ok": true/);
    q('[data-act="diagClose"]').click();
    assert.doesNotMatch(body(), /"ok": true/);
    q('[data-act="drawer"]').click();
    q('[data-tab="race"]').click();

    // choosing yourself from the notice
    game.you = null; game.youSource = null; game.replay(); panel.render();
    const select = q('.notice [data-field="you"]');
    select.value = 'Ahab';
    select.dispatchEvent(new globalThis.window.Event('change', { bubbles: true }));
    assert.equal(calls.you, 'Ahab');
    assert.match(body(), /class="who">you/);
    assert.doesNotMatch(body(), /Which player are you\?/);

    // collapse clears the fixed height; expand restores it
    panel.prefs.h = 500;
    panel._applyCollapsed();
    assert.equal(panel.panel.style.height, '500px');
    q('[data-act="collapse"]').click();
    assert.equal(panel.prefs.collapsed, true);
    assert.ok(panel.panel.classList.contains('collapsed'));
    assert.equal(panel.panel.style.height, '');
    assert.equal(panel.refs.collapse.textContent, '+');
    q('[data-act="collapse"]').click();
    assert.equal(panel.prefs.collapsed, false);
    assert.equal(panel.panel.style.height, '500px');

    // hide shows the bubble; bubble brings it back
    q('[data-act="hide"]').click();
    assert.equal(panel.panel.hidden, true);
    assert.equal(panel.bubble.hidden, false);
    panel.bubble.click();
    assert.equal(panel.panel.hidden, false);
    assert.equal(panel.bubble.hidden, true);

    const stored = JSON.parse(globalThis.localStorage.getItem(CT.STORAGE_KEY));
    assert.equal(stored.mode, 'mean');
    assert.equal(stored.legend, false);
  });
});

test('panel defers body re-render while a control is focused', { skip: !JSDOM && 'jsdom not installed (npm install)' }, () => {
  withDom(() => {
    delete CT.Panel;
    delete require.cache[require.resolve('../src/panel.js')];
    require('../src/panel.js');
    const game = sampleGame();
    const panel = new CT.Panel({ data: { snapshot: () => game.snapshot(), board: () => null, advice: () => null, diagnostics: () => null }, hooks: {} });
    assert.equal(panel.shadow.querySelector('[data-act="window"]').hidden, true, 'no window button without a hook');
    const select = panel.shadow.querySelector('.notice [data-field="you"]');
    select.focus();
    assert.equal(panel.shadow.activeElement, select);
    play(game, [row([name('Beth', '#223697'), text('got'), img('ore')])]);
    panel.render();
    assert.equal(panel.dirty, true);
    assert.equal(panel.shadow.querySelector('.notice [data-field="you"]'), select, 'body kept while focused');
    select.blur();
    panel.render();
    assert.equal(panel.dirty, false);
  });
});

test('your seven opens the Robber tab until the steal, then the previous tab returns', { skip: !JSDOM && 'jsdom not installed (npm install)' }, () => {
  withDom(() => {
    delete CT.Panel;
    delete require.cache[require.resolve('../src/panel.js')];
    require('../src/panel.js');
    const game = new CT.Game();
    play(game, [
      row([name('Ahab', '#e27174'), text('placed a'), img('settlement')]),
      row([name('Beth', '#223697'), text('placed a'), img('settlement')]),
      row([name('Beth', '#223697'), text('received starting resources'), img('ore'), img('grain')]),
    ]);
    game.setYou('Ahab', 'manual');
    const panel = new CT.Panel({ data: { snapshot: () => game.snapshot(), board: () => null, advice: () => null, diagnostics: () => null }, hooks: {} });
    const q = (sel) => panel.shadow.querySelector(sel);
    assert.equal(panel.prefs.tab, 'race');

    // an opponent's seven changes nothing
    play(game, [row([name('Beth', '#223697'), text('rolled'), img('dice_3'), img('dice_4')])]);
    panel.render();
    assert.equal(panel.prefs.tab, 'race');
    play(game, [row([name('Beth', '#223697'), text('moved Robber'), img('Robber'), text('to'), img('ore tile')])]);
    panel.render();

    // ours does, and the tab comes back after the steal
    play(game, [row([name('Ahab', '#e27174'), text('rolled'), img('dice_5'), img('dice_2')])]);
    panel.render();
    assert.equal(panel.prefs.tab, 'robber');
    assert.ok(panel.autoTab);
    assert.match(panel.refs.body.innerHTML, /your robber move/);
    panel.savePrefs();
    assert.equal(JSON.parse(globalThis.localStorage.getItem(CT.STORAGE_KEY)).tab, 'race', 'automatic switch not remembered');
    play(game, [row([name('Ahab', '#e27174'), text('moved Robber'), img('Robber'), text('to'), img('ore tile')])]);
    panel.render();
    assert.equal(panel.prefs.tab, 'robber');
    play(game, [row([text('You stole'), img('ore'), text('from'), name('Beth', '#223697')])]);
    panel.render();
    assert.equal(panel.prefs.tab, 'race');
    assert.equal(panel.autoTab, null);

    // a manual tab click during the phase wins
    play(game, [row([name('Ahab', '#e27174'), text('used'), text('Knight'), img('Knight')])]);
    panel.render();
    assert.equal(panel.prefs.tab, 'robber');
    q('[data-tab="race"]').click();
    assert.equal(panel.prefs.tab, 'race');
    assert.equal(panel.autoTab, null);
    panel.render();
    assert.equal(panel.prefs.tab, 'race');
  });
});
