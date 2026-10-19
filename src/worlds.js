/* Many-worlds hand tracker.
 *
 * Every public fact from the log (rolls, trades, builds, discards, known
 * steals, monopolies) is deterministic. The one hidden event is a robber steal
 * between two *other* players: the log shows a card back. Instead of guessing,
 * we keep every possible hand assignment ("world") with its probability and
 * let later evidence prune worlds that turn out impossible (a player spending
 * a card they could not have had, a monopoly total, a trade offer, the live
 * card counts in the player panel...). Read-outs are min/max/expected counts
 * and P(has >= 1) across the surviving worlds. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});
  const R = 5;
  const MAX_WORLDS = CT.MAX_WORLDS || 4000;

  const keyOf = (h) => h.join(',');

  class Worlds {
    constructor(playerCount = 0) {
      this.n = playerCount;
      this.contradictions = 0;   // impossible-in-every-world observations that were force-applied
      this.ignoredConstraints = 0; // soft constraints (offers/panel counts) that matched no world
      this.approximate = false;  // true once the hypothesis cap has dropped unlikely worlds
      this.worlds = new Map();
      const h = new Array(this.n * R).fill(0);
      this.worlds.set(keyOf(h), { h, w: 1 });
    }

    get size() { return this.worlds.size; }

    addPlayer() {
      this.n++;
      const next = new Map();
      for (const { h, w } of this.worlds.values()) {
        const h2 = h.concat([0, 0, 0, 0, 0]);
        next.set(keyOf(h2), { h: h2, w });
      }
      this.worlds = next;
      return this.n - 1;
    }

    /** Rebuild the world set through `fn(h, w, emit)`. Returns false (and
     *  leaves the set untouched) when no world survives. */
    _transform(fn) {
      const next = new Map();
      let sum = 0;
      const emit = (h, w) => {
        if (!(w > 0)) return;
        const k = keyOf(h);
        const existing = next.get(k);
        if (existing) existing.w += w; else next.set(k, { h, w });
        sum += w;
      };
      for (const { h, w } of this.worlds.values()) fn(h, w, emit);
      if (next.size === 0) return false;
      for (const world of next.values()) world.w /= sum;
      this.worlds = next;
      this._cap();
      return true;
    }

    _cap() {
      if (this.worlds.size <= MAX_WORLDS) return;
      const kept = Array.from(this.worlds.values()).sort((a, b) => b.w - a.w).slice(0, MAX_WORLDS);
      const sum = kept.reduce((acc, world) => acc + world.w, 0);
      this.worlds = new Map(kept.map(world => { world.w /= sum; return [keyOf(world.h), world]; }));
      this.approximate = true;
    }

    static _canPay(h, offset, res) {
      for (let r = 0; r < R; r++) if (h[offset + r] < res[r]) return false;
      return true;
    }

    gain(p, res) {
      const o = p * R;
      this._transform((h, w, emit) => {
        const h2 = h.slice();
        for (let r = 0; r < R; r++) h2[o + r] += res[r];
        emit(h2, w);
      });
    }

    /** Player p loses `lose` and gains `gain` in one step (build, dev card,
     *  discard, bank trade). Worlds where p cannot pay are impossible. */
    exchange(p, lose, gain = [0, 0, 0, 0, 0]) {
      const o = p * R;
      const ok = this._transform((h, w, emit) => {
        if (!Worlds._canPay(h, o, lose)) return;
        const h2 = h.slice();
        for (let r = 0; r < R; r++) h2[o + r] += gain[r] - lose[r];
        emit(h2, w);
      });
      if (ok) return true;
      // Contradiction: the log is ground truth, so clamp instead of stalling.
      this.contradictions++;
      this._transform((h, w, emit) => {
        const h2 = h.slice();
        for (let r = 0; r < R; r++) h2[o + r] = Math.max(0, h2[o + r] - lose[r]) + gain[r];
        emit(h2, w);
      });
      return false;
    }

    /** p gives `gave` to q and receives `got` from q. */
    trade(p, q, gave, got) {
      const po = p * R;
      const qo = q * R;
      const ok = this._transform((h, w, emit) => {
        if (!Worlds._canPay(h, po, gave) || !Worlds._canPay(h, qo, got)) return;
        const h2 = h.slice();
        for (let r = 0; r < R; r++) {
          h2[po + r] += got[r] - gave[r];
          h2[qo + r] += gave[r] - got[r];
        }
        emit(h2, w);
      });
      if (ok) return true;
      this.contradictions++;
      this._transform((h, w, emit) => {
        const h2 = h.slice();
        for (let r = 0; r < R; r++) {
          h2[po + r] = Math.max(0, h2[po + r] - gave[r]) + got[r];
          h2[qo + r] = Math.max(0, h2[qo + r] - got[r]) + gave[r];
        }
        emit(h2, w);
      });
      return false;
    }

    stealKnown(thief, victim, r) {
      const lose = [0, 0, 0, 0, 0];
      lose[r] = 1;
      return this.trade(victim, thief, lose, [0, 0, 0, 0, 0]);
    }

    /** Hidden steal: branch into one world per resource the victim may hold,
     *  weighted by how many of that resource the victim has in that world. */
    stealUnknown(thief, victim) {
      const vo = victim * R;
      const to = thief * R;
      const ok = this._transform((h, w, emit) => {
        let total = 0;
        for (let r = 0; r < R; r++) total += h[vo + r];
        if (total === 0) return;
        for (let r = 0; r < R; r++) {
          const c = h[vo + r];
          if (c === 0) continue;
          const h2 = h.slice();
          h2[vo + r]--;
          h2[to + r]++;
          emit(h2, (w * c) / total);
        }
      });
      if (!ok) this.contradictions++; // victim provably had no cards; nothing to move
      return ok;
    }

    /** Monopoly: p takes every card of resource r from the others (or from one
     *  named victim). The log states the total, which is a strong constraint. */
    monopoly(p, r, count, victim = null) {
      const po = p * R;
      const sources = [];
      for (let q = 0; q < this.n; q++) if (q !== p && (victim === null || q === victim)) sources.push(q * R + r);
      const ok = this._transform((h, w, emit) => {
        let sum = 0;
        for (const i of sources) sum += h[i];
        if (sum !== count) return;
        const h2 = h.slice();
        for (const i of sources) h2[i] = 0;
        h2[po + r] += count;
        emit(h2, w);
      });
      if (ok) return true;
      this.contradictions++;
      this._transform((h, w, emit) => {
        const h2 = h.slice();
        for (const i of sources) h2[i] = 0;
        h2[po + r] += count;
        emit(h2, w);
      });
      return false;
    }

    /** Soft constraint: p currently holds at least `res` (e.g. a trade offer). */
    requireAtLeast(p, res) {
      const o = p * R;
      const ok = this._transform((h, w, emit) => { if (Worlds._canPay(h, o, res)) emit(h, w); });
      if (!ok) this.ignoredConstraints++;
      return ok;
    }

    /** Prune by exact hand sizes read from the player panel. `counts[p]` is a
     *  number or null. Returns 'noop' | 'pruned' | 'conflict'. */
    constrainTotals(counts) {
      const matches = (h) => {
        for (let p = 0; p < this.n; p++) {
          if (counts[p] === null || counts[p] === undefined) continue;
          let total = 0;
          for (let r = 0; r < R; r++) total += h[p * R + r];
          if (total !== counts[p]) return false;
        }
        return true;
      };
      let matching = 0;
      for (const { h } of this.worlds.values()) if (matches(h)) matching++;
      if (matching === 0) { this.ignoredConstraints++; return 'conflict'; }
      if (matching === this.worlds.size) return 'noop';
      this._transform((h, w, emit) => { if (matches(h)) emit(h, w); });
      return 'pruned';
    }

    /** Per-player, per-resource statistics across all worlds. */
    summary() {
      const players = [];
      for (let p = 0; p < this.n; p++) {
        const res = [];
        for (let r = 0; r < R; r++) res.push({ min: Infinity, max: 0, mean: 0, pHas: 0 });
        players.push({ res, total: { min: Infinity, max: 0, mean: 0 } });
      }
      for (const { h, w } of this.worlds.values()) {
        for (let p = 0; p < this.n; p++) {
          let total = 0;
          for (let r = 0; r < R; r++) {
            const c = h[p * R + r];
            const s = players[p].res[r];
            if (c < s.min) s.min = c;
            if (c > s.max) s.max = c;
            s.mean += w * c;
            if (c > 0) s.pHas += w;
            total += c;
          }
          const t = players[p].total;
          if (total < t.min) t.min = total;
          if (total > t.max) t.max = total;
          t.mean += w * total;
        }
      }
      for (const pl of players) {
        for (const s of pl.res) if (s.min === Infinity) s.min = 0;
        if (pl.total.min === Infinity) pl.total.min = 0;
      }
      return players;
    }

    /** Probability that a random card stolen from `victim` is each resource. */
    stealOdds(victim) {
      const odds = [0, 0, 0, 0, 0];
      const vo = victim * R;
      let pHasCards = 0;
      for (const { h, w } of this.worlds.values()) {
        let total = 0;
        for (let r = 0; r < R; r++) total += h[vo + r];
        if (total === 0) continue;
        pHasCards += w;
        for (let r = 0; r < R; r++) odds[r] += (w * h[vo + r]) / total;
      }
      return { odds, pHasCards };
    }

    /** Probability that player p can pay `cost` right now. */
    affordOdds(p, cost) {
      const o = p * R;
      let prob = 0;
      for (const { h, w } of this.worlds.values()) if (Worlds._canPay(h, o, cost)) prob += w;
      return prob;
    }

    /** Exact resource totals across all players (identical in every world). */
    inPlay() {
      const totals = [0, 0, 0, 0, 0];
      const first = this.worlds.values().next().value;
      if (!first) return totals;
      for (let p = 0; p < this.n; p++) for (let r = 0; r < R; r++) totals[r] += first.h[p * R + r];
      return totals;
    }
  }

  CT.Worlds = Worlds;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Worlds };
})(typeof globalThis !== 'undefined' ? globalThis : window);
