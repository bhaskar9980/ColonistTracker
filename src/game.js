/* Game state: players, victory points, development cards, dice, and the
 * many-worlds hand tracker. Pure logic; `applyEvent` consumes parser events.
 *
 * All parsed events are retained so the whole state can be replayed, e.g.
 * once we learn which player "you" are (needed to attribute "You stole" and
 * "stole ... from you" lines). */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});
  const { COSTS, DEV_DECK, DEV_DECK_SIZE, PIECES, AWARD_VP, DICE_PROBABILITY, BANK_PER_RESOURCE, DEFAULT_SETTINGS, SETTING_PRIORITY, YOU_PRIORITY } = CT;
  const Worlds = CT.Worlds;
  const ZERO = [0, 0, 0, 0, 0];
  const MAX_LOG = 400;

  function newPlayer(name, color, idx) {
    return {
      name, color: color || '', idx,
      settlements: 0, cities: 0, roads: 0,
      devBought: 0, devPlayed: { knight: 0, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0 },
      freeRoads: 0,
      rolls: 0, income: [0, 0, 0, 0, 0], incomeTotal: 0,
      robbed: 0, stole: 0, robberMoves: 0, discarded: 0,
      tradesWithPlayers: 0, tradesWithBank: 0, devCardsFromYop: 0,
      sevensRolled: 0,
    };
  }

  class Game {
    constructor() {
      this.you = null;      // player name, once known
      this.youSource = null; // 'header' | 'inferred' | 'manual' | 'session'
      this.settings = {
        vpToWin: DEFAULT_SETTINGS.vpToWin, discardLimit: DEFAULT_SETTINGS.discardLimit,
        sources: { vpToWin: 'default', discardLimit: 'default' },
      };
      this.playerDiscardLimits = {}; // name -> limit (Cities & Knights walls make it per player)
      this.colorMap = {};            // colonist colour enum -> player name
      this.reset();
    }

    /** Update a game setting if the source outranks the current one. */
    setSetting(key, value, source) {
      if (!(key in DEFAULT_SETTINGS)) return false;
      const v = Number(value);
      if (!Number.isInteger(v) || v < 1 || v > 99) return false;
      const rank = SETTING_PRIORITY[source] || 0;
      const current = SETTING_PRIORITY[this.settings.sources[key]] || 0;
      if (rank < current) return false;
      if (this.settings[key] === v && this.settings.sources[key] === source) return false;
      this.settings[key] = v;
      this.settings.sources[key] = source;
      return true;
    }

    clearManualSettings() {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (this.settings.sources[key] === 'manual') { this.settings[key] = DEFAULT_SETTINGS[key]; this.settings.sources[key] = 'default'; }
      }
    }

    setColorMap(map) { this.colorMap = Object.assign({}, map); }

    setPlayerDiscardLimit(name, limit) {
      if (!name || !Number.isInteger(limit) || limit < 1) return;
      this.playerDiscardLimits[name] = limit;
    }

    discardLimitFor(name) { return this.playerDiscardLimits[name] || this.settings.discardLimit; }

    /** Exact development cards for a player whose faces the game shows us
     *  (our own). `counts` = {knight, vp, monopoly, roadBuilding, yearOfPlenty, total} or null. */
    setKnownDevCards(name, counts) {
      if (!name) return false;
      if (!this.knownDev) this.knownDev = {};
      const before = JSON.stringify(this.knownDev[name] || null);
      if (before === JSON.stringify(counts || null)) return false;
      if (counts) this.knownDev[name] = Object.assign({}, counts); else delete this.knownDev[name];
      return true;
    }

    reset() {
      this.players = [];
      this.byName = new Map();
      this.worlds = new Worlds(0);
      this.dice = new Array(13).fill(0);
      this.rolls = 0;
      this.lastRobberMover = null;
      this.currentTurn = null;
      this.awards = { longestRoad: null, largestArmy: null };
      this.robberPending = null; // {player, index, moved} from a seven or a knight until the steal
      if (!this.knownDev) this.knownDev = {}; // name -> exact dev-card counts (ours, from the game connection); survives replays
      this.winner = null;
      this.events = [];
      this.recent = [];
      this.unknownCount = 0;
      this.pendingYouSteals = 0;
      this.blocked = {};
      this.lastIndex = -1;
      this.desync = false;
      this.started = false;
    }

    /** Set which player is "you". A weaker source never overrides a stronger
     *  one (e.g. a guess from the log cannot replace the name you chose). */
    setYou(name, source) {
      if (!name) return false;
      const rank = YOU_PRIORITY[source] || 0;
      const current = this.you ? (YOU_PRIORITY[this.youSource] || 0) : -1;
      if (name === this.you) { if (rank >= current && source !== this.youSource) this.youSource = source; return false; }
      if (rank < current) return false;
      this.you = name;
      this.youSource = source || 'manual';
      this.replay();
      return true;
    }

    /** Rebuild everything from the retained event list. */
    replay() {
      const events = this.events;
      const you = this.you;
      const youSource = this.youSource;
      this.reset();
      this.you = you;
      this.youSource = youSource;
      for (const ev of events) this._apply(ev);
      this.events = events;
    }

    ensurePlayer(name, color) {
      if (!name) return null;
      let p = this.byName.get(name);
      if (!p) {
        p = newPlayer(name, color, this.players.length);
        this.players.push(p);
        this.byName.set(name, p);
        this.worlds.addPlayer();
      } else if (color && !p.color) {
        p.color = color;
      }
      return p;
    }

    applyEvent(ev) {
      if (!ev) return;
      this.events.push(ev);
      this._apply(ev);
    }

    _log(ev, note) {
      this.recent.push({ index: ev.index, text: ev.text, type: ev.type, note: note || '' });
      if (this.recent.length > MAX_LOG) this.recent.splice(0, this.recent.length - MAX_LOG);
    }

    _apply(ev) {
      if (typeof ev.index === 'number' && ev.index > this.lastIndex) this.lastIndex = ev.index;
      const handler = this['_on_' + ev.type];
      if (!handler) { this.unknownCount++; this._log(ev, 'ignored'); return; }
      const note = handler.call(this, ev);
      this._log(ev, note);
    }

    _on_unknown() { this.unknownCount++; return 'ignored'; }
    _on_blocked(ev) {
      if (ev.num === null) return '';
      const key = String(ev.num);
      this.blocked[key] = (this.blocked[key] || 0) + 1;
      return '';
    }

    _on_placeSettlement(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.settlements++;
      this.started = true;
      return '';
    }

    _on_placeRoad(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.roads++;
      return '';
    }

    _on_gain(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      this.worlds.gain(p.idx, ev.res);
      if (ev.source === 'roll' || ev.source === 'start') {
        for (let r = 0; r < 5; r++) p.income[r] += ev.res[r];
        p.incomeTotal += ev.res.reduce((a, b) => a + b, 0);
      }
      return '';
    }

    _on_roll(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      if (ev.sum >= 2 && ev.sum <= 12) { this.dice[ev.sum]++; this.rolls++; }
      if (ev.sum === 7) p.sevensRolled++;
      p.rolls++;
      this.currentTurn = p.name;
      this.robberPending = ev.sum === 7 ? { player: p.name, index: ev.index, moved: false } : null;
      return '';
    }

    _on_trade(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      const q = this.ensurePlayer(ev.partner);
      if (!q) return 'no partner';
      p.tradesWithPlayers++;
      q.tradesWithPlayers++;
      return this.worlds.trade(p.idx, q.idx, ev.gave, ev.got) ? '' : 'CONTRADICTION';
    }

    _on_bankTrade(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.tradesWithBank++;
      return this.worlds.exchange(p.idx, ev.gave, ev.got) ? '' : 'CONTRADICTION';
    }

    _on_buyDev(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.devBought++;
      return this.worlds.exchange(p.idx, COSTS.dev) ? '' : 'CONTRADICTION';
    }

    _on_build(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      if (ev.what === 'settlement') {
        p.settlements++;
        return this.worlds.exchange(p.idx, COSTS.settlement) ? '' : 'CONTRADICTION';
      }
      if (ev.what === 'city') {
        p.cities++;
        p.settlements = Math.max(0, p.settlements - 1);
        return this.worlds.exchange(p.idx, COSTS.city) ? '' : 'CONTRADICTION';
      }
      p.roads++;
      if (p.freeRoads > 0) { p.freeRoads--; return 'free road'; }
      return this.worlds.exchange(p.idx, COSTS.road) ? '' : 'CONTRADICTION';
    }

    _on_useDev(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      if (ev.card in p.devPlayed) p.devPlayed[ev.card]++;
      if (ev.card === 'roadBuilding') p.freeRoads = 2;
      if (ev.card === 'knight') this.robberPending = { player: p.name, index: ev.index, moved: false };
      return '';
    }

    _on_steal(ev) {
      this.robberPending = null; // the steal ends the robber phase
      let thiefName = ev.thief;
      let victimName = ev.victim;
      if (ev.youAreThief) {
        if (!this.you && this.lastRobberMover) { this.you = this.lastRobberMover; this.youSource = 'inferred'; }
        thiefName = this.you || this.lastRobberMover;
      }
      if (ev.youAreVictim) victimName = this.you;

      const thief = this.ensurePlayer(thiefName, ev.youAreThief ? '' : ev.color);
      const victim = this.ensurePlayer(victimName);
      if (!thief || !victim) {
        this.pendingYouSteals++;
        if (thief && ev.res !== null) { // we know what was gained even if not from whom
          const gain = ZERO.slice(); gain[ev.res] = 1;
          this.worlds.gain(thief.idx, gain);
          return 'victim unknown (who are you?)';
        }
        return 'unattributed';
      }
      thief.stole++;
      victim.robbed++;
      if (ev.res === null) {
        return this.worlds.stealUnknown(thief.idx, victim.idx) ? 'hidden' : 'CONTRADICTION';
      }
      return this.worlds.stealKnown(thief.idx, victim.idx, ev.res) ? '' : 'CONTRADICTION';
    }

    _on_monopoly(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      if (ev.res === null) return 'no resource';
      const victim = ev.victim ? this.ensurePlayer(ev.victim) : null;
      return this.worlds.monopoly(p.idx, ev.res, ev.count, victim ? victim.idx : null) ? '' : 'CONTRADICTION';
    }

    _on_discard(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.discarded += ev.res.reduce((a, b) => a + b, 0);
      return this.worlds.exchange(p.idx, ev.res) ? '' : 'CONTRADICTION';
    }

    _on_offer(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      return this.worlds.requireAtLeast(p.idx, ev.offered) ? '' : 'offer impossible, ignored';
    }

    _on_moveRobber(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      p.robberMoves++;
      this.lastRobberMover = p.name;
      if (this.robberPending && this.robberPending.player === p.name) this.robberPending.moved = true;
      return '';
    }

    _on_award(ev) {
      const p = this.ensurePlayer(ev.player, ev.color);
      if (ev.lost) {
        if (this.awards[ev.award] === p.name) this.awards[ev.award] = null;
        return 'lost';
      }
      if (ev.from) this.ensurePlayer(ev.from);
      this.awards[ev.award] = p.name; // one holder at a time: a transfer removes it from the previous holder
      return ev.from ? `from ${ev.from}` : '';
    }

    _on_gameOver(ev) {
      this.winner = ev.player;
      return '';
    }

    /** Apply live hand sizes from the player panel: {name: count}. */
    applyPanelCounts(countsByName) {
      if (!this.players.length) return 'noop';
      const counts = this.players.map(p => (p.name in countsByName ? countsByName[p.name] : null));
      if (counts.every(c => c === null)) return 'noop';
      const result = this.worlds.constrainTotals(counts);
      this.desync = result === 'conflict';
      return result;
    }

    // ---- derived metrics -------------------------------------------------

    visibleVP(p) {
      let vp = p.settlements + 2 * p.cities;
      if (this.awards.longestRoad === p.name) vp += AWARD_VP;
      if (this.awards.largestArmy === p.name) vp += AWARD_VP;
      return vp;
    }

    devPlayedTotal(p) {
      return Object.values(p.devPlayed).reduce((a, b) => a + b, 0);
    }

    unplayedDev(p) {
      const known = this.knownDev && this.knownDev[p.name];
      if (known) return known.total;
      return Math.max(0, p.devBought - this.devPlayedTotal(p));
    }

    devDeckStats() {
      const bought = this.players.reduce((a, p) => a + p.devBought, 0);
      const played = { knight: 0, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0 };
      for (const p of this.players) for (const k of Object.keys(played)) played[k] += p.devPlayed[k];
      const unplayedInHands = this.players.reduce((a, p) => a + this.unplayedDev(p), 0);
      const deck = Math.max(0, DEV_DECK_SIZE - bought);
      const unseen = deck + unplayedInHands; // cards whose identity is still hidden
      const remaining = {};
      const nextOdds = {};
      for (const k of Object.keys(DEV_DECK)) {
        remaining[k] = Math.max(0, DEV_DECK[k] - (played[k] || 0));
        nextOdds[k] = unseen > 0 ? remaining[k] / unseen : 0;
      }
      return { bought, deck, unplayedInHands, played, remaining, nextOdds };
    }

    maxVP(p, deckStats) {
      const known = this.knownDev && this.knownDev[p.name];
      if (known) return this.visibleVP(p) + known.vp;
      const vpLeft = deckStats ? deckStats.remaining.vp : DEV_DECK.vp;
      return this.visibleVP(p) + Math.min(this.unplayedDev(p), vpLeft);
    }

    colorEnumFor(name) {
      for (const [c, n] of Object.entries(this.colorMap)) if (n === name) return Number(c);
      return null;
    }

    bank() {
      const inPlay = this.worlds.inPlay();
      return inPlay.map(c => BANK_PER_RESOURCE - c);
    }

    diceExpected() {
      return DICE_PROBABILITY.map(pr => pr * this.rolls);
    }

    /** Everything the overlay needs, computed once per render. */
    snapshot() {
      const hands = this.worlds.summary();
      const deck = this.devDeckStats();
      const players = this.players.map((p, i) => {
        const hand = hands[i] || { res: [], total: { min: 0, max: 0, mean: 0 } };
        const discardLimit = this.discardLimitFor(p.name);
        return {
          name: p.name, color: p.color, isYou: p.name === this.you, colorEnum: this.colorEnumFor(p.name),
          hand,
          handSize: hand.total,
          discardLimit,
          overLimit: hand.total.min > discardLimit,
          maybeOverLimit: hand.total.max > discardLimit,
          settlements: p.settlements, cities: p.cities, roads: p.roads,
          piecesLeft: {
            settlements: Math.max(0, PIECES.settlements - p.settlements), // upgraded settlements return to the supply
            cities: Math.max(0, PIECES.cities - p.cities),
            roads: Math.max(0, PIECES.roads - p.roads),
          },
          devBought: p.devBought, devPlayed: p.devPlayed, unplayedDev: this.unplayedDev(p),
          knownDev: (this.knownDev && this.knownDev[p.name]) || null,
          knights: p.devPlayed.knight,
          visibleVP: this.visibleVP(p), maxVP: this.maxVP(p, deck),
          longestRoad: this.awards.longestRoad === p.name,
          largestArmy: this.awards.largestArmy === p.name,
          rolls: p.rolls, income: p.income, incomeTotal: p.incomeTotal,
          incomePerTurn: p.rolls ? p.incomeTotal / p.rolls : 0,
          robbed: p.robbed, stole: p.stole, discarded: p.discarded, sevensRolled: p.sevensRolled,
          tradesWithPlayers: p.tradesWithPlayers, tradesWithBank: p.tradesWithBank,
          stealOdds: this.worlds.stealOdds(i),
          afford: {
            road: this.worlds.affordOdds(i, COSTS.road),
            settlement: this.worlds.affordOdds(i, COSTS.settlement),
            city: this.worlds.affordOdds(i, COSTS.city),
            dev: this.worlds.affordOdds(i, COSTS.dev),
          },
        };
      });
      return {
        players, you: this.you, youSource: this.youSource,
        settings: { vpToWin: this.settings.vpToWin, discardLimit: this.settings.discardLimit, sources: Object.assign({}, this.settings.sources) },
        bank: this.bank(), dice: this.dice.slice(), diceExpected: this.diceExpected(), rolls: this.rolls,
        deck, awards: this.awards, winner: this.winner, currentTurn: this.currentTurn, robberPending: this.robberPending,
        worlds: this.worlds.size, approximate: this.worlds.approximate,
        contradictions: this.worlds.contradictions, ignoredConstraints: this.worlds.ignoredConstraints,
        unknownCount: this.unknownCount, pendingYouSteals: this.pendingYouSteals,
        desync: this.desync, lastIndex: this.lastIndex, recent: this.recent, blocked: this.blocked,
        eventCount: this.events.length,
      };
    }
  }

  CT.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Game };
})(typeof globalThis !== 'undefined' ? globalThis : window);
