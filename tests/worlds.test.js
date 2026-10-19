'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT, counts } = require('./helpers');
const { Worlds } = CT;

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('deterministic gains and spends keep a single world', () => {
  const w = new Worlds(2);
  w.gain(0, counts({ lumber: 2, brick: 1 }));
  w.exchange(0, counts({ lumber: 1, brick: 1 }));
  assert.equal(w.size, 1);
  const s = w.summary();
  assert.equal(s[0].res[0].min, 1);
  assert.equal(s[0].res[1].max, 0);
});

test('hidden steal branches by resource proportion', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ ore: 3, grain: 1 }));
  w.stealUnknown(0, 1);
  assert.equal(w.size, 2);
  const s = w.summary();
  close(s[0].res[4].pHas, 0.75);
  close(s[0].res[3].pHas, 0.25);
  close(s[0].res[4].mean, 0.75);
  assert.equal(s[0].total.min, 1);
  assert.equal(s[0].total.max, 1);
  assert.equal(s[1].total.min, 3);
  close(s[1].res[4].mean, 2.25);
});

test('later spending resolves a hidden steal', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ ore: 1, grain: 1 }));
  w.stealUnknown(0, 1);
  assert.equal(w.size, 2);
  // victim later pays ore -> they must have kept the ore -> thief took grain
  w.exchange(1, counts({ ore: 1 }));
  assert.equal(w.size, 1);
  const s = w.summary();
  assert.equal(s[0].res[3].min, 1);
  assert.equal(s[0].res[4].max, 0);
  assert.equal(w.contradictions, 0);
});

test('trade offer is a soft constraint', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ ore: 1, grain: 1 }));
  w.stealUnknown(0, 1);
  w.requireAtLeast(0, counts({ grain: 1 })); // thief offers grain -> stole grain
  assert.equal(w.size, 1);
  assert.equal(w.summary()[0].res[3].min, 1);
  // an impossible offer is ignored rather than wiping the state
  w.requireAtLeast(0, counts({ brick: 5 }));
  assert.equal(w.size, 1);
  assert.equal(w.ignoredConstraints, 1);
});

test('monopoly total prunes inconsistent worlds', () => {
  const w = new Worlds(3);
  w.gain(1, counts({ brick: 1, ore: 1 }));
  w.gain(2, counts({ brick: 1 }));
  w.stealUnknown(0, 1); // player 0 took brick or ore from player 1
  assert.equal(w.size, 2);
  // player 2 monopolises brick and gets 2 -> players 0 and 1 held 2 brick between them,
  // which is true in both worlds (0 has brick & 1 none, or 0 has ore & 1 has brick).
  w.monopoly(2, 1, 2);
  assert.equal(w.size, 2);
  const s = w.summary();
  assert.equal(s[2].res[1].min, 3);
  // ...but afterwards, player 0 either holds ore or nothing
  assert.equal(s[0].total.min, 0);
  assert.equal(s[0].total.max, 1);
  assert.equal(s[1].total.min, 0);
  assert.equal(s[1].total.max, 1);
});

test('panel hand counts disambiguate post-monopoly hands', () => {
  const w = new Worlds(3);
  w.gain(1, counts({ brick: 1, ore: 1 }));
  w.gain(2, counts({ brick: 1 }));
  w.stealUnknown(0, 1);
  w.monopoly(2, 1, 2);
  assert.equal(w.constrainTotals([null, null, null]), 'noop');
  assert.equal(w.constrainTotals([1, 0, 3]), 'pruned'); // player 0 kept 1 card -> it is the ore
  assert.equal(w.size, 1);
  assert.equal(w.summary()[0].res[4].min, 1);
  assert.equal(w.constrainTotals([5, 0, 3]), 'conflict');
  assert.equal(w.size, 1);
});

test('contradictions are force-applied instead of wiping the state', () => {
  const w = new Worlds(1);
  w.gain(0, counts({ lumber: 1 }));
  w.exchange(0, counts({ lumber: 1, brick: 1 })); // brick was never seen
  assert.equal(w.contradictions, 1);
  assert.equal(w.size, 1);
  const s = w.summary();
  assert.equal(s[0].total.max, 0);
});

test('hypothesis cap keeps the most likely worlds', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ lumber: 6, brick: 6, wool: 6, grain: 6, ore: 6 }));
  for (let i = 0; i < 12; i++) w.stealUnknown(0, 1);
  assert.ok(w.size <= CT.MAX_WORLDS);
  const s = w.summary();
  assert.equal(s[0].total.min, 12);
  assert.equal(s[0].total.max, 12);
  let sum = 0;
  for (const world of w.worlds.values()) sum += world.w;
  close(sum, 1, 1e-6);
});

test('stealOdds and inPlay', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ ore: 3, grain: 1 }));
  const { odds, pHasCards } = w.stealOdds(1);
  close(odds[4], 0.75);
  close(pHasCards, 1);
  assert.deepEqual(w.inPlay(), counts({ ore: 3, grain: 1 }));
  assert.deepEqual(w.stealOdds(0).odds, [0, 0, 0, 0, 0]);
});

test('affordOdds averages over worlds', () => {
  const w = new Worlds(2);
  w.gain(1, counts({ ore: 3, grain: 2, wool: 1 }));
  w.stealUnknown(0, 1); // ore taken 1/2, grain 1/3, wool 1/6
  // a city (3 ore, 2 grain) is still affordable only if the wool was taken
  close(w.affordOdds(1, CT.COSTS.city), 1 / 6);
  close(w.affordOdds(1, CT.COSTS.dev), 5 / 6); // dev card fails only when the wool was taken
});
