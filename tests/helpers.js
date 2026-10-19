'use strict';
// Load the content-script modules in manifest order; they attach to
// globalThis.ColonistTracker exactly like they do in the browser.
require('../src/constants.js');
require('../src/tokenizer.js');
require('../src/parser.js');
require('../src/worlds.js');
require('../src/game.js');
require('../src/board.js');
require('../src/advisor.js');

const CT = globalThis.ColonistTracker;

const name = (v, color = '#e27174') => ({ t: 'name', v, color });
const text = (v) => ({ t: 'text', v });
const img = (v) => ({ t: 'img', v });

/** Build a tokenized row from a compact shape. */
let autoIndex = 0;
function row(tokens, index) {
  return { index: index === undefined ? autoIndex++ : index, tokens, separator: false };
}

/** Feed a list of token rows through parser + game. */
function play(game, rows) {
  for (const r of rows) game.applyEvent(CT.parseRow(r));
}

const RES = { lumber: 0, brick: 1, wool: 2, grain: 3, ore: 4 };
function counts(spec) {
  const out = [0, 0, 0, 0, 0];
  for (const [k, v] of Object.entries(spec || {})) out[RES[k]] = v;
  return out;
}

module.exports = { CT, name, text, img, row, play, counts, RES };
