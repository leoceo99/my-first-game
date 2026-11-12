import { W, H, HQ, POINTS_DEF, T, GameMap } from './map.js';
import { TYPES, SQUADS, BARRAGE, POP_CAP, TICKETS, SUPPLY_BASE, SUPPLY_PER_POINT } from './data.js';
import { clamp, dist, dist2, angDiff, rotateToward, SpatialHash, rnd, TAU } from './util.js';
import { FX } from './fx.js';
import { AI } from './ai.js';

const DIFF = {
  easy: { supply: 0.75, acc: 0.8, think: 1.4 },
  normal: { supply: 1.0, acc: 1.0, think: 1.0 },
  hard: { supply: 1.35, acc: 1.12, think: 0.7 },
};
const TRACER = ['#ffcf6b', '#c8ff8a'];
const TICKET_DRAIN = 0.6;
const SILENT = { play() {} };

let NEXT_ID = 1;

// 받침 유무에 따라 조사 선택 (을/를, 이/가)
function josa(word, a, b) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + a;
  return word + ((c - 0xac00) % 28 ? a : b);
}

export class Unit {
  constructor(type, team, x, y, squad) {
    const d = TYPES[type];
    this.id = NEXT_ID++;
    this.type = type; this.def = d; this.team = team;
    this.x = x; this.y = y; this.px = x; this.py = y; this.vx = 0; this.vy = 0;
    this.r = d.radius;
    this.hp = d.hp; this.maxHp = d.hp;
    this.angle = team === 0 ? -Math.PI / 4 : (Math.PI * 3) / 4;
    this.turret = this.angle;
    this.squad = squad;
    this.path = null; this.pi = 0; this.dest = null;
    this.order = { type: 'idle' };
    this.retarget = Math.random() * 0.3;
    this.repath = 0;
    this.weapons = d.weapons.map((w) => ({ def: w, cd: Math.random() * w.rof, burst: 0, reload: 0, target: null }));
    this.maxRange = Math.max(...d.weapons.map((w) => w.range));
    this.supp = 0; this.setup = 0; this.moving = false; this.recoil = 0;
    this.seen = [team === 0, team === 1];
    this.alive = true;
    this.walk = Math.random() * 10; this.tread = 0; this.trackAcc = 0;
    this.stuck = 0; this.stuckCount = 0;
    this.lastFire = -10; this.lastHit = -10; this.smokeT = 0;
  }
}

function typeMul(kind, u) {
  const v = u.def.vehicle;
  switch (kind) {
    case 'bullet': return v ? 0.03 : 1;
    case 'rocket': return v ? 1 : 0.45;
    case 'shell': return v ? 1 : 0.85;
    case 'he': return v ? 0.35 : 1;
    case 'barrage': return v ? 0.55 : 1;
  }
  return 1;
}

export class Game {
  constructor(opts = {}) {
    this.audio = opts.audio || SILENT;
    this.demo = !!opts.demo;
    this.difficulty = opts.difficulty || 'normal';
    this.diff = DIFF[this.difficulty];
    this.map = new GameMap(opts.seed ?? 1944);
    this.fx = new FX();
    this.units = []; this.projectiles = []; this.wrecks = []; this.corpses = []; this.markers = []; this.barrages = [];
    this.hash = new SpatialHash(96);
    this._tmp = []; this._tmp2 = [];
    this.teams = [0, 1].map((i) => ({ id: i, supply: 380, tickets: TICKETS, queue: [], barrageCd: 25, kills: 0, losses: 0, captured: 0 }));
    this.points = POINTS_DEF.map((p) => ({ ...p, owner: -1, progress: 0, contested: false, counts: [0, 0] }));
    this.time = 0; this.over = false; this.winner = -1;
    this.squadSeq = 1;
    this.events = [];
    this.shake = 0;
    this.camRef = { x: W / 2, y: H / 2, zoom: 1 };
    this.selection = new Set();
    this.visT = 0; this.ticketT = 0;

    for (const t of [0, 1]) {
      const h = HQ[t], s = t === 0 ? 1 : -1;
      this.addUnit('bunker', t, h.x + 120 * s, h.y - 40 * s, 0);
      this.addUnit('bunker', t, h.x + 40 * s, h.y - 120 * s, 0);
    }
    this.ais = this.demo ? [new AI(this, 0), new AI(this, 1)] : [new AI(this, 1)];
    for (const t of [0, 1]) {
      this.spawnSquad(t, SQUADS[0]);
      this.spawnSquad(t, SQUADS[0]);
      this.spawnSquad(t, SQUADS[1]);
    }
    this.hash.clear();
    for (const u of this.units) this.hash.insert(u);
    this.updateVision();
  }

  // ---------- helpers ----------
  addUnit(type, team, x, y, squad) {
    const u = new Unit(type, team, x, y, squad);
    this.units.push(u);
    return u;
  }
  event(text, tone = 'info') { this.events.push({ text, tone }); }
  accMul(team) { return team === 1 && !this.demo ? this.diff.acc : 1; }
  pop(team) {
    let n = 0;
    for (const u of this.units) if (u.alive && u.team === team && !u.def.static) n++;
    for (const q of this.teams[team].queue) n += q.def.units.length;
    return n;
  }
  ownedPoints(team) { return this.points.filter((p) => p.owner === team).length; }
  addShake(x, y, s) {
    const c = this.camRef;
    const d = dist(x, y, c.x, c.y) * c.zoom;
    this.shake = Math.min(1.2, this.shake + s * Math.max(0, 1 - d / 700));
  }
  addMarker(kind, x, y, extra = {}) { this.markers.push({ kind, x, y, t: 0, life: extra.life ?? 1.1, ...extra }); }

  // ---------- deployment ----------
  canDeploy(team, def) {
    const tm = this.teams[team];
    if (tm.supply < def.cost) return 'supply';
    if (this.pop(team) + def.units.length > POP_CAP) return 'pop';
    if (tm.queue.length >= 5) return 'queue';
    return true;
  }
  deploy(team, key) {
    const def = SQUADS.find((s) => s.key === key);
    const ok = this.canDeploy(team, def);
    if (ok !== true) return ok;
    const tm = this.teams[team];
    tm.supply -= def.cost;
    tm.queue.push({ def, t: def.time });
    return true;
  }
  spawnSquad(team, def) {
    const h = HQ[team], s = team === 0 ? 1 : -1;
    const sid = this.squadSeq++;
    const units = [];
    def.units.forEach((type, i) => {
      const x = h.x + s * (50 + (i % 3) * 16) + rnd(-6, 6);
      const y = h.y - s * (50 + Math.floor(i / 3) * 16) + rnd(-6, 6);
      units.push(this.addUnit(type, team, x, y, sid));
    });
    const rx = h.x + s * (230 + rnd(-60, 60)), ry = h.y - s * (230 + rnd(-60, 60));
    this.issueOrder(units, rx, ry, 'amove');
    if (team === 0 && !this.demo) {
      this.event(`${def.name} 배치 완료`, 'info');
      this.audio.play('deploy');
    }
    return units;
  }

  // ---------- orders ----------
  issueOrder(units, x, y, kind, target = null) {
    units = units.filter((u) => u.alive && !u.def.static);
    if (!units.length) return;
    if (kind === 'attack') {
      for (const u of units) { u.order = { type: 'attack', target }; u.path = null; u.repath = 0; u.stuckCount = 0; }
      return;
    }
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= units.length; cy /= units.length;
    const ang = Math.atan2(y - cy, x - cx);
    units = units.slice().sort((a, b) => (b.def.vehicle ? 1 : 0) - (a.def.vehicle ? 1 : 0) || a.type.localeCompare(b.type));
    const n = units.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2)));
    const sp = units.some((u) => u.def.vehicle) ? 58 : 24;
    const fx = Math.cos(ang), fy = Math.sin(ang), lx = -fy, ly = fx;
    units.forEach((u, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const rowCount = Math.min(cols, n - row * cols);
      const lat = (col - (rowCount - 1) / 2) * sp;
      const back = -row * sp;
      let dx = x + fx * back + lx * lat, dy = y + fy * back + ly * lat;
      dx = clamp(dx, 20, W - 20); dy = clamp(dy, 20, H - 20);
      if (this.map.blockedPx(dx, dy)) { const p = this.map.nearestWalkablePx(dx, dy); dx = p.x; dy = p.y; }
      u.stuckCount = 0;
      this.setPath(u, dx, dy);
      u.order = { type: kind, x: dx, y: dy };
    });
  }
  stop(units) {
    for (const u of units) { u.path = null; u.order = { type: 'idle' }; }
  }
  setPath(u, x, y) {
    u.path = this.map.findPath(u.x, u.y, x, y, !!u.def.vehicle);
    u.pi = 0;
    u.dest = { x, y };
    u.stuck = 0;
  }
  callBarrage(team, x, y) {
    const tm = this.teams[team];
    if (tm.barrageCd > 0 || tm.supply < BARRAGE.cost) return false;
    tm.supply -= BARRAGE.cost;
    tm.barrageCd = BARRAGE.cd;
    for (let i = 0; i < BARRAGE.shells; i++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * BARRAGE.radius;
      this.barrages.push({ team, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, t: 2.2 + i * 0.38 + Math.random() * 0.3, whistled: false });
    }
    this.addMarker('barrage', x, y, { life: 2.2 + BARRAGE.shells * 0.38 + 1, team, r: BARRAGE.radius });
    if (!this.demo) {
      if (team === 0) this.event('포병 지원 요청됨 — 탄착 임박', 'info');
      else this.event('⚠ 적 포격 경보!', 'bad');
    }
    return true;
  }

  unitAt(x, y, tol, filter) {
    let best = null, bd = 1e9;
    for (const u of this.units) {
      if (!u.alive || u.def.static) continue;
      if (filter && !filter(u)) continue;
      const d = dist(x, y, u.x, u.y) - u.r;
      if (d < tol && d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // ---------- simulation ----------
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.over) {
      this.fx.update(dt);
      return;
    }
    this.time += dt;
    this.hash.clear();
    for (const u of this.units) if (u.alive) this.hash.insert(u);

    this.visT -= dt;
    if (this.visT <= 0) { this.visT = 0.2; this.updateVision(); }

    for (const tm of this.teams) {
      const mul = tm.id === 1 && !this.demo ? this.diff.supply : 1;
      tm.supply += (SUPPLY_BASE + SUPPLY_PER_POINT * this.ownedPoints(tm.id)) * mul * dt;
      tm.barrageCd = Math.max(0, tm.barrageCd - dt);
      const q = tm.queue[0];
      if (q) {
        q.t -= dt;
        if (q.t <= 0) { tm.queue.shift(); this.spawnSquad(tm.id, q.def); }
      }
    }

    for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
    this.separate(dt);
    for (const u of this.units) {
      u.vx = (u.x - u.px) / dt; u.vy = (u.y - u.py) / dt;
      u.px = u.x; u.py = u.y;
    }
    this.updateProjectiles(dt);
    this.updateBarrages(dt);
    this.updateWrecks(dt);
    this.updatePoints(dt);
    for (const ai of this.ais) ai.update(dt);
    this.fx.update(dt);

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      if (m.t >= m.life) this.markers.splice(i, 1);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      this.corpses[i].t += dt;
      if (this.corpses[i].t > 40) this.corpses.splice(i, 1);
    }
    if (this.units.some((u) => !u.alive)) this.units = this.units.filter((u) => u.alive);

    this.ticketT += dt;
    if (this.ticketT >= 1) {
      this.ticketT -= 1;
      const n0 = this.ownedPoints(0), n1 = this.ownedPoints(1);
      if (n0 > n1) this.teams[1].tickets -= (n0 - n1) * TICKET_DRAIN;
      else if (n1 > n0) this.teams[0].tickets -= (n1 - n0) * TICKET_DRAIN;
    }
    for (const tm of this.teams) {
      if (tm.tickets <= 0 && !this.over) {
        tm.tickets = 0;
        this.over = true;
        this.winner = 1 - tm.id;
        if (!this.demo) this.event(this.winner === 0 ? '승리! 적 전선이 붕괴했습니다' : '패배… 아군 전선이 무너졌습니다', this.winner === 0 ? 'good' : 'bad');
      }
    }
    if (this.demo && this.over) {
      // 데모 화면은 계속 순환
      for (const tm of this.teams) tm.tickets = TICKETS;
      this.over = false;
    }
  }

  updateVision() {
    for (const u of this.units) { u.seen[0] = u.team === 0; u.seen[1] = u.team === 1; }
    const tmp = this._tmp;
    for (const a of this.units) {
      if (!a.alive) continue;
      const s = a.def.sight;
      this.hash.query(a.x, a.y, s, tmp);
      for (const b of tmp) {
        if (b.team === a.team || b.seen[a.team] || !b.alive) continue;
        const d2 = dist2(a.x, a.y, b.x, b.y);
        if (d2 > s * s) continue;
        let eff = s;
        if (this.map.inForest(b.x, b.y) && this.time - b.lastFire > 2.5) eff = b.def.vehicle ? 220 : 150;
        if (d2 > eff * eff) continue;
        if (this.map.losBlocked(a.x, a.y, b.x, b.y)) continue;
        b.seen[a.team] = true;
      }
    }
    for (const p of this.points) {
      if (p.owner < 0) continue;
      this.hash.query(p.x, p.y, 210, tmp);
      for (const b of tmp) if (b.team !== p.owner && dist2(p.x, p.y, b.x, b.y) < 210 * 210) b.seen[p.owner] = true;
    }
  }

  pickTarget(u, w) {
    const d = w.def, r = d.range;
    const tmp = this._tmp2;
    this.hash.query(u.x, u.y, r, tmp);
    const ot = u.order.type === 'attack' ? u.order.target : null;
    let best = null, bs = 1e9;
    for (const t of tmp) {
      if (t.team === u.team || !t.alive || !t.seen[u.team] || t.def.invuln) continue;
      const dd = dist2(u.x, u.y, t.x, t.y);
      if (dd > r * r) continue;
      if (d.minRange && dd < d.minRange * d.minRange) continue;
      if (!d.indirect && this.map.losBlocked(u.x, u.y, t.x, t.y)) continue;
      let s = Math.sqrt(dd);
      if (t === ot) s -= 10000;
      if (t.def.vehicle) {
        if (d.kind === 'bullet') s += 2000;
        else if (d.antiArmor) s -= 300;
        if (d.kind === 'he') s += 400;
      } else if (d.antiArmor) s += 500;
      if (t.supp > 60) s += 40;
      if (s < bs) { bs = s; best = t; }
    }
    return best;
  }

  updateUnit(u, dt) {
    const d = u.def;
    u.supp = Math.max(0, u.supp - dt * (u.supp > 60 ? 9 : 16));
    u.recoil = Math.max(0, u.recoil - dt * 3);
    u.repath -= dt;

    u.retarget -= dt;
    if (u.retarget <= 0) {
      u.retarget = 0.3 + Math.random() * 0.25;
      for (const w of u.weapons) w.target = this.pickTarget(u, w);
    }
    for (const w of u.weapons) {
      const t = w.target;
      if (t && (!t.alive || !t.seen[u.team])) w.target = null;
    }
    const ptarget = u.weapons[0].target || (u.weapons[1] && u.weapons[1].target);

    // orders
    let move = false;
    const o = u.order;
    if (!d.static) {
      if (o.type === 'attack') {
        const t = o.target;
        if (!t || !t.alive) { u.order = { type: 'idle' }; u.path = null; }
        else {
          const dd = dist(u.x, u.y, t.x, t.y);
          const ind = u.weapons[0].def.indirect;
          const inRange = dd < u.maxRange * 0.92 && t.seen[u.team] && (ind || !this.map.losBlocked(u.x, u.y, t.x, t.y));
          if (inRange) u.path = null;
          else {
            if (!u.path || u.repath <= 0) { this.setPath(u, t.x, t.y); u.repath = 1.5; }
            move = true;
          }
        }
      } else if (o.type === 'move' || o.type === 'amove') {
        if (!u.path) u.order = { type: 'idle' };
        else move = !(o.type === 'amove' && ptarget);
      }
    }
    if (move && u.path) this.moveAlongPath(u, dt);
    else u.moving = false;

    if (d.setupTime) {
      if (u.moving) u.setup = Math.max(0, u.setup - dt * 2);
      else u.setup = Math.min(1, u.setup + dt / d.setupTime);
    }

    // facing
    if (d.vehicle) {
      const ct = u.weapons[0].target;
      const desired = ct ? Math.atan2(ct.y - u.y, ct.x - u.x) : u.angle;
      u.turret = rotateToward(u.turret, desired, d.turretTurn * dt);
      if (u.hp < u.maxHp * 0.4) {
        u.smokeT -= dt;
        if (u.smokeT <= 0) {
          u.smokeT = 0.12;
          this.fx.add('dark', u.x + rnd(-6, 6), u.y + rnd(-6, 6), { vx: rnd(-8, 8), vy: rnd(-8, 8), life: rnd(1.5, 2.5), s: 6, gs: 12, a: 0.6, wind: 1.5 });
        }
      }
    } else if (ptarget) {
      u.angle = rotateToward(u.angle, Math.atan2(ptarget.y - u.y, ptarget.x - u.x), 7 * dt);
    }

    // weapons
    for (const w of u.weapons) {
      const wd = w.def;
      w.cd -= dt;
      if (w.reload > 0) { w.reload -= dt; continue; }
      const t = w.target;
      if (!t) continue;
      if (wd.needSetup && u.setup < 1) continue;
      if (w.cd > 0) continue;
      const ang = Math.atan2(t.y - u.y, t.x - u.x);
      if (wd.turret) { if (Math.abs(angDiff(u.turret, ang)) > 0.07) continue; }
      else if (!d.vehicle) { if (Math.abs(angDiff(u.angle, ang)) > 0.4) continue; }
      const dd = dist(u.x, u.y, t.x, t.y);
      if (dd > wd.range) { w.target = null; continue; }
      this.fire(u, w, t, dd, ang);
    }
  }

  moveAlongPath(u, dt) {
    const d = u.def, p = u.path;
    if (!p || u.pi >= p.length) { u.path = null; u.moving = false; return; }
    const wp = p[u.pi];
    const dx = wp.x - u.x, dy = wp.y - u.y, dd = Math.hypot(dx, dy);
    const last = u.pi === p.length - 1;
    if (dd < (last ? 6 : 14) || (last && dd < 24 && u.stuck > 0.4)) {
      u.pi++;
      if (u.pi >= p.length) { u.path = null; u.moving = false; }
      return;
    }
    let sp = d.speed * this.map.speedMul(u.x, u.y, d.vehicle);
    if (d.inf) sp *= 1 - Math.min(u.supp, 90) / 130;
    const desired = Math.atan2(dy, dx);
    let mx, my, pivot = false;
    if (d.vehicle) {
      u.angle = rotateToward(u.angle, desired, d.turn * dt);
      const al = Math.cos(angDiff(u.angle, desired));
      const s = al > 0.6 ? sp * al : 0;
      pivot = s === 0;
      mx = Math.cos(u.angle) * s * dt; my = Math.sin(u.angle) * s * dt;
      u.tread += (pivot ? sp * 0.3 : s) * dt;
    } else {
      if (!u.weapons[0].target) u.angle = rotateToward(u.angle, desired, 9 * dt);
      const s = Math.min(sp * dt, dd);
      mx = (dx / dd) * s; my = (dy / dd) * s;
    }
    const ox = u.x, oy = u.y;
    this.tryMove(u, mx, my);
    const moved = Math.hypot(u.x - ox, u.y - oy);
    u.moving = true;
    if (d.inf) u.walk += moved;
    if (d.vehicle) {
      u.trackAcc += moved;
      if (u.trackAcc > 7) { u.trackAcc = 0; this.map.paintTrack(u.x, u.y, u.angle); }
      if (Math.random() < 0.15 && moved > 0.3) this.fx.add('dust', u.x - Math.cos(u.angle) * 20, u.y - Math.sin(u.angle) * 20, { life: 1.2, s: 6, gs: 14, a: 0.35, wind: 1 });
    }
    if (!pivot && moved < sp * dt * 0.25) {
      u.stuck += dt;
      if (u.stuck > 1.2) {
        u.stuck = 0;
        u.stuckCount++;
        if (u.stuckCount > 3 || !u.dest) { u.path = null; if (u.order.type !== 'attack') u.order = { type: 'idle' }; }
        else this.setPath(u, u.dest.x, u.dest.y);
      }
    } else u.stuck = Math.max(0, u.stuck - dt);
  }

  blockedCircle(x, y, r) {
    const m = this.map;
    return m.blockedPx(x, y) || m.blockedPx(x - r, y) || m.blockedPx(x + r, y) || m.blockedPx(x, y - r) || m.blockedPx(x, y + r);
  }
  tryMove(u, mx, my) {
    const r = u.r * (u.def.vehicle ? 0.7 : 0.8);
    if (!this.blockedCircle(u.x + mx, u.y, r)) u.x += mx;
    if (!this.blockedCircle(u.x, u.y + my, r)) u.y += my;
  }

  separate(dt) {
    const tmp = this._tmp;
    for (const a of this.units) {
      if (!a.alive || a.def.static) continue;
      this.hash.query(a.x, a.y, 50, tmp);
      let px = 0, py = 0;
      for (const b of tmp) {
        if (b === a || !b.alive) continue;
        const min = a.r + b.r + (a.def.vehicle || b.def.vehicle ? 4 : 3);
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const ov = min - d;
        const ma = a.def.vehicle ? 5 : 1, mb = b.def.static ? 1000 : b.def.vehicle ? 5 : 1;
        const f = mb / (ma + mb);
        px += (dx / d) * ov * f; py += (dy / d) * ov * f;
      }
      if (px || py) {
        const k = Math.min(1, dt * 10);
        this.tryMove(a, px * k, py * k);
      }
    }
  }

  fire(u, w, t, dd, ang) {
    const wd = w.def, d = u.def;
    w.cd = wd.rof * (0.85 + Math.random() * 0.3);
    if (wd.burst) {
      w.burst++;
      if (w.burst >= wd.burst) { w.burst = 0; w.reload = wd.reload * (0.8 + Math.random() * 0.4); }
    }
    u.lastFire = this.time;
    let mx, my;
    if (wd.turret) { mx = u.x + Math.cos(u.turret) * 36; my = u.y + Math.sin(u.turret) * 36; }
    else if (d.vehicle) { mx = u.x + Math.cos(u.turret) * 14 + Math.cos(u.turret + 1.57) * 5; my = u.y + Math.sin(u.turret) * 14 + Math.sin(u.turret + 1.57) * 5; }
    else if (d.static) { mx = u.x + Math.cos(ang) * 18; my = u.y + Math.sin(ang) * 18; }
    else { mx = u.x + Math.cos(ang) * 12; my = u.y + Math.sin(ang) * 12; }

    let acc = wd.acc * this.accMul(u.team);
    if (u.moving) acc *= d.vehicle ? 0.6 : 0.5;
    acc *= 1 - Math.min(u.supp, 90) / 150;
    acc *= 1 - 0.4 * (dd / wd.range);
    if (t.def.vehicle) acc *= 1.5;
    if (t.moving) acc *= 0.85;
    const hit = Math.random() < acc;

    if (wd.kind === 'bullet') {
      let ex = t.x, ey = t.y;
      if (hit) {
        let dmg = wd.dmg * typeMul('bullet', t);
        if (t.def.inf) dmg *= this.map.coverAt(t.x, t.y);
        this.damage(t, dmg, 'bullet', u);
        if (t.def.vehicle && Math.random() < 0.4) this.fx.sparks(t.x + rnd(-8, 8), t.y + rnd(-8, 8), 3);
      } else {
        const a = Math.random() * TAU, r = 8 + Math.random() * 30;
        ex += Math.cos(a) * r; ey += Math.sin(a) * r;
        if (Math.random() < 0.3) this.fx.impactDust(ex, ey, this.map.typeAt(ex, ey) === T.WATER);
      }
      if (t.def.inf && wd.supp) t.supp = Math.min(100, t.supp + wd.supp * (hit ? 1.5 : 1) * (this.map.coverAt(t.x, t.y) < 1 ? 0.7 : 1));
      this.fx.muzzle(mx, my, ang, false);
      if (Math.random() < (wd.burst ? 0.55 : 0.5)) this.fx.tracer(mx, my, ex, ey, TRACER[u.team]);
      this.audio.play(wd.snd, u.x, u.y, wd.snd === 'mg' ? 0.8 : 0.7);
      return;
    }

    if (wd.kind === 'rocket' || wd.kind === 'shell') {
      let tx = t.x, ty = t.y;
      if (hit) {
        const tt = dd / wd.projSpeed;
        tx += t.vx * tt; ty += t.vy * tt;
      } else {
        const a = Math.random() * TAU, r = 22 + Math.random() * 40;
        tx += Math.cos(a) * r; ty += Math.sin(a) * r;
      }
      const T_ = Math.max(0.02, dist(mx, my, tx, ty) / wd.projSpeed);
      this.projectiles.push({ kind: wd.kind, team: u.team, src: u, x: mx, y: my, sx: mx, sy: my, tx, ty, t: 0, T: T_, dmg: wd.dmg, splash: wd.splash, target: hit ? t : null, arc: 0, trail: 0 });
      if (wd.kind === 'shell') {
        u.recoil = 1;
        this.fx.muzzle(mx, my, u.turret, true);
        for (let i = 0; i < 6; i++) this.fx.add('dust', u.x + rnd(-24, 24), u.y + rnd(-24, 24), { life: 1, s: 8, gs: 20, a: 0.45 });
        this.addShake(u.x, u.y, 0.25);
      } else {
        this.fx.muzzle(mx, my, ang, false);
        const ba = ang + Math.PI;
        for (let i = 0; i < 5; i++) this.fx.add('smoke', u.x + Math.cos(ba) * 10, u.y + Math.sin(ba) * 10, { vx: Math.cos(ba + rnd(-0.5, 0.5)) * 80, vy: Math.sin(ba + rnd(-0.5, 0.5)) * 80, life: 1.5, s: 5, gs: 14, drag: 2.5, a: 0.55, wind: 1 });
      }
      this.audio.play(wd.snd, u.x, u.y);
      return;
    }

    if (wd.kind === 'he') {
      const spread = wd.spread * (0.4 + 0.6 * (dd / wd.range)) * (t.moving ? 1.3 : 1) / this.accMul(u.team);
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * spread;
      const tx = t.x + Math.cos(a) * r, ty = t.y + Math.sin(a) * r;
      const T_ = 1.4 + dd / 450;
      this.projectiles.push({ kind: 'he', team: u.team, src: u, x: mx, y: my, sx: mx, sy: my, tx, ty, t: 0, T: T_, dmg: wd.dmg, splash: wd.splash, target: null, arc: 120 + dd * 0.45, whistled: false });
      this.fx.muzzle(mx, my, ang, false);
      this.fx.add('smoke', mx, my, { life: 1.6, s: 6, gs: 14, a: 0.6, wind: 1 });
      this.audio.play('mortar', u.x, u.y);
    }
  }

  updateProjectiles(dt) {
    const P = this.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.T);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.y = p.sy + (p.ty - p.sy) * k;
      p.z = p.arc ? 4 * p.arc * k * (1 - k) : 0;
      if (p.kind === 'rocket') {
        p.trail -= dt;
        if (p.trail <= 0) {
          p.trail = 0.015;
          this.fx.add('smoke', p.x, p.y, { life: 1.2, s: 3, gs: 9, a: 0.5, drag: 1, wind: 1 });
          this.fx.add('fire', p.x, p.y, { life: 0.08, s: 4 });
        }
        if (this.map.typeAt(p.x, p.y) === T.BUILDING && k > 0.1) { p.tx = p.x; p.ty = p.y; this.impact(p); P.splice(i, 1); continue; }
      }
      if (p.kind === 'he' && !p.whistled && k > 0.55) {
        p.whistled = true;
        this.audio.play('whistle', p.tx, p.ty, 0.8);
      }
      if (k >= 1) { this.impact(p); P.splice(i, 1); }
    }
  }

  impact(p) {
    const x = p.tx, y = p.ty;
    const sc = { rocket: 0.7, shell: 0.9, he: 1.0, barrage: 1.45 }[p.kind] || 1;
    const water = this.map.typeAt(x, y) === T.WATER;
    this.fx.explosion(x, y, sc, water);
    if (!water) this.map.paintCrater(x, y, 8 + 12 * sc);
    this.audio.play(p.kind === 'rocket' ? 'explosionSmall' : 'explosion', x, y, sc);
    this.addShake(x, y, sc * 0.6);
    const tmp = this._tmp;
    const R = p.splash * 1.7;
    this.hash.query(x, y, R + 30, tmp);
    for (const u of tmp) {
      if (!u.alive || u.team === p.team) continue;
      const dd = dist(x, y, u.x, u.y);
      let dmg = 0;
      if (p.target === u && dd < u.r + 16) {
        dmg = p.dmg * typeMul(p.kind, u) * this.armorMul(u, p.sx, p.sy);
        if (u.def.vehicle) this.fx.sparks(x, y, 10);
      } else if (dd < p.splash + u.r) {
        const f = 1 - Math.max(0, dd - u.r) / p.splash;
        dmg = p.dmg * 0.55 * f * typeMul(p.kind, u);
        if (u.def.inf) dmg *= (1 + this.map.coverAt(u.x, u.y)) / 2;
      }
      if (dmg > 0) this.damage(u, dmg, p.kind, p.src);
      if (u.alive && u.def.inf && dd < R) u.supp = Math.min(100, u.supp + 50 * (1 - dd / R));
    }
  }

  armorMul(u, sx, sy) {
    if (!u.def.vehicle) return 1;
    const a = Math.atan2(sy - u.y, sx - u.x);
    const diff = Math.abs(angDiff(u.angle, a));
    return diff < 0.9 ? 0.7 : diff > 2.3 ? 1.6 : 1.1;
  }

  damage(t, amount, kind, src) {
    if (!t.alive || t.def.invuln) return;
    t.hp -= amount;
    t.lastHit = this.time;
    if (t.hp <= 0) this.kill(t, src);
  }

  kill(u, src) {
    u.alive = false;
    const tm = this.teams[u.team];
    tm.tickets -= u.def.vehicle ? 10 : 1;
    tm.losses++;
    if (src) this.teams[src.team].kills++;
    this.selection.delete(u);
    if (u.def.vehicle) {
      this.wrecks.push({ x: u.x, y: u.y, angle: u.angle, turret: u.turret + rnd(-0.6, 0.6), team: u.team, t: 0 });
      this.fx.explosion(u.x, u.y, 1.7);
      this.map.paintScorch(u.x, u.y, 46);
      this.audio.play('explosion', u.x, u.y, 1.6);
      this.addShake(u.x, u.y, 1.2);
      if (!this.demo) this.event(u.team === 0 ? '아군 전차 격파됨' : '적 전차 격파!', u.team === 0 ? 'bad' : 'good');
    } else {
      this.corpses.push({ x: u.x, y: u.y, angle: u.angle + rnd(-0.8, 0.8), team: u.team, type: u.type, t: 0 });
      this.fx.add('dust', u.x, u.y, { life: 0.8, s: 5, gs: 10, a: 0.5 });
    }
  }

  updateBarrages(dt) {
    const B = this.barrages;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      b.t -= dt;
      if (!b.whistled && b.t < 1.1) { b.whistled = true; this.audio.play('whistle', b.x, b.y, 1.2); }
      if (b.t <= 0) {
        this.impact({ kind: 'barrage', team: b.team, src: null, tx: b.x, ty: b.y, sx: b.x, sy: b.y - 100, dmg: BARRAGE.dmg, splash: BARRAGE.splash, target: null });
        B.splice(i, 1);
      }
    }
  }

  updateWrecks(dt) {
    for (const w of this.wrecks) {
      w.t += dt;
      if (w.t < 12 && Math.random() < dt * 14) this.fx.add('fire', w.x + rnd(-10, 10), w.y + rnd(-8, 8), { life: rnd(0.3, 0.7), s: rnd(6, 11), gs: 6, vy: -5 });
      if (w.t < 60 && Math.random() < dt * (w.t < 15 ? 10 : 3)) this.fx.add('dark', w.x + rnd(-8, 8), w.y + rnd(-8, 8), { life: rnd(2.5, 4.5), s: 7, gs: rnd(10, 16), a: 0.6, wind: 2, vx: rnd(-5, 5), vy: rnd(-5, 5) });
    }
  }

  updatePoints(dt) {
    const tmp = this._tmp;
    for (const p of this.points) {
      this.hash.query(p.x, p.y, 110, tmp);
      let c0 = 0, c1 = 0;
      for (const u of tmp) {
        if (!u.alive || u.def.static) continue;
        if (dist2(p.x, p.y, u.x, u.y) > 100 * 100) continue;
        if (u.team === 0) c0++; else c1++;
      }
      p.counts[0] = c0; p.counts[1] = c1;
      p.contested = c0 > 0 && c1 > 0;
      if (!p.contested) {
        if (c0 || c1) {
          const team = c0 ? 0 : 1, n = Math.min(3, c0 || c1);
          const rate = 11 * (1 + 0.35 * (n - 1));
          p.progress = clamp(p.progress + (team === 0 ? 1 : -1) * rate * dt, -100, 100);
        } else if (p.owner === -1) {
          p.progress -= Math.sign(p.progress) * Math.min(Math.abs(p.progress), 4 * dt);
        } else {
          const tgt = p.owner === 0 ? 100 : -100;
          p.progress += Math.sign(tgt - p.progress) * Math.min(Math.abs(tgt - p.progress), 4 * dt);
        }
      }
      const prev = p.owner;
      if (p.progress >= 100) p.owner = 0;
      else if (p.progress <= -100) p.owner = 1;
      else if (p.owner === 0 && p.progress <= 0) p.owner = -1;
      else if (p.owner === 1 && p.progress >= 0) p.owner = -1;
      if (prev !== p.owner && !this.demo) {
        if (p.owner === 0) { this.event(`${p.id} ${p.name} 점령!`, 'good'); this.audio.play('capture'); this.teams[0].captured++; }
        else if (p.owner === 1) { this.event(`적이 ${p.id} ${josa(p.name, '을', '를')} 점령했습니다`, 'bad'); this.audio.play('lost'); }
        else if (prev === 0) { this.event(`${p.id} ${p.name} 거점을 잃고 있습니다`, 'bad'); this.audio.play('lost'); }
        else this.event(`${p.id} ${p.name} 적 거점 무력화`, 'good');
      }
    }
  }
}
