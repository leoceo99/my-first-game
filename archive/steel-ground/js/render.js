import { W, H, HQ } from './map.js';
import { TAU, roundRect, clamp } from './util.js';

const PAL = [
  { uni: '#566638', uniD: '#45522c', helmet: '#4a582c', pack: '#6b5a39', boot: '#2b2418', mark: '#4aa3ff', hull: '#5b6a3a', hullD: '#45512c', hullL: '#73844b', tube: '#4d5a33' },
  { uni: '#5f6367', uniD: '#4c5054', helmet: '#4d5155', pack: '#5a4f3f', boot: '#222', mark: '#ff5040', hull: '#696d6f', hullD: '#505456', hullL: '#858a8c', tube: '#55595c' },
];
const TEAM_RGB = ['74,163,255', '255,80,64'];
const FOG_SCALE = 16;

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.fog = mk(Math.ceil(W / FOG_SCALE), Math.ceil(H / FOG_SCALE));
    this.fogCtx = this.fog.getContext('2d');
    this.hole = mk(64, 64);
    const hg = this.hole.getContext('2d');
    const gr = hg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.72, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    hg.fillStyle = gr; hg.fillRect(0, 0, 64, 64);
    this.vignette = null;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    const v = (this.vignette = mk(256, 256));
    const g = v.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 70, 128, 128, 182);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }

  toScreen(cam, x, y) { return { x: (x - cam.x) * cam.zoom + this.w / 2, y: (y - cam.y) * cam.zoom + this.h / 2 }; }
  toWorld(cam, sx, sy) { return { x: (sx - this.w / 2) / cam.zoom + cam.x, y: (sy - this.h / 2) / cam.zoom + cam.y }; }

  draw(g, cam, ui = {}) {
    const ctx = this.ctx, dpr = this.dpr, z = cam.zoom;
    const sh = g.shake * 7;
    const ox = this.w / 2 - cam.x * z + (Math.random() - 0.5) * sh;
    const oy = this.h / 2 - cam.y * z + (Math.random() - 0.5) * sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#161912';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = true;
    const view = {
      x0: Math.max(0, -ox / z), y0: Math.max(0, -oy / z),
      x1: Math.min(W, (this.w - ox) / z), y1: Math.min(H, (this.h - oy) / z),
    };
    const inView = (x, y, m = 40) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;
    const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
    if (vw > 0 && vh > 0) ctx.drawImage(g.map.base, view.x0, view.y0, vw, vh, view.x0, view.y0, vw, vh);

    const showAll = g.demo || g.over;
    const visible = (u) => showAll || u.team === 0 || u.seen[0];

    // capture points
    for (const p of g.points) if (inView(p.x, p.y, 120)) this.drawPoint(ctx, p, g.time);
    // HQ flags
    HQ.forEach((h, t) => { if (inView(h.x, h.y, 80)) this.drawFlag(ctx, h.x, h.y, t, g.time, 1.4); });

    // corpses & wrecks
    for (const c of g.corpses) if (inView(c.x, c.y) && (showAll || c.team === 0 || this.fogClear(c.x, c.y, g))) this.drawCorpse(ctx, c);
    for (const w of g.wrecks) if (inView(w.x, w.y)) this.drawWreck(ctx, w);

    // markers on ground
    for (const m of g.markers) if (inView(m.x, m.y, 150)) this.drawMarker(ctx, m, g);

    // selection rings + paths
    if (g.selection.size) {
      ctx.lineWidth = 1.5 / Math.max(0.6, z);
      ctx.strokeStyle = 'rgba(160,255,140,0.35)';
      ctx.setLineDash([6, 6]);
      for (const u of g.selection) {
        if (!u.path) continue;
        ctx.beginPath(); ctx.moveTo(u.x, u.y);
        for (let i = u.pi; i < u.path.length; i++) ctx.lineTo(u.path[i].x, u.path[i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const u of g.selection) {
        ctx.strokeStyle = 'rgba(150,255,130,0.95)';
        ctx.lineWidth = u.def.vehicle ? 2 : 1.4;
        ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.r + 5, (u.r + 5) * 0.85, 0, 0, TAU); ctx.stroke();
      }
    }

    this.fxView = view;
    g.fx.draw(ctx, 0, view);

    // units: infantry first, then vehicles
    for (const u of g.units) if (!u.def.vehicle && inView(u.x, u.y) && visible(u)) {
      if (u.def.static) this.drawBunker(ctx, u); else this.drawInfantry(ctx, u);
    }
    for (const u of g.units) if (u.def.vehicle && inView(u.x, u.y, 60) && visible(u)) this.drawTank(ctx, u);

    // projectiles
    for (const p of g.projectiles) {
      if (!inView(p.x, p.y, 60)) continue;
      if (p.kind === 'he') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2a26';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - p.z, 3, 2, 0, 0, TAU); ctx.fill();
      } else if (p.kind === 'shell') {
        ctx.globalCompositeOperation = 'lighter';
        const dx = p.tx - p.sx, dy = p.ty - p.sy, l = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = 'rgba(255,210,120,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (dx / l) * 30, p.y - (dy / l) * 30); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'rocket') {
        const a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.fillStyle = '#3b3a30'; ctx.fillRect(-5, -1.5, 10, 3);
        ctx.restore();
      }
    }

    // canopy over units
    if (vw > 0 && vh > 0) {
      ctx.globalAlpha = 0.86;
      ctx.drawImage(g.map.canopy, view.x0, view.y0, vw, vh, view.x0, view.y0, vw, vh);
      ctx.globalAlpha = 1;
    }
    g.fx.draw(ctx, 2, view);
    g.fx.draw(ctx, 3, view);

    // fog of war
    if (!showAll) {
      this.updateFog(g);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.fog, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // world edge darkening
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, W, H);

    // ---------- screen space ----------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
    ctx.fillStyle = 'rgba(255,190,110,0.035)';
    ctx.fillRect(0, 0, this.w, this.h);

    // point labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of g.points) {
      const s = this.toScreen(cam, p.x, p.y);
      if (s.x < -60 || s.y < -60 || s.x > this.w + 60 || s.y > this.h + 60) continue;
      const y = s.y - 100 * z - 14;
      const col = p.owner === 0 ? '#4aa3ff' : p.owner === 1 ? '#ff5040' : '#d8d4c4';
      ctx.fillStyle = 'rgba(12,14,10,0.75)';
      ctx.beginPath(); ctx.arc(s.x, y, 14, 0, TAU); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = '700 15px -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif';
      ctx.fillText(p.id, s.x, y + 1);
      ctx.font = '600 11px -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,235,220,0.9)';
      ctx.fillText(p.name + (p.contested ? ' · 교전중' : ''), s.x, y + 25);
    }

    // health bars
    for (const u of g.units) {
      if (u.def.static || !visible(u)) continue;
      const sel = g.selection.has(u);
      const hurt = u.hp < u.maxHp && (u.def.vehicle || g.time - u.lastHit < 4);
      if (!sel && !hurt) continue;
      const s = this.toScreen(cam, u.x, u.y);
      if (s.x < -30 || s.y < -30 || s.x > this.w + 30 || s.y > this.h + 30) continue;
      const bw = u.def.vehicle ? 34 : 14, y = s.y - (u.r + 8) * z - 6;
      const f = clamp(u.hp / u.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(s.x - bw / 2 - 1, y - 1, bw + 2, 5);
      ctx.fillStyle = f > 0.6 ? '#7ddc5a' : f > 0.3 ? '#e8c440' : '#ee4b3a';
      ctx.fillRect(s.x - bw / 2, y, bw * f, 3);
      if (u.def.inf && u.supp > 60) {
        ctx.fillStyle = '#ffd34d';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillText('▼', s.x, y - 7);
      }
    }

    // box selection
    if (ui.box) {
      const b = ui.box;
      ctx.fillStyle = 'rgba(140,255,120,0.12)';
      ctx.strokeStyle = 'rgba(160,255,140,0.9)';
      ctx.lineWidth = 1.5;
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
    if (ui.hold) {
      ctx.strokeStyle = 'rgba(160,255,140,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ui.hold.x, ui.hold.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(ui.hold.k, 0, 1)); ctx.stroke();
    }
  }

  fogClear(x, y, g) {
    for (const u of g.units) if (u.team === 0 && (u.x - x) ** 2 + (u.y - y) ** 2 < u.def.sight ** 2) return true;
    return false;
  }

  updateFog(g) {
    const f = this.fogCtx, fw = this.fog.width, fh = this.fog.height;
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = '#000';
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    for (const u of g.units) {
      if (u.team !== 0 || !u.alive) continue;
      const r = (u.def.sight * 1.08) / FOG_SCALE;
      f.drawImage(this.hole, u.x / FOG_SCALE - r, u.y / FOG_SCALE - r, r * 2, r * 2);
    }
    for (const p of g.points) {
      if (p.owner !== 0) continue;
      const r = 220 / FOG_SCALE;
      f.drawImage(this.hole, p.x / FOG_SCALE - r, p.y / FOG_SCALE - r, r * 2, r * 2);
    }
    f.globalCompositeOperation = 'source-over';
  }

  drawPoint(ctx, p, time) {
    const col = p.owner === 0 ? TEAM_RGB[0] : p.owner === 1 ? TEAM_RGB[1] : '225,220,205';
    ctx.fillStyle = `rgba(${col},0.07)`;
    ctx.beginPath(); ctx.arc(p.x, p.y, 100, 0, TAU); ctx.fill();
    ctx.setLineDash([12, 9]);
    ctx.strokeStyle = `rgba(${col},0.55)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 100, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (Math.abs(p.progress) > 0.5) {
      const c = p.progress > 0 ? TEAM_RGB[0] : TEAM_RGB[1];
      ctx.strokeStyle = `rgba(${c},0.9)`;
      ctx.lineWidth = 6;
      const a0 = -Math.PI / 2;
      const sweep = (TAU * Math.abs(p.progress)) / 100;
      ctx.beginPath();
      if (p.progress > 0) ctx.arc(p.x, p.y, 100, a0, a0 + sweep);
      else ctx.arc(p.x, p.y, 100, a0 - sweep, a0);
      ctx.stroke();
    }
    if (p.contested) {
      ctx.strokeStyle = `rgba(255,210,80,${0.4 + 0.3 * Math.sin(time * 6)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 106, 0, TAU); ctx.stroke();
    }
    this.drawFlag(ctx, p.x, p.y, p.owner, time, 1);
  }

  drawFlag(ctx, x, y, owner, time, s) {
    const col = owner === 0 ? '#3d8bff' : owner === 1 ? '#e04848' : '#d9d6cc';
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(3, 3, 6, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a3630';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    for (let i = 0; i <= 8; i++) {
      const fx = i * 3.2, fy = -1 + Math.sin(time * 5 + i * 0.7) * 1.6 * (i / 8);
      ctx.lineTo(fx, fy);
    }
    for (let i = 8; i >= 0; i--) {
      const fx = i * 3.2, fy = 11 + Math.sin(time * 5 + i * 0.7 + 0.4) * 1.6 * (i / 8);
      ctx.lineTo(fx, fy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 5, 26, 6);
    ctx.restore();
  }

  drawMarker(ctx, m, g) {
    const k = m.t / m.life;
    if (m.kind === 'move' || m.kind === 'attack') {
      const col = m.kind === 'move' ? '150,255,130' : '255,90,70';
      ctx.strokeStyle = `rgba(${col},${1 - k})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const r = 6 + ((k * 22 + i * 10) % 22);
        ctx.beginPath(); ctx.ellipse(m.x, m.y, r, r * 0.8, 0, 0, TAU); ctx.stroke();
      }
      if (m.kind === 'attack') {
        ctx.beginPath(); ctx.moveTo(m.x - 8, m.y - 8); ctx.lineTo(m.x + 8, m.y + 8); ctx.moveTo(m.x + 8, m.y - 8); ctx.lineTo(m.x - 8, m.y + 8); ctx.stroke();
      }
    } else if (m.kind === 'barrage') {
      const col = m.team === 0 ? '255,200,90' : '255,70,50';
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 8);
      ctx.fillStyle = `rgba(${col},${0.06 + pulse * 0.06})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = `rgba(${col},0.85)`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(m.x - 20, m.y); ctx.lineTo(m.x + 20, m.y);
      ctx.moveTo(m.x, m.y - 20); ctx.lineTo(m.x, m.y + 20);
      ctx.stroke();
    }
  }

  drawInfantry(ctx, u) {
    const pal = PAL[u.team];
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(2.5, 3, 6.5, 5, 0, 0, TAU); ctx.fill();
    ctx.rotate(u.angle);
    const prone = u.supp > 60 || (u.type === 'mg' && u.setup > 0.6);
    if (prone) {
      ctx.fillStyle = pal.uniD;
      roundRect(ctx, -13, -3.2, 13, 6.4, 3); ctx.fill();
      ctx.fillStyle = pal.boot;
      ctx.fillRect(-16, -2.8, 4, 2.2); ctx.fillRect(-16, 0.6, 4, 2.2);
    } else if (u.moving) {
      const s = Math.sin(u.walk * 0.35) * 3;
      ctx.fillStyle = pal.boot;
      ctx.fillRect(-1.5 + s, -3.6, 3.2, 2.2);
      ctx.fillRect(-1.5 - s, 1.4, 3.2, 2.2);
    }
    ctx.fillStyle = pal.pack;
    roundRect(ctx, -5.6, -3.4, 3.6, 6.8, 1.5); ctx.fill();
    ctx.fillStyle = pal.uni;
    ctx.beginPath(); ctx.ellipse(0, 0, 3.6, 5.6, 0, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1d1c19';
    switch (u.type) {
      case 'rifle':
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(1, 2.4); ctx.lineTo(11, 2.4); ctx.stroke();
        break;
      case 'mg':
        ctx.lineWidth = 2.1;
        ctx.beginPath(); ctx.moveTo(0, 2.2); ctx.lineTo(14, 2.2); ctx.stroke();
        if (u.setup > 0.6) {
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(12, 2.2); ctx.lineTo(13.5, -0.5); ctx.moveTo(12, 2.2); ctx.lineTo(13.5, 5); ctx.stroke();
        }
        break;
      case 'at':
        ctx.strokeStyle = pal.tube; ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.moveTo(-6, -2.8); ctx.lineTo(9, -2.8); ctx.stroke();
        ctx.fillStyle = '#3a3a30';
        ctx.beginPath(); ctx.arc(10, -2.8, 1.8, 0, TAU); ctx.fill();
        break;
      case 'mortar':
        if (u.setup > 0.5) {
          ctx.fillStyle = '#33352e';
          ctx.beginPath(); ctx.arc(10, 0, 3.2, 0, TAU); ctx.fill();
          ctx.strokeStyle = pal.tube; ctx.lineWidth = 2.8;
          ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(15.5, 0); ctx.stroke();
        } else {
          ctx.strokeStyle = pal.tube; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(3, -1); ctx.stroke();
        }
        break;
    }
    ctx.fillStyle = pal.uniD;
    ctx.beginPath(); ctx.arc(5, 2.6, 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = pal.helmet;
    ctx.beginPath(); ctx.arc(0.6, 0, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(1.4, -1, 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = pal.mark;
    ctx.beginPath(); ctx.arc(-1.2, -4.4, 1.15, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawTank(ctx, u) {
    const pal = PAL[u.team];
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.save();
    ctx.rotate(u.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, -19, -11, 46, 30, 4); ctx.fill();
    // tracks
    ctx.fillStyle = '#25231f';
    roundRect(ctx, -23, -15, 46, 8, 3); ctx.fill();
    roundRect(ctx, -23, 7, 46, 8, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(95,90,78,0.85)';
    ctx.lineWidth = 1;
    const off = u.tread % 5;
    ctx.beginPath();
    for (let x = -22 + off; x < 22; x += 5) {
      ctx.moveTo(x, -14.5); ctx.lineTo(x, -7.5);
      ctx.moveTo(x, 7.5); ctx.lineTo(x, 14.5);
    }
    ctx.stroke();
    // hull
    const gr = ctx.createLinearGradient(0, -10, 0, 10);
    gr.addColorStop(0, pal.hullL); gr.addColorStop(0.5, pal.hull); gr.addColorStop(1, pal.hullD);
    ctx.fillStyle = gr;
    roundRect(ctx, -20, -10.5, 40, 21, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(13, -9, 6, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    for (let x = -18; x < -10; x += 2.5) { ctx.moveTo(x, -6); ctx.lineTo(x, 6); }
    ctx.stroke();
    ctx.restore();
    // turret
    ctx.rotate(u.turret);
    const rec = u.recoil * 5;
    ctx.fillStyle = pal.hullD;
    ctx.fillRect(8 - rec, -1.9, 26, 3.8);
    ctx.fillStyle = '#2c2e28';
    ctx.fillRect(32 - rec, -2.8, 4, 5.6);
    const tg = ctx.createRadialGradient(-3, -3, 2, 0, 0, 13);
    tg.addColorStop(0, pal.hullL); tg.addColorStop(1, pal.hull);
    ctx.fillStyle = tg;
    roundRect(ctx, -12, -9, 22, 18, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = pal.hullD;
    ctx.beginPath(); ctx.arc(-4, -2.5, 3.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
    ctx.fillStyle = pal.mark;
    ctx.fillRect(-10, 4, 4, 3);
    ctx.restore();
  }

  drawBunker(ctx, u) {
    const pal = PAL[u.team];
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(5, 6, 24, 0, TAU); ctx.fill();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.fillStyle = i % 2 ? '#a8966c' : '#b3a27a';
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * 25, Math.sin(a) * 25, 5.5, 4, a + Math.PI / 2, 0, TAU); ctx.fill();
    }
    const gr = ctx.createRadialGradient(-5, -5, 3, 0, 0, 20);
    gr.addColorStop(0, '#9a998f'); gr.addColorStop(1, '#6d6c64');
    ctx.fillStyle = gr;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
    ctx.rotate(u.angle);
    ctx.fillStyle = '#1b1a18';
    ctx.fillRect(12, -6, 6, 12);
    ctx.strokeStyle = '#1d1c19'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(22, 0); ctx.stroke();
    ctx.fillStyle = pal.mark;
    ctx.beginPath(); ctx.arc(-8, 0, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawWreck(ctx, w) {
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.angle);
    ctx.fillStyle = '#1c1a17';
    roundRect(ctx, -23, -15, 46, 8, 3); ctx.fill();
    roundRect(ctx, -23, 7, 46, 8, 3); ctx.fill();
    ctx.fillStyle = '#3a332b';
    roundRect(ctx, -20, -10.5, 40, 21, 3); ctx.fill();
    ctx.fillStyle = 'rgba(120,60,30,0.5)';
    ctx.fillRect(-12, -6, 8, 5); ctx.fillRect(4, 2, 9, 5);
    ctx.rotate(w.turret - w.angle);
    ctx.fillStyle = '#2a2520';
    ctx.fillRect(6, -1.9, 22, 3.8);
    roundRect(ctx, -12, -9, 22, 18, 5); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-4, -2.5, 3.4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawCorpse(ctx, c) {
    const pal = PAL[c.team];
    ctx.save();
    ctx.globalAlpha = c.t > 30 ? Math.max(0, 1 - (c.t - 30) / 10) : 1;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = pal.uniD;
    roundRect(ctx, -11, -3, 14, 6, 3); ctx.fill();
    ctx.fillStyle = pal.boot;
    ctx.fillRect(-14, -2.5, 3, 2); ctx.fillRect(-14, 0.5, 3, 2);
    ctx.fillStyle = pal.helmet;
    ctx.beginPath(); ctx.arc(6, 3, 3.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawMinimap(g, mctx, cam, mw, mh) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(g.map.thumb, 0, 0, mw, mh);
    const sx = mw / W, sy = mh / H;
    const showAll = g.demo || g.over;
    if (!showAll) {
      mctx.globalAlpha = 0.55;
      mctx.drawImage(this.fog, 0, 0, mw, mh);
      mctx.globalAlpha = 1;
    }
    for (const p of g.points) {
      mctx.fillStyle = p.owner === 0 ? '#4aa3ff' : p.owner === 1 ? '#ff5040' : '#e6e2d4';
      mctx.beginPath(); mctx.arc(p.x * sx, p.y * sy, 6, 0, TAU); mctx.fill();
      mctx.strokeStyle = p.contested ? '#ffd24d' : 'rgba(0,0,0,0.7)';
      mctx.lineWidth = 1.5; mctx.stroke();
      mctx.fillStyle = '#111';
      mctx.font = '700 8px system-ui, sans-serif';
      mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
      mctx.fillText(p.id, p.x * sx, p.y * sy + 0.5);
    }
    for (const u of g.units) {
      if (!showAll && u.team === 1 && !u.seen[0]) continue;
      mctx.fillStyle = u.team === 0 ? (g.selection.has(u) ? '#b6ff9a' : '#5fb2ff') : '#ff5a48';
      const s = u.def.vehicle ? 4 : u.def.static ? 4 : 2.4;
      mctx.fillRect(u.x * sx - s / 2, u.y * sy - s / 2, s, s);
    }
    for (const m of g.markers) {
      if (m.kind !== 'barrage') continue;
      mctx.strokeStyle = m.team === 0 ? '#ffc85a' : '#ff4632';
      mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.arc(m.x * sx, m.y * sy, m.r * sx, 0, TAU); mctx.stroke();
    }
    const vw = this.w / cam.zoom, vh = this.h / cam.zoom;
    mctx.strokeStyle = 'rgba(255,255,255,0.9)';
    mctx.lineWidth = 1.5;
    mctx.strokeRect((cam.x - vw / 2) * sx, (cam.y - vh / 2) * sy, vw * sx, vh * sy);
  }
}
