import { SQUADS, BARRAGE } from './data.js';
import { HQ } from './map.js';
import { dist, rnd } from './util.js';

/** 적(또는 데모용 아군) 지휘관 AI */
export class AI {
  constructor(game, team) {
    this.g = game;
    this.team = team;
    this.buyT = 1.5;
    this.thinkT = 1;
    this.next = null;
    this.assign = new Map();
  }

  update(dt) {
    const m = this.g.diff.think;
    this.buyT -= dt;
    if (this.buyT <= 0) { this.buyT = 0.8; this.buy(); }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 2.4 * m; this.think(); }
    const tm = this.g.teams[this.team];
    if (tm.barrageCd <= 0 && tm.supply >= BARRAGE.cost + 60 && Math.random() < dt * 0.5) this.tryBarrage();
  }

  buy() {
    if (!this.next) this.next = this.choose();
    const def = SQUADS.find((s) => s.key === this.next);
    if (this.g.canDeploy(this.team, def) === true) {
      this.g.deploy(this.team, def.key);
      this.next = null;
    }
  }

  choose() {
    const g = this.g;
    let enemyTanks = 0, ownTanks = 0, ownAT = 0, ownMortar = 0, ownMG = 0;
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.team !== this.team && u.type === 'tank') enemyTanks++;
      if (u.team === this.team) {
        if (u.type === 'tank') ownTanks++;
        if (u.type === 'at') ownAT++;
        if (u.type === 'mortar') ownMortar++;
        if (u.type === 'mg') ownMG++;
      }
    }
    const minutes = g.time / 60;
    const w = {
      rifle: 4,
      mg: ownMG < 6 ? 2 : 0.5,
      at: 0.6 + Math.max(0, enemyTanks * 2.2 - ownAT * 0.5),
      mortar: ownMortar < 4 ? 1 : 0,
      tank: minutes > 1.5 ? (ownTanks < 3 ? 1.6 : 0.4) : 0.2,
    };
    let sum = 0;
    for (const k in w) sum += w[k];
    let r = Math.random() * sum;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'rifle';
  }

  squads() {
    const map = new Map();
    for (const u of this.g.units) {
      if (!u.alive || u.team !== this.team || u.def.static) continue;
      let a = map.get(u.squad);
      if (!a) { a = []; map.set(u.squad, a); }
      a.push(u);
    }
    return map;
  }

  threat(p) {
    let n = 0;
    for (const u of this.g.units) {
      if (u.alive && u.team !== this.team && !u.def.static && dist(u.x, u.y, p.x, p.y) < 280) n++;
    }
    return n;
  }

  think() {
    const g = this.g, pts = g.points;
    const sq = this.squads();
    for (const id of [...this.assign.keys()]) if (!sq.has(id)) this.assign.delete(id);
    const load = new Array(pts.length).fill(0);
    for (const a of this.assign.values()) load[a]++;
    const threats = pts.map((p) => this.threat(p));
    for (const [id, units] of sq) {
      let cx = 0, cy = 0;
      for (const u of units) { cx += u.x; cy += u.y; }
      cx /= units.length; cy /= units.length;
      const kind = units[0].type;
      const a = this.assign.get(id);
      const idle = units.every((u) => !u.path && u.order.type !== 'attack');
      let reconsider = a == null;
      if (a != null) {
        const p = pts[a];
        if (p.owner === this.team && idle && threats[a] === 0) reconsider = Math.random() < 0.35;
        if (p.owner !== this.team && idle && dist(cx, cy, p.x, p.y) > 160) reconsider = true;
        if (Math.random() < 0.06) reconsider = true;
      }
      if (!reconsider) continue;
      if (a != null) load[a]--;
      let best = 0, bs = -1e9;
      pts.forEach((p, i) => {
        const d = dist(cx, cy, p.x, p.y);
        let s;
        if (p.owner !== this.team) s = 100 + (p.owner === -1 ? 18 : 0) - threats[i] * 4;
        else s = threats[i] > 0 ? 112 : 22;
        s -= d / 22;
        s -= load[i] * (p.owner === this.team ? 34 : 16);
        if (kind === 'tank' && threats[i] > 0) s += 10;
        s += rnd(0, 18);
        if (s > bs) { bs = s; best = i; }
      });
      this.assign.set(id, best);
      load[best]++;
      let tx = pts[best].x, ty = pts[best].y;
      if (kind === 'mortar') {
        const h = HQ[this.team];
        const dx = h.x - tx, dy = h.y - ty, dl = Math.hypot(dx, dy) || 1;
        tx += (dx / dl) * 320; ty += (dy / dl) * 320;
      } else {
        tx += rnd(-55, 55); ty += rnd(-55, 55);
      }
      g.issueOrder(units, tx, ty, 'amove');
    }
  }

  tryBarrage() {
    const g = this.g;
    let best = null, bn = 0;
    for (const u of g.units) {
      if (!u.alive || u.team === this.team || u.def.static || !u.seen[this.team]) continue;
      let n = 0, sx = 0, sy = 0;
      for (const v of g.units) {
        if (!v.alive || v.team === this.team || v.def.static) continue;
        if (dist(u.x, u.y, v.x, v.y) < 110) { n += v.def.vehicle ? 3 : 1; sx += v.x; sy += v.y; }
      }
      if (n > bn) { bn = n; best = { x: sx / Math.max(1, n), y: sy / Math.max(1, n), cx: u.x, cy: u.y }; }
    }
    if (best && bn >= 5) g.callBarrage(this.team, best.cx + rnd(-30, 30), best.cy + rnd(-30, 30));
  }
}
