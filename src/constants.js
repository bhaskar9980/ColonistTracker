/* Shared constants for the Colonist Tracker extension.
 * Every module attaches itself to the `ColonistTracker` namespace so the files
 * can be loaded as plain content scripts (no bundler) and also `require`d in
 * Node for the test-suite. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});

  // Resource order used for every count array: [lumber, brick, wool, grain, ore]
  const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const RESOURCE_LABELS = { lumber: 'Wood', brick: 'Brick', wool: 'Sheep', grain: 'Wheat', ore: 'Ore' };
  const RESOURCE_ICONS = { lumber: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '⛏️' };
  // Colonist uses several spellings across the log, the board and the chat.
  const RESOURCE_ALIASES = {
    lumber: 0, wood: 0, tree: 0,
    brick: 1, clay: 1,
    wool: 2, sheep: 2,
    grain: 3, wheat: 3,
    ore: 4,
  };

  const BANK_PER_RESOURCE = 19;
  const DISCARD_LIMIT = 7; // more than this many cards => discard on a 7

  const COSTS = {
    road: [1, 1, 0, 0, 0],
    settlement: [1, 1, 1, 1, 0],
    city: [0, 0, 0, 2, 3],
    dev: [0, 0, 1, 1, 1],
  };

  const DEV_DECK = { knight: 14, vp: 5, monopoly: 2, roadBuilding: 2, yearOfPlenty: 2 };
  const DEV_DECK_SIZE = 25;
  const DEV_LABELS = {
    knight: 'Knight', vp: 'Victory Point', monopoly: 'Monopoly',
    roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty',
  };

  const PIECES = { settlements: 5, cities: 4, roads: 15 };
  const AWARD_VP = 2;
  const WINNING_VP = 10; // default; rooms can change it
  const DEFAULT_SETTINGS = { vpToWin: 10, discardLimit: 7 };
  // Where a setting can come from, weakest to strongest.
  const SETTING_PRIORITY = { default: 0, ui: 1, game: 2, manual: 3 };
  // How much to trust each way of learning which player you are.
  const YOU_PRIORITY = { inferred: 1, header: 2, panel: 3, session: 4, manual: 5 };
  // Text colonist renders for these settings (room page, game-info tab, tooltips).
  const SETTING_TEXT_PATTERNS = {
    discardLimit: [/card discard limit:?\s*(\d{1,2})(?!\d)/i, /discard limit:?\s*(\d{1,2})(?!\d)/i, /discard limit is (\d{1,2})(?!\d)/i],
    vpToWin: [/first player to reach (\d{1,2}) wins/i, /points to win:?\s*(\d{1,2})(?!\d)/i, /first to (\d{1,2}) victory points/i, /vp to win:?\s*(\d{1,2})(?!\d)/i],
  };

  // Probability of each dice total (index = total).
  const DICE_PROBABILITY = [0, 0, 1 / 36, 2 / 36, 3 / 36, 4 / 36, 5 / 36, 6 / 36, 5 / 36, 4 / 36, 3 / 36, 2 / 36, 1 / 36];

  // Hypothesis cap for the many-worlds hand tracker. Beyond this we drop the
  // least likely worlds and flag the display as approximate.
  const MAX_WORLDS = 4000;

  const SELECTORS = {
    logRow: '[data-index]',
    headerUsername: '[name="web-header-username"], .web-header-username, #web-header-username',
    playerPanel: '[data-player-information-container]',
    playerBlock: '[data-player-color]',
    playerCardCount: '[data-resource-card]',
    playerDevCount: '[data-development-card]',
  };

  const TIMING = {
    findContainerMs: 1500,
    mutationDebounceMs: 60,
    panelCheckDelayMs: 1500,
    gapPatienceMs: 3000,
    sweepStepMs: 90,
    sweepSettleMs: 150,
    maxSweeps: 3,
  };

  const STORAGE_KEY = 'colonistTracker.ui.v2';
  const GAME_STORAGE_PREFIX = 'colonistTracker.game.';

  Object.assign(CT, {
    RESOURCES, RESOURCE_LABELS, RESOURCE_ICONS, RESOURCE_ALIASES,
    BANK_PER_RESOURCE, DISCARD_LIMIT, COSTS, DEV_DECK, DEV_DECK_SIZE, DEV_LABELS,
    PIECES, AWARD_VP, WINNING_VP, DEFAULT_SETTINGS, SETTING_PRIORITY, YOU_PRIORITY, SETTING_TEXT_PATTERNS,
    DICE_PROBABILITY, MAX_WORLDS, SELECTORS, TIMING, STORAGE_KEY, GAME_STORAGE_PREFIX,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = CT;
})(typeof globalThis !== 'undefined' ? globalThis : window);
