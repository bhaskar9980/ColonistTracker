'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT } = require('./helpers');
const { mapState } = require('./fixtures');
const { Board, BoardGeo: Geo, cornerKey: ck, advise } = CT;

function boardWith(corners = [], edges = []) {
  const b = new Board();
  const tileCornerStates = {};
  corners.forEach(([x, y, z, owner, building], i) => { tileCornerStates[i] = { x, y, z, owner, buildingType: building }; });
  const tileEdgeStates = {};
  edges.forEach(([x, y, z, owner], i) => { tileEdgeStates[i] = { x, y, z, owner, type: 1 }; });
  b.applyMessage({ mapState: mapState({ tileCornerStates, tileEdgeStates }) });
  return b;
}

test('no advice without a board or a colour', () => {
  assert.equal(advise(new Board(), 1).phase, 'none');
  assert.equal(advise(boardWith(), null).phase, 'none');
});

test('opening: the best first settlement is the strong three-resource corner', () => {
  const b = boardWith();
  const a = advise(b, 1);
  assert.equal(a.phase, 'opening');
  assert.ok(a.suggestions.length === 5);
  for (let i = 1; i < a.suggestions.length; i++) assert.ok(a.suggestions[i - 1].score >= a.suggestions[i].score);
  assert.equal(a.suggestions[0].text, 'Ore 8, Sheep 5, Wood 3');
  assert.equal(a.suggestions[0].pips, 11);
  assert.ok(a.suggestions[0].why.some(w => /3 different resources/.test(w)));
  assert.ok(a.considered > 40);
});

test('opening: the second settlement complements the first', () => {
  const b = boardWith([[1, 1, 0, 1, 1]]); // we already sit on Ore 8, Sheep 5, Wood 3
  const a = advise(b, 1);
  assert.equal(a.phase, 'opening');
  assert.equal(a.counts.settlements, 1);
  assert.equal(a.suggestions[0].text, 'Wheat 6, Brick 5, Ore 3');
  assert.ok(a.suggestions[0].why.some(w => /adds Brick and Wheat/.test(w)));
  assert.ok(a.suggestions[0].why.some(w => /Ore \+ Wheat engine/.test(w)));
  // neighbours of our settlement are never suggested
  const banned = new Set(Geo.cornerAdjacent(1, 1, 0).map(c => ck(...c)));
  for (const s of a.suggestions) assert.ok(!banned.has(s.key));
});

test('expansion: suggestions are reachable, legal and priced in roads', () => {
  const road = Geo.cornerEdges(1, 1, 0)[0];
  const b = boardWith([[1, 1, 0, 1, 1], [-1, 1, 1, 1, 1], [0, -1, 0, 2, 1]], [[road[0], road[1], road[2], 1]]);
  const a = advise(b, 1, { maxRoads: 3, top: 6 });
  assert.equal(a.phase, 'expand');
  assert.ok(a.suggestions.length > 0);
  const reach = b.reachable(1, 3);
  for (const s of a.suggestions) {
    assert.ok(b.isBuildable(s.key), 'must be legal');
    assert.ok(reach.has(s.key) && reach.get(s.key) <= 3, 'must be reachable');
    assert.equal(s.roads, reach.get(s.key));
    assert.ok(s.why.some(w => /road|build here now/.test(w)));
  }
  assert.ok(a.strategy.text.length > 20);
});

test('strategy reads the lean of your production', () => {
  const ow = boardWith([[1, 1, 0, 1, 1], [-1, 1, 1, 1, 1]]); // ore 8 + ore 3 + wheat 6 heavy
  assert.equal(CT.adviseStrategy(ow, 1).lean, 'ore-wheat');
  const wb = boardWith([[-2, 2, 0, 1, 1], [0, -1, 0, 1, 1]]); // wood 8, brick 5 + brick 6, ore 10, sheep 2
  const s = CT.adviseStrategy(wb, 1);
  assert.equal(s.lean, 'wood-brick');
  assert.ok(s.missing.includes('Wheat'));
  assert.match(s.text, /produce no Wheat/);
});
