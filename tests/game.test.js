'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT, name, text, img, row, play, counts } = require('./helpers');

const A = () => name('Ahab', '#e27174');
const B = () => name('Beth', '#223697');
const C = () => name('Cleo', '#62b95a');

function setupGame() {
  const g = new CT.Game();
  play(g, [
    row([A(), text('placed a'), img('settlement')]),
    row([A(), text('placed a'), img('road')]),
    row([B(), text('placed a'), img('settlement')]),
    row([B(), text('placed a'), img('road')]),
    row([C(), text('placed a'), img('settlement')]),
    row([C(), text('placed a'), img('road')]),
    row([C(), text('placed a'), img('settlement')]),
    row([C(), text('received starting resources'), img('ore'), img('ore'), img('grain')]),
    row([B(), text('placed a'), img('settlement')]),
    row([B(), text('received starting resources'), img('lumber'), img('brick'), img('wool')]),
    row([A(), text('placed a'), img('settlement')]),
    row([A(), text('received starting resources'), img('grain'), img('wool')]),
  ]);
  return g;
}

test('setup: players, colours, starting hands, 2 VP each', () => {
  const g = setupGame();
  const s = g.snapshot();
  assert.deepEqual(s.players.map(p => p.name), ['Ahab', 'Beth', 'Cleo']);
  assert.equal(s.players[0].color, '#e27174');
  assert.equal(s.players[2].hand.res[4].min, 2);
  assert.equal(s.players[1].handSize.min, 3);
  for (const p of s.players) assert.equal(p.visibleVP, 2);
  assert.deepEqual(s.bank, [18, 18, 17, 17, 17]);
  assert.equal(s.deck.deck, 25);
});

test('roll, build, dev cards, awards and VP', () => {
  const g = setupGame();
  play(g, [
    row([A(), text('rolled'), img('dice_4'), img('dice_4')]),
    row([A(), text('got'), img('lumber'), img('brick')]),
    row([A(), text('built a'), img('road')]),
    row([A(), text('rolled'), img('dice_6'), img('dice_5')]),
    row([A(), text('got'), img('ore'), img('ore'), img('ore'), img('grain')]),
    row([A(), text('built a'), img('city'), text('(+1 VP)')]),
    row([A(), text('got'), img('ore'), img('grain')]),
    row([A(), text('bought'), img('development card')]),
    row([A(), text('used'), text('Knight'), img('Knight')]),
    row([A(), text('received Largest Army'), text('(+2 VPs)')]),
    row([B(), text('received Longest Road'), text('(+2 VPs)')]),
    row([A(), text('received Longest Road'), text('(+2 VPs)')]),
  ]);
  const s = g.snapshot();
  const a = s.players[0];
  assert.equal(a.roads, 2);
  assert.equal(a.cities, 1);
  assert.equal(a.settlements, 1);
  assert.equal(a.visibleVP, 1 + 2 + 2 + 2);
  assert.equal(a.devBought, 1);
  assert.equal(a.knights, 1);
  assert.equal(a.unplayedDev, 0);
  assert.equal(s.players[1].longestRoad, false);
  assert.equal(a.longestRoad, true);
  play(g, [row([A(), text('lost Longest Road'), text('(-2 VPs)')])]);
  assert.equal(g.snapshot().players[0].visibleVP, 5);
  assert.equal(g.snapshot().awards.longestRoad, null);
  // a transfer: Ahab gets it back, then it passes to Beth in a single log line
  const bethBefore = g.snapshot().players[1].visibleVP;
  play(g, [
    row([A(), text('received Longest Road'), text('(+2 VPs)')]),
    row([img('Longest Road'), text('Longest Road passed from'), A(), text('to'), B(), text('(+2 VPs)')]),
  ]);
  const t = g.snapshot();
  assert.equal(t.awards.longestRoad, 'Beth');
  assert.equal(t.players[0].longestRoad, false);
  assert.equal(t.players[1].longestRoad, true);
  assert.equal(t.players[0].visibleVP, 5);
  assert.equal(t.players[1].visibleVP, bethBefore + 2);
  assert.equal(s.dice[8], 1);
  assert.equal(s.dice[11], 1);
  assert.equal(s.rolls, 2);
  assert.equal(a.rolls, 2);
  assert.equal(s.deck.deck, 24);
  assert.equal(s.deck.remaining.knight, 13);
  assert.equal(s.contradictions, 0);
  // Ahab had G,W + L,B + 3O,G + O,G and spent road (L,B), city (2G,3O), dev (W,G,O): nothing left
  assert.deepEqual(a.hand.res.map(r => r.min), counts({}));
  assert.equal(a.handSize.max, 0);
});

test('road building gives two free roads', () => {
  const g = setupGame();
  play(g, [
    row([B(), text('bought'), img('development card')]), // Beth has L,B,W: cannot afford -> contradiction, but keeps going
    row([B(), text('used'), text('Road Building'), img('Road Building')]),
    row([B(), text('built a'), img('road')]),
    row([B(), text('built a'), img('road')]),
  ]);
  const b = g.snapshot().players[1];
  assert.equal(b.roads, 3);
  // lumber and brick were not spent on the free roads
  assert.equal(b.hand.res[0].min, 1);
  assert.equal(b.hand.res[1].min, 1);
});

test('hidden steal then resolution by spending', () => {
  const g = setupGame();
  play(g, [
    row([B(), text('rolled'), img('dice_3'), img('dice_4')]),
    row([B(), text('moved Robber'), img('Robber'), text('to'), img('ore tile')]),
    row([B(), text('stole'), img('card'), text('from'), name('Cleo')]),
  ]);
  let s = g.snapshot();
  assert.equal(s.worlds, 2);
  const b = s.players[1];
  assert.ok(Math.abs(b.hand.res[4].pHas - 2 / 3) < 1e-9);
  assert.equal(b.handSize.min, 4);
  assert.equal(b.handSize.max, 4);
  // Cleo later trades a grain away -> she kept her grain -> Beth must have taken ore
  play(g, [
    row([A(), text('got'), img('lumber')]),
    row([C(), text('gave'), img('grain'), text('and got'), img('lumber'), text('from'), name('Ahab')]),
  ]);
  s = g.snapshot();
  assert.equal(s.worlds, 1);
  assert.equal(s.players[1].hand.res[4].min, 1);
  assert.equal(s.players[2].hand.res[0].min, 1);
  assert.equal(s.players[2].hand.res[4].min, 1);
  assert.equal(s.players[0].hand.res[3].min, 2);
  assert.equal(s.players[0].hand.res[0].max, 0);
  assert.equal(s.contradictions, 0);
});

test('"You stole" is attributed to the robber mover and infers who you are', () => {
  const g = setupGame();
  play(g, [
    row([A(), text('rolled'), img('dice_3'), img('dice_4')]),
    row([A(), text('moved Robber'), img('Robber'), text('to'), img('ore tile')]),
    row([text('You stole'), img('Ore'), text('from'), name('Cleo')]),
  ]);
  const s = g.snapshot();
  assert.equal(s.you, 'Ahab');
  assert.equal(s.youSource, 'inferred');
  assert.equal(s.players[0].hand.res[4].min, 1);
  assert.equal(s.players[2].hand.res[4].min, 1);
  assert.equal(s.worlds, 1);
});

test('"stole from you" before you are known is fixed by replay', () => {
  const g = setupGame();
  play(g, [
    row([B(), text('rolled'), img('dice_3'), img('dice_4')]),
    row([B(), text('moved Robber'), img('Robber'), text('to'), img('ore tile')]),
    row([B(), text('stole'), img('Grain'), text('from you')]),
  ]);
  let s = g.snapshot();
  assert.equal(s.pendingYouSteals, 1);
  assert.equal(s.players[1].hand.res[3].min, 1); // gain still counted for thief
  g.setYou('Ahab', 'header');
  s = g.snapshot();
  assert.equal(s.pendingYouSteals, 0);
  assert.equal(s.players[0].hand.res[3].min, 0);
  assert.equal(s.players[0].isYou, true);
  assert.equal(s.players[1].hand.res[3].min, 1);
  assert.equal(s.eventCount, 15);
});

test('monopoly, discard, bank trade, offers and panel counts', () => {
  const g = setupGame();
  play(g, [
    row([A(), text('used'), text('Monopoly'), img('Monopoly')]),
    row([A(), text('stole 1'), img('wool')]),   // Beth's wool
  ]);
  let s = g.snapshot();
  assert.equal(s.players[0].hand.res[2].min, 2);
  assert.equal(s.players[1].hand.res[2].max, 0);
  play(g, [
    row([A(), text('gave bank'), img('wool'), img('wool'), img('grain'), text('and took'), img('brick')]), // not a legal ratio, but arithmetic is what matters
    row([A(), text('discarded'), img('brick')]),
    row([B(), text('wants to give'), img('lumber'), text('for'), img('ore')]),
  ]);
  s = g.snapshot();
  assert.equal(s.players[0].handSize.min, 0);
  assert.equal(s.players[0].discarded, 1);
  assert.equal(s.players[0].tradesWithBank, 1);
  assert.equal(s.contradictions, 0);
  assert.equal(g.applyPanelCounts({ Ahab: 0, Beth: 2, Cleo: 3 }), 'noop');
  assert.equal(g.applyPanelCounts({ Ahab: 4 }), 'conflict');
  assert.equal(g.snapshot().desync, true);
  assert.equal(g.applyPanelCounts({ Ahab: 0 }), 'noop');
  assert.equal(g.snapshot().desync, false);
});

test('over-limit flag, robber odds and unknown lines', () => {
  const g = setupGame();
  play(g, [
    row([C(), text('got'), img('ore'), img('ore'), img('ore'), img('ore'), img('ore')]),
    row([C(), text('lol what a roll')]),
  ]);
  const s = g.snapshot();
  const c = s.players[2];
  assert.equal(c.handSize.min, 8);
  assert.equal(c.overLimit, true);
  assert.ok(Math.abs(c.stealOdds.odds[4] - 7 / 8) < 1e-9);
  assert.equal(s.unknownCount, 1);
  assert.equal(c.afford.city, 0); // 7 ore, 1 grain: needs 2 grain
  assert.equal(s.players[1].afford.road, 1); // Beth holds lumber + brick
  assert.equal(s.players[1].afford.settlement, 0);
});

test('who-you-are sources rank inferred < header < panel < session < manual', () => {
  const g = setupGame();
  assert.equal(g.setYou('Ahab', 'inferred'), true);
  assert.equal(g.setYou('Beth', 'header'), true);
  assert.equal(g.setYou('Ahab', 'inferred'), false, 'weaker source cannot override');
  assert.equal(g.you, 'Beth');
  assert.equal(g.setYou('Beth', 'panel'), false, 'same name: no change, but the source upgrades');
  assert.equal(g.youSource, 'panel');
  assert.equal(g.setYou('Ahab', 'session'), true);
  assert.equal(g.setYou('Beth', 'panel'), false);
  assert.equal(g.setYou('Beth', 'manual'), true);
  assert.equal(g.setYou('Ahab', 'session'), false, 'nothing overrides a manual choice');
  assert.equal(g.you, 'Beth');
});

test('settings: sources rank default < ui < game < manual, and per-player discard limits apply', () => {
  const g = setupGame();
  assert.equal(g.settings.vpToWin, 10);
  assert.equal(g.setSetting('vpToWin', 12, 'ui'), true);
  assert.equal(g.setSetting('vpToWin', 11, 'default'), false, 'weaker source cannot override');
  assert.equal(g.setSetting('vpToWin', 13, 'game'), true);
  assert.equal(g.setSetting('vpToWin', 12, 'ui'), false);
  assert.equal(g.setSetting('vpToWin', 15, 'manual'), true);
  assert.equal(g.setSetting('vpToWin', 13, 'game'), false);
  assert.equal(g.setSetting('vpToWin', 0, 'manual'), false, 'rejects nonsense');
  assert.equal(g.setSetting('bogus', 5, 'manual'), false);
  g.clearManualSettings();
  assert.equal(g.settings.vpToWin, 10);
  assert.equal(g.settings.sources.vpToWin, 'default');
  assert.equal(g.setSetting('vpToWin', 13, 'game'), true);

  g.setSetting('discardLimit', 9, 'game');
  play(g, [row([C(), text('got'), img('ore'), img('ore'), img('ore'), img('ore'), img('ore')])]); // Cleo: 8 cards
  let s = g.snapshot();
  assert.equal(s.players[2].handSize.min, 8);
  assert.equal(s.players[2].overLimit, false, '8 cards is fine when the limit is 9');
  assert.equal(s.players[2].discardLimit, 9);
  g.setPlayerDiscardLimit('Cleo', 7);
  s = g.snapshot();
  assert.equal(s.players[2].overLimit, true);
  assert.equal(s.players[2].discardLimit, 7);
  assert.equal(s.players[1].discardLimit, 9);
  g.setColorMap({ 1: 'Ahab', 2: 'Beth', 4: 'Cleo' });
  assert.equal(g.snapshot().players[2].colorEnum, 4);
  assert.equal(g.colorEnumFor('nobody'), null);
});

test('a seven or a knight opens the robber phase for that player until the steal', () => {
  const g = setupGame();
  play(g, [row([A(), text('rolled'), img('dice_3'), img('dice_4')])]);
  assert.equal(g.snapshot().robberPending.player, 'Ahab');
  assert.equal(g.snapshot().robberPending.moved, false);
  play(g, [row([A(), text('moved Robber'), img('Robber'), text('to'), img('ore tile')])]);
  assert.equal(g.snapshot().robberPending.moved, true);
  play(g, [row([A(), text('stole'), img('card'), text('from'), B()])]);
  assert.equal(g.snapshot().robberPending, null);
  play(g, [row([B(), text('rolled'), img('dice_2'), img('dice_4')])]);
  assert.equal(g.snapshot().robberPending, null);
  play(g, [row([B(), text('used'), text('Knight'), img('Knight')])]);
  assert.equal(g.snapshot().robberPending.player, 'Beth');
  play(g, [row([A(), text('rolled'), img('dice_2'), img('dice_4')])]);
  assert.equal(g.snapshot().robberPending, null, 'the next roll ends it even without a steal');
});

test('known development cards make our points exact', () => {
  const g = setupGame();
  play(g, [row([A(), text('bought'), img('development card')]), row([A(), text('bought'), img('development card')])]);
  let a = g.snapshot().players[0];
  assert.equal(a.unplayedDev, 2);
  assert.equal(a.maxVP, a.visibleVP + 2);
  assert.equal(a.knownDev, null);
  const known = { knight: 1, vp: 1, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0, total: 2 };
  assert.equal(g.setKnownDevCards('Ahab', known), true);
  assert.equal(g.setKnownDevCards('Ahab', known), false, 'no change twice');
  a = g.snapshot().players[0];
  assert.equal(a.maxVP, a.visibleVP + 1);
  assert.equal(a.unplayedDev, 2);
  assert.deepEqual(a.knownDev, known);
  g.replay();
  assert.deepEqual(g.snapshot().players[0].knownDev, known, 'survives a replay');
  assert.equal(g.setKnownDevCards('Ahab', null), true);
  assert.equal(g.snapshot().players[0].knownDev, null);
});
