'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT } = require('./helpers');
const { mapState, gameState, roomState, LAND } = require('./fixtures');
const { Board, BoardGeo: Geo, TILE, cornerKey: ck } = CT;

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const includes = (list, item) => list.some(x => same(x, item));

test('geometry is self-consistent (transcribed from colonist)', () => {
  for (const [x, y] of LAND) {
    for (const corner of Geo.faceCorners(x, y)) {
      assert.ok(includes(Geo.cornerFaces(...corner), [x, y]), `corner ${corner} must touch face ${x},${y}`);
    }
    for (const edge of Geo.faceEdges(x, y)) {
      for (const end of Geo.edgeEnds(...edge)) assert.ok(includes(Geo.faceCorners(x, y), end), `edge ${edge} end ${end} must be a corner of ${x},${y}`);
    }
    for (const corner of Geo.faceCorners(x, y)) {
      const adjacent = Geo.cornerAdjacent(...corner);
      for (const edge of Geo.cornerEdges(...corner)) {
        const ends = Geo.edgeEnds(...edge);
        assert.ok(includes(ends, corner), `edge ${edge} must end at corner ${corner}`);
        const other = ends.find(e => !same(e, corner));
        assert.ok(includes(adjacent, other), `other end ${other} must be adjacent to ${corner}`);
      }
    }
    for (const nb of Geo.faceNeighbors(x, y)) assert.ok(includes(Geo.faceNeighbors(...nb), [x, y]));
  }
  // every land corner touches at most 3 tiles and its 3 edges are distinct
  const b = new Board();
  b.applyMessage({ mapState: mapState() });
  for (const key of b.landCorners()) {
    assert.ok(b.cornerTiles(key).length <= 3);
    const edges = Geo.cornerEdges(...key.split(',').map(Number)).map(e => ck(...e));
    assert.equal(new Set(edges).size, 3);
  }
  assert.equal(b.landCorners().length, 54); // standard 19-hex island
});

test('full state then patches merge by index', () => {
  const b = new Board();
  assert.equal(b.ready, false);
  assert.equal(b.applyMessage({ gameState: gameState() }), true);
  assert.equal(b.ready, true);
  assert.equal(b.tiles.size, LAND.length + 18);
  assert.equal(b.tileAt(0, -1).type, TILE.Brick);
  assert.equal(b.tileAt(0, -1).number, 6);
  assert.equal(b.playerStates.get(1).discardLimit, 7);
  assert.equal(b.currentTurnColor, 1);

  // a patch that only names the corner index and the changed fields
  const full = { mapState: { tileCornerStates: { 12: { x: 1, y: 1, z: 0, owner: 0, buildingType: 0 } } } };
  b.applyMessage(full);
  assert.equal(b.buildingAt(ck(1, 1, 0)), null);
  const patch = { mapState: { tileCornerStates: { 12: { owner: 2, buildingType: 1 } } } };
  assert.equal(b.applyMessage(patch), true);
  assert.equal(b.buildingAt(ck(1, 1, 0)).owner, 2);
  assert.equal(b.applyMessage(patch), false); // same again: nothing changed
  const upgrade = { mapState: { tileCornerStates: { 12: { buildingType: 2 } } } };
  b.applyMessage(upgrade);
  assert.deepEqual(b.buildingCounts(2), { settlements: 0, cities: 1, roads: 0 });
  b.applyMessage({ mapState: { tileEdgeStates: { 3: { x: 1, y: 1, z: 0, owner: 2, type: 1 } } } });
  assert.deepEqual(b.roadsOf(2), [ck(1, 1, 0)]);
  b.applyMessage({ playerStates: { 2: { cardDiscardLimit: 9 } } });
  assert.equal(b.playerStates.get(2).discardLimit, 9);
  assert.equal(b.playerStates.get(1).discardLimit, 7);
});

test('room state gives settings, names and colours; handshake gives our colour', () => {
  const b = new Board();
  b.applyMessage({ type: 'Connected', userSessionId: 's-ahab' });
  assert.equal(b.mySessionId, 's-ahab');
  b.applyMessage(roomState());
  assert.equal(b.settings.vpToWin, 13);
  assert.equal(b.settings.discardLimit, 9);
  assert.equal(b.nameOf(1), 'Ahab');
  assert.equal(b.nameOf(2), 'Beth');
  assert.equal(b.colorOf('Beth'), 2);
  assert.equal(b.myColor, 1);
  assert.equal(b.summary().myName, 'Ahab');
  // a stray cardDiscardLimit inside a player state must not be taken as the room setting
  const c = new Board();
  c.applyMessage({ gameState: gameState({ playerStates: { 1: Object.assign({}, gameState().playerStates[1], { cardDiscardLimit: 11 }) } }) });
  assert.equal(c.settings.discardLimit, null);
  assert.equal(c.playerStates.get(1).discardLimit, 11);
});

test('corner production, ports, distance rule and reachability', () => {
  const b = new Board();
  b.applyMessage({ mapState: mapState() });
  const key = ck(1, 1, 0); // Ore 8, Wool 5, Lumber 3
  const tiles = b.cornerTiles(key).map(t => [t.res, t.number, t.pips]).sort();
  assert.deepEqual(tiles, [[0, 3, 2], [2, 5, 4], [4, 8, 5]]);
  assert.equal(b.isBuildable(key), true);

  // the ore port sits on edge (3,-1,SW): both its ends see it
  const [e1, e2] = Geo.edgeEnds(3, -1, 2).map(c => ck(...c));
  assert.equal(b.portAt(e1).res, 4);
  assert.equal(b.portAt(e2).res, 4);
  assert.equal(b.portAt(ck(0, -1, 0)), null);
  // the generic port (type 9) has no resource
  const [g1] = Geo.edgeEnds(-2, 2, 2).map(c => ck(...c));
  assert.equal(b.portAt(g1).res, null);

  // settlement at key blocks its three neighbours
  b.applyMessage({ mapState: { tileCornerStates: { 0: { x: 1, y: 1, z: 0, owner: 1, buildingType: 1 } } } });
  assert.equal(b.isBuildable(key), false);
  for (const adj of Geo.cornerAdjacent(1, 1, 0)) assert.equal(b.isBuildable(ck(...adj)), false);
  assert.equal(b.isBuildable(ck(-2, 2, 0)), true);

  // reachability: from the settlement, its neighbours cost one road each
  const reach = b.reachable(1, 2);
  assert.equal(reach.get(key), 0);
  for (const adj of Geo.cornerAdjacent(1, 1, 0)) assert.equal(reach.get(ck(...adj)), 1);
  // an own road makes the far corner free to reach
  const edge = Geo.cornerEdges(1, 1, 0)[0];
  b.applyMessage({ mapState: { tileEdgeStates: { 0: { x: edge[0], y: edge[1], z: edge[2], owner: 1, type: 1 } } } });
  const far = Geo.edgeEnds(...edge).map(c => ck(...c)).find(k => k !== key);
  assert.equal(b.reachable(1, 2).get(far), 0);
  // an opponent road blocks passage
  const otherEdge = Geo.cornerEdges(1, 1, 0)[1];
  b.applyMessage({ mapState: { tileEdgeStates: { 1: { x: otherEdge[0], y: otherEdge[1], z: otherEdge[2], owner: 2, type: 1 } } } });
  const blocked = Geo.edgeEnds(...otherEdge).map(c => ck(...c)).find(k => k !== key);
  const r2 = b.reachable(1, 1);
  assert.ok(!r2.has(blocked) || r2.get(blocked) > 1);

  const prod = b.productionOf(1);
  assert.deepEqual(prod.prod, [2, 0, 4, 0, 5]);
  assert.deepEqual(b.mapPips(), [13, 12, 10, 13, 10]);
});

test('colours from panel attributes and css, our colour from playerUserStates, shapes and restricted corners', () => {
  assert.equal(Board.colorFromAttr('1'), 1);
  assert.equal(Board.colorFromAttr('Red'), 1);
  assert.equal(Board.colorFromAttr('blue'), 2);
  assert.equal(Board.colorFromAttr('0'), null);
  assert.equal(Board.colorFromAttr('bogus'), null);
  assert.equal(Board.colorFromCss('#e27174'), 1);
  assert.equal(Board.colorFromCss('rgb(34, 54, 151)'), 2);
  assert.equal(Board.colorFromCss('#ffffff'), null);

  const b = new Board();
  b.applyMessage({ playerColor: 2, playerUserStates: [{ selectedColor: 1, username: 'Ahab' }, { selectedColor: 2, username: 'Beth' }], gameState: gameState() }, 130);
  assert.equal(b.myColor, 2);
  assert.equal(b.nameOf(2), 'Beth');
  assert.equal(b.summary().myName, 'Beth');
  const shapes = b.summary().shapes;
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].id, 130);
  assert.match(String(shapes[0].keys), /gameState/);
  // a stray playerColor inside some unrelated message is not taken as ours
  const c = new Board();
  c.applyMessage({ playerColor: 3, something: 1 });
  assert.equal(c.myColor, null);

  // starting-placement restriction only matters for the opening
  b.applyMessage({ mapState: { tileCornerStates: { 12: { x: 1, y: 1, z: 0, owner: 0, buildingType: 0, restrictedStartingPlacement: true } } } });
  assert.equal(b.isBuildable(ck(1, 1, 0)), true);
  assert.equal(b.isBuildable(ck(1, 1, 0), true), false);
});

test('development cards: our faces are known, opponents stay face down, patches replace the hand', () => {
  const b = new Board();
  b.applyMessage({ gameState: { mechanicDevelopmentCardsState: { bankDevelopmentCards: [10, 10, 10], players: { 1: { developmentCards: [11, 12, 12], developmentCardsUsed: [11] }, 2: { developmentCards: [10, 10], developmentCardsUsed: [] } } } } });
  assert.equal(b.bankDevCards, 3);
  assert.deepEqual(b.knownDevCards(1), { knight: 1, vp: 2, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0, total: 3 });
  assert.equal(b.knownDevCards(2), null);
  assert.equal(b.knownDevCards(3), null);
  assert.equal(b.applyMessage({ gameState: { mechanicDevelopmentCardsState: { players: { 1: { developmentCards: [12, 12] } } } } }), true);
  assert.deepEqual(b.knownDevCards(1), { knight: 0, vp: 2, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0, total: 2 });
  assert.equal(b.applyMessage({ gameState: { mechanicDevelopmentCardsState: { players: { 1: { developmentCards: [12, 12] } } } } }), false, 'same hand: no change');
  b.applyMessage({ playerColor: 1, playerUserStates: [{ selectedColor: 1, username: 'Ahab' }] });
  assert.deepEqual(b.summary().myDevCards, b.knownDevCards(1));
});

test('port types follow colonist\'s port enum, not the tile enum', () => {
  const b = new Board();
  const ports = {};
  for (let t = 1; t <= 6; t++) ports[t] = { x: 10 + t, y: 0, z: 0, type: t };
  b.applyMessage({ mapState: { portEdgeStates: ports } });
  const resOf = (t) => b.ports.get(ck(10 + t, 0, 0)).res;
  assert.equal(resOf(1), null, 'generic 3:1');
  assert.equal(resOf(2), 0, 'lumber');
  assert.equal(resOf(3), 1, 'brick');
  assert.equal(resOf(4), 2, 'wool');
  assert.equal(resOf(5), 3, 'grain');
  assert.equal(resOf(6), 4, 'ore');
  // a port state without a type is the generic port
  b.applyMessage({ mapState: { portEdgeStates: { 7: { x: 20, y: 0, z: 1 } } } });
  assert.equal(b.ports.get(ck(20, 0, 1)).res, null);
});
