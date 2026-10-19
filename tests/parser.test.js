'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT, name, text, img, row, counts } = require('./helpers');
const { parseRow } = CT;

test('placed settlement / road during setup', () => {
  const ev = parseRow(row([name('Madel', '#223697'), text('placed a'), img('settlement')]));
  assert.equal(ev.type, 'placeSettlement');
  assert.equal(ev.player, 'Madel');
  assert.equal(ev.color, '#223697');
  assert.equal(parseRow(row([name('Madel'), text('placed a'), img('road')])).type, 'placeRoad');
});

test('starting resources and roll income', () => {
  const start = parseRow(row([name('Ahab'), text('received starting resources'), img('Lumber'), img('Grain')]));
  assert.equal(start.type, 'gain');
  assert.equal(start.source, 'start');
  assert.deepEqual(start.res, counts({ lumber: 1, grain: 1 }));

  const got = parseRow(row([name('Ahab'), text('got'), img('ore'), img('ore'), img('wool')]));
  assert.equal(got.type, 'gain');
  assert.equal(got.source, 'roll');
  assert.deepEqual(got.res, counts({ ore: 2, wool: 1 }));
});

test('dice roll', () => {
  const ev = parseRow(row([name('Canada'), text('rolled'), img('dice_3'), img('dice_4')]));
  assert.equal(ev.type, 'roll');
  assert.deepEqual(ev.dice, [3, 4]);
  assert.equal(ev.sum, 7);
  // chat-like "rolled" without dice images is ignored
  assert.equal(parseRow(row([name('Canada'), text('i rolled so badly')])), null);
});

test('player trade splits gave / got around "and got" and "from"', () => {
  const ev = parseRow(row([
    name('Freed#4231'), text('gave'), img('Lumber'), img('Lumber'), text('and got'), img('Brick'), text('from'), name('xashuma'),
  ]));
  assert.equal(ev.type, 'trade');
  assert.equal(ev.player, 'Freed#4231');
  assert.equal(ev.partner, 'xashuma');
  assert.deepEqual(ev.gave, counts({ lumber: 2 }));
  assert.deepEqual(ev.got, counts({ brick: 1 }));
});

test('bank trade', () => {
  const ev = parseRow(row([name('Lek'), text('gave bank'), img('wool'), img('wool'), img('wool'), img('wool'), text('and took'), img('ore')]));
  assert.equal(ev.type, 'bankTrade');
  assert.deepEqual(ev.gave, counts({ wool: 4 }));
  assert.deepEqual(ev.got, counts({ ore: 1 }));
});

test('steals: hidden, known, you as thief, you as victim', () => {
  const hidden = parseRow(row([name('Canada'), text('stole'), img('card'), text('from'), name('Ahab')]));
  assert.equal(hidden.type, 'steal');
  assert.equal(hidden.thief, 'Canada');
  assert.equal(hidden.victim, 'Ahab');
  assert.equal(hidden.res, null);

  const youThief = parseRow(row([text('You stole'), img('Ore'), text('from'), name('Dumah')]));
  assert.equal(youThief.type, 'steal');
  assert.equal(youThief.youAreThief, true);
  assert.equal(youThief.victim, 'Dumah');
  assert.equal(youThief.res, 4);

  const youVictim = parseRow(row([name('Dumah'), text('stole'), img('Brick'), text('from you')]));
  assert.equal(youVictim.youAreVictim, true);
  assert.equal(youVictim.thief, 'Dumah');
  assert.equal(youVictim.res, 1);

  // a chat line with the word "stole" but no card image is not a steal
  assert.equal(parseRow(row([name('Dumah'), text('lol stole it from you')])), null);
});

test('monopoly total', () => {
  const ev = parseRow(row([name('xashuma'), text('stole 2'), img('brick')]));
  assert.equal(ev.type, 'monopoly');
  assert.equal(ev.count, 2);
  assert.equal(ev.res, 1);
  assert.equal(ev.victim, null);
});

test('development cards: buy and use', () => {
  assert.equal(parseRow(row([name('xashuma'), text('bought'), img('development card')])).type, 'buyDev');
  const used = parseRow(row([name('Freed#4231'), text('used'), text('Knight'), img('Knight')]));
  assert.equal(used.type, 'useDev');
  assert.equal(used.card, 'knight');
  assert.equal(parseRow(row([name('x'), text('used'), text('Year of Plenty'), img('Year of Plenty')])).card, 'yearOfPlenty');
  assert.equal(parseRow(row([name('x'), text('used'), text('Road Building'), img('Road Building')])).card, 'roadBuilding');
  assert.equal(parseRow(row([name('x'), text('used'), text('Monopoly'), img('Monopoly')])).card, 'monopoly');
  // chat message mentioning a card is not a play
  assert.equal(parseRow(row([name('x'), text('he used knight lol')])).type, 'unknown');
});

test('year of plenty take, discards, offers', () => {
  const yop = parseRow(row([name('x'), text('took from bank'), img('ore'), img('grain')]));
  assert.equal(yop.type, 'gain');
  assert.equal(yop.source, 'yearOfPlenty');
  const disc = parseRow(row([name('Lek'), text('discarded'), img('wool'), img('wool'), img('lumber'), img('brick')]));
  assert.equal(disc.type, 'discard');
  assert.deepEqual(disc.res, counts({ wool: 2, lumber: 1, brick: 1 }));
  const offer = parseRow(row([name('Lek'), text('wants to give'), img('ore'), text('for'), img('grain'), img('grain')]));
  assert.equal(offer.type, 'offer');
  assert.deepEqual(offer.offered, counts({ ore: 1 }));
  assert.deepEqual(offer.wanted, counts({ grain: 2 }));
  const counter = parseRow(row([name('A'), text('proposed counter offer to'), name('B'), img('brick'), text('for'), img('ore')]));
  assert.equal(counter.type, 'offer');
  assert.equal(counter.target, 'B');
  assert.deepEqual(counter.offered, counts({ brick: 1 }));
});

test('building', () => {
  assert.deepEqual(parseRow(row([name('Lek'), text('built a'), img('Road')])).what, 'road');
  assert.deepEqual(parseRow(row([name('Lek'), text('built a'), img('Settlement'), text('(+1 VP)')])).what, 'settlement');
  assert.deepEqual(parseRow(row([name('Lek'), text('built a'), img('City'), text('(+1 VP)')])).what, 'city');
});

test('awards, robber, game over, blocked, noise', () => {
  assert.equal(parseRow(row([name('Lek'), text('received Longest Road'), text('(+2 VPs)')])).award, 'longestRoad');
  assert.equal(parseRow(row([name('x'), text('received Largest Army'), text('(+2 VPs)')])).award, 'largestArmy');
  const lost = parseRow(row([name('x'), text('lost Longest Road'), text('(-2 VPs)')]));
  assert.equal(lost.award, 'longestRoad');
  assert.equal(lost.lost, true);
  // colonist logs a transfer as one line naming the old and the new holder
  const passed = parseRow(row([img('Longest Road'), text('Longest Road passed from'), name('Ahab'), text('to'), name('Beth'), text('(+2 VPs)')]));
  assert.equal(passed.type, 'award');
  assert.equal(passed.award, 'longestRoad');
  assert.equal(passed.player, 'Beth');
  assert.equal(passed.from, 'Ahab');
  const army = parseRow(row([text('Largest Army passed from'), name('Ahab'), text('to'), name('Beth'), text('(+2 VPs)')]));
  assert.equal(army.award, 'largestArmy');
  assert.equal(army.player, 'Beth');
  assert.equal(parseRow(row([name('x'), text('received Longest Trade Route'), text('(+2 VPs)')])).award, 'longestRoad');
  assert.equal(parseRow(row([name('Lek'), text('moved Robber'), img('Robber'), text('to'), img('grain tile')])).type, 'moveRobber');
  assert.equal(parseRow(row([name('x'), text('won the game!')])).type, 'gameOver');
  const blocked = parseRow(row([img('prob_6'), img('wool tile'), text('is blocked by the Robber. No resources produced')]));
  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.num, 6);
  assert.equal(blocked.res, 2);
  assert.equal(parseRow({ index: 1, tokens: [], separator: true }), null);
  assert.equal(parseRow(row([text('Happy settling! Learn how to play in the rulebook.')])), null);
  assert.equal(parseRow(row([name('x'), text('has disconnected. A bot will take over next turn unless x reconnects.')])), null);
  assert.equal(parseRow(row([text('No player to steal from')])), null);
  assert.equal(parseRow(row([text('Bot is selecting cards to discard for'), name('Lek')])), null);
});
