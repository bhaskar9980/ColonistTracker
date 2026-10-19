'use strict';
// Exercises the DOM tokenizer against markup shaped like colonist's real log
// rows. Requires the optional jsdom dev-dependency (npm install); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT } = require('./helpers');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* optional */ }

const NAME = (n, c) => `<span style="font-weight: 600; word-break: break-all; color: ${c}">${n}</span>`;
const ICON = (alt, file) => `<img src="https://cdn.colonist.io/dist/assets/${file}.svg" alt="${alt}" height="20" width="14.25" class="lobby-chat-text-icon">`;
const AVATAR = '<div class="k26ZLqas5rMgu8g4jBGm"><img class="JNCoQelYM6It4m72cNuo" src="https://cdn.colonist.io/dist/assets/icon_bot.svg"></div>';
const ROW = (index, inner) => `<div data-index="${index}" class="WXX2rkzfmlng07nb2Tqi" style="transform: translateY(0px)"><div class="O8TLknGehHkVfT5IRcHW" style="opacity: 1">${inner}</div></div>`;

const FIXTURE = [
  ROW(0, '<span>Happy settling! Learn how to play in the <a href="#open-rulebook">rulebook</a>. <br>List of commands: /help</span>'),
  ROW(1, '<span><hr></span>'),
  ROW(2, `${AVATAR}<span>${NAME('Madel', '#223697')} placed a ${ICON('settlement', 'settlement_blue')}</span>`),
  ROW(3, `${AVATAR}<span>${NAME('Madel', '#223697')} received starting resources ${ICON('Lumber', 'card_lumber')}${ICON('Brick', 'card_brick')}</span>`),
  ROW(4, `${AVATAR}<span>${NAME('Madel', '#223697')} rolled ${ICON('dice_3', 'dice_3')} ${ICON('dice_4', 'dice_4')}</span>`),
  ROW(5, `${AVATAR}<span>${NAME('Freed#4231', '#e27174')} gave ${ICON('Lumber', 'card_lumber')} and got ${ICON('Brick', 'card_brick')} from ${NAME('xashuma', '#3e3e3e')}</span>`),
  ROW(6, `${AVATAR}<span>${NAME('Canada', '#e09742')} stole ${ICON('card', 'card_rescardback')} from ${NAME('Ahab', '#e27174')}</span>`),
  ROW(7, `${AVATAR}<span>You stole ${ICON('Ore', 'card_ore')} from ${NAME('Dumah', '#e27174')}</span>`),
  ROW(8, `${AVATAR}<span>${NAME('xashuma', '#3e3e3e')} used </span><div class="LSJLRWEF4socTUrxmJ85"><span> Monopoly ${ICON('Monopoly', 'card_monopoly')}</span></div><span></span>`),
  ROW(9, `${AVATAR}<span>${NAME('xashuma', '#3e3e3e')} stole 2 ${ICON('brick', 'card_brick')}</span>`),
  ROW(10, `<span>${ICON('prob_6', 'prob_6')} ${ICON('wool tile', 'tile_wool')} is blocked by the Robber. No resources produced</span>`),
  ROW(11, `${AVATAR}<span>${NAME('Lek', '#62b95a')} built a ${ICON('City', 'city_green')} <span>(+1 VP)</span></span>`),
].join('');

test('tokenizer + parser on colonist-shaped rows', { skip: !JSDOM && 'jsdom not installed (npm install)' }, () => {
  const dom = new JSDOM(`<!doctype html><body><div id="log">${FIXTURE}</div></body>`);
  const rows = Array.from(dom.window.document.querySelectorAll('[data-index]')).map(el => CT.tokenizeRow(el));
  assert.equal(rows.length, 12);
  assert.equal(rows[1].separator, true);
  assert.equal(CT.parseRow(rows[0]), null);
  assert.equal(CT.parseRow(rows[1]), null);

  const placed = CT.parseRow(rows[2]);
  assert.equal(placed.type, 'placeSettlement');
  assert.equal(placed.player, 'Madel');
  assert.match(placed.color, /rgb\(34, 54, 151\)|#223697/);

  const start = CT.parseRow(rows[3]);
  assert.equal(start.type, 'gain');
  assert.deepEqual(start.res, [1, 1, 0, 0, 0]);

  const roll = CT.parseRow(rows[4]);
  assert.equal(roll.sum, 7);

  const trade = CT.parseRow(rows[5]);
  assert.equal(trade.type, 'trade');
  assert.equal(trade.partner, 'xashuma');
  assert.deepEqual(trade.gave, [1, 0, 0, 0, 0]);
  assert.deepEqual(trade.got, [0, 1, 0, 0, 0]);

  const hidden = CT.parseRow(rows[6]);
  assert.equal(hidden.type, 'steal');
  assert.equal(hidden.res, null);
  assert.equal(hidden.victim, 'Ahab');

  const you = CT.parseRow(rows[7]);
  assert.equal(you.youAreThief, true);
  assert.equal(you.res, 4);
  assert.equal(you.victim, 'Dumah');

  assert.equal(CT.parseRow(rows[8]).card, 'monopoly');
  const mono = CT.parseRow(rows[9]);
  assert.equal(mono.type, 'monopoly');
  assert.equal(mono.count, 2);
  assert.equal(mono.res, 1);

  const blocked = CT.parseRow(rows[10]);
  assert.equal(blocked.num, 6);
  assert.equal(blocked.res, 2);

  const city = CT.parseRow(rows[11]);
  assert.equal(city.type, 'build');
  assert.equal(city.what, 'city');
});
