// renderer.js — the chase view: camera, terrain, runway, rings, clouds,
// scenery, and the Kestrel herself, all drawn on one 2D canvas.
//
// The camera sits behind and above the plane and looks forward along the
// nose, staying level with the horizon so it never fights the pilot. The
// world is projected with a plain perspective camera; terrain is a grid
// of coloured quads painted far-to-near with distance haze.

import {
  groundHeight, groundColour, shadeColour, clamp, lerp, smoothstep,
} from './terrain.js';
import { paintSky, paintCloud, cloudList, SUN_AZIMUTH, SUN_ELEVATION } from './sky.js';
import { HOME_STRIP, NORTH_STRIP, SCENERY, stripContains, ringOffset } from './world.js';
import { feet, knots, headingDegrees } from './plane.js';

const FOV = 68; // degrees, vertical

export function makeCamera() {
  return { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };
}

function normalise(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// Chase camera: behind the plane, above it, looking a little ahead of it.
// The camera stays level (no roll) so the horizon stays put.
export function updateCamera(camera, plane) {
  const fx = Math.sin(plane.heading);
  const fz = Math.cos(plane.heading);
  const dist = 15;
  const height = 5.2;
  camera.x = plane.x - fx * dist;
  camera.y = plane.y + height;
  camera.z = plane.z - fz * dist;
  const target = [
    plane.x + fx * 40,
    plane.y + 1.5 + plane.pitch * 12,
    plane.z + fz * 40,
  ];
  const f = normalise([target[0] - camera.x, target[1] - camera.y, target[2] - camera.z]);
  // Right is world-up crossed with forward (east when looking north);
  // up is forward crossed with right. Getting this handedness right is
  // what keeps the view swinging the way the stick turns.
  const r = normalise(cross([0, 1, 0], f));
  const u = cross(f, r);
  camera.fx = f[0]; camera.fy = f[1]; camera.fz = f[2];
  camera.rx = r[0]; camera.ry = r[1]; camera.rz = r[2];
  camera.ux = u[0]; camera.uy = u[1]; camera.uz = u[2];
}

// Project a world point to screen space. Returns null when behind camera.
export function makeProjector(camera, width, height) {
  const focal = (height / 2) / Math.tan((FOV * Math.PI / 180) / 2);
  const cx = width / 2;
  const cy = height / 2;
  return function project(x, y, z) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dz = z - camera.z;
    const cz = dx * camera.fx + dy * camera.fy + dz * camera.fz;
    if (cz < 1.5) return null;
    const px = dx * camera.rx + dy * camera.ry + dz * camera.rz;
    const py = dx * camera.ux + dy * camera.uy + dz * camera.uz;
    const s = focal / cz;
    return { x: cx + px * s, y: cy - py * s, dist: cz, scale: s };
  };
}

// Clip a world-space polygon against the camera's near plane and return
// its screen points (or null when nothing survives). Corners behind the
// camera are clipped, not dropped, so a runway the camera sits on still
// draws instead of vanishing.
export function projectClipped(camera, width, height, pts) {
  const focal = (height / 2) / Math.tan((FOV * Math.PI / 180) / 2);
  const cx = width / 2;
  const cy = height / 2;
  let cs = pts.map(([x, y, z]) => {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dz = z - camera.z;
    return {
      x: dx * camera.rx + dy * camera.ry + dz * camera.rz,
      y: dx * camera.ux + dy * camera.uy + dz * camera.uz,
      z: dx * camera.fx + dy * camera.fy + dz * camera.fz,
    };
  });
  // Sutherland–Hodgman against z >= 1.5.
  const clipped = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const aIn = a.z >= 1.5;
    const bIn = b.z >= 1.5;
    if (aIn) clipped.push(a);
    if (aIn !== bIn) {
      const t = (1.5 - a.z) / (b.z - a.z);
      clipped.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: 1.5,
      });
    }
  }
  if (clipped.length < 3) return null;
  return clipped.map((p) => ({
    x: cx + (p.x * focal) / p.z,
    y: cy - (p.y * focal) / p.z,
    dist: p.z,
  }));
}

function fillScreenPoly(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}
export function sunScreenPosition(camera, width, height) {
  const dir = [
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  ];
  const project = makeProjector(camera, width, height);
  const far = 4000;
  return project(
    camera.x + dir[0] * far,
    camera.y + dir[1] * far,
    camera.z + dir[2] * far,
  );
}

// ---- Terrain -------------------------------------------------------------

function paintTerrain(ctx, camera, project, width, height, horizonY) {
  const step = 55;
  const cols = 30;
  const rows = 38;
  const x0 = Math.round((camera.x - (cols / 2) * step) / step) * step;
  const zFar = Math.round((camera.z + rows * step) / step) * step;
  const z0 = zFar - rows * step;

  // Heights for the grid corners.
  const heights = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    const z = z0 + r * step;
    for (let c = 0; c <= cols; c++) {
      row.push(groundHeight(x0 + c * step, z));
    }
    heights.push(row);
  }

  // Far ridge silhouette, drawn first so the grid overlaps it.
  paintFarRidge(ctx, camera, project, width, height);

  // Near ground: the grid's first row sits a little ahead of the camera,
  // and its last row stops short of the horizon, so fill below the horizon
  // first — hazy at the top where it meets the fogged distance, the local
  // ground colour at the bottom where the wheels are. The grid paints
  // over the middle of it.
  const nearColour = groundColour(camera.x, camera.z, groundHeight(camera.x, camera.z));
  const fillGrad = ctx.createLinearGradient(0, Math.max(0, horizonY), 0, height);
  fillGrad.addColorStop(0, 'rgb(178, 205, 224)');
  fillGrad.addColorStop(0.45, `rgb(${nearColour[0]},${nearColour[1]},${nearColour[2]})`);
  fillGrad.addColorStop(1, `rgb(${nearColour[0]},${nearColour[1]},${nearColour[2]})`);
  ctx.fillStyle = fillGrad;
  ctx.fillRect(0, Math.max(0, horizonY), width, height - Math.max(0, horizonY));

  for (let r = rows - 1; r >= 0; r--) {
    const z = z0 + r * step;
    const z2 = z + step;
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * step;
      const x2 = x + step;
      const h00 = heights[r][c];
      const h10 = heights[r][c + 1];
      const h01 = heights[r + 1][c];
      const h11 = heights[r + 1][c + 1];
      const p00 = project(x, h00, z);
      const p10 = project(x2, h10, z);
      const p01 = project(x, h01, z2);
      const p11 = project(x2, h11, z2);
      if (!p00 || !p10 || !p01 || !p11) continue;
      // Skip cells entirely off screen.
      const minX = Math.min(p00.x, p10.x, p01.x, p11.x);
      const maxX = Math.max(p00.x, p10.x, p01.x, p11.x);
      const minY = Math.min(p00.y, p10.y, p01.y, p11.y);
      const maxY = Math.max(p00.y, p10.y, p01.y, p11.y);
      if (maxX < -40 || minX > width + 40 || maxY < -40 || minY > height + 40) continue;
      const midH = (h00 + h10 + h01 + h11) / 4;
      const midX = x + step / 2;
      const midZ = z + step / 2;
      // Slope lighting: faces tilted toward the sun are brighter.
      const slope = Math.abs(h10 - h00) + Math.abs(h01 - h00);
      const light = clamp(1.02 - slope * 0.012, 0.55, 1.05);
      const dist = p00.dist;
      const fog = smoothstep(650, 2100, dist);
      ctx.fillStyle = shadeColour(groundColour(midX, midZ, midH), light, fog);
      ctx.beginPath();
      ctx.moveTo(p00.x, p00.y);
      ctx.lineTo(p10.x, p10.y);
      ctx.lineTo(p11.x, p11.y);
      ctx.lineTo(p01.x, p01.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function paintFarRidge(ctx, camera, project, width, height) {
  ctx.beginPath();
  let started = false;
  const z = camera.z + 2600;
  for (let x = camera.x - 4200; x <= camera.x + 4200; x += 200) {
    const h = groundHeight(x, z) + 40;
    const p = project(x, h, z);
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.x, height + 10);
      ctx.lineTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  if (started) {
    ctx.lineTo(width + 10, height + 10);
    ctx.closePath();
    // Hazy distant ridge: pale at the top, fading into the horizon haze.
    const ridgeGrad = ctx.createLinearGradient(0, 0, 0, height);
    ridgeGrad.addColorStop(0, 'rgb(158, 186, 210)');
    ridgeGrad.addColorStop(1, 'rgb(196, 216, 232)');
    ctx.fillStyle = ridgeGrad;
    ctx.fill();
  }
}

// ---- Runway --------------------------------------------------------------

function paintStrip(ctx, camera, width, height, strip, isHome) {
  const s = Math.sin(strip.heading);
  const c = Math.cos(strip.heading);
  const hw = strip.width / 2;
  const hl = strip.length / 2;
  // Corners: right = (cos, -sin) in x/z for a heading rotation.
  const corner = (along, across) => ({
    x: strip.x + s * along + c * across,
    z: strip.z + c * along - s * across,
  });
  const g = (p) => groundHeight(p.x, p.z);
  const quad = (p1, p2, p3, p4) => [
    [p1.x, g(p1) + 0.4, p1.z],
    [p2.x, g(p2) + 0.4, p2.z],
    [p3.x, g(p3) + 0.4, p3.z],
    [p4.x, g(p4) + 0.4, p4.z],
  ];
  const a = corner(-hl, -hw);
  const b = corner(-hl, hw);
  const cc = corner(hl, hw);
  const d = corner(hl, -hw);
  const asphalt = projectClipped(camera, width, height, quad(a, b, cc, d));
  if (!asphalt) return;
  ctx.fillStyle = isHome ? '#3a3f45' : '#46443c';
  fillScreenPoly(ctx, asphalt);
  // Centreline dashes.
  ctx.fillStyle = '#e8e8e0';
  for (let along = -hl + 30; along < hl - 20; along += 42) {
    const p1 = corner(along, -1.2);
    const p2 = corner(along + 18, 1.2);
    const q1 = corner(along, 1.2);
    const q2 = corner(along + 18, -1.2);
    const dash = projectClipped(camera, width, height, quad(p1, q1, q2, p2));
    if (dash) fillScreenPoly(ctx, dash);
  }
  // Threshold bars at both ends.
  ctx.fillStyle = '#f2f2ea';
  for (const end of [-hl + 8, hl - 16]) {
    const p1 = corner(end, -hw + 3);
    const p2 = corner(end + 8, hw - 3);
    const q1 = corner(end, hw - 3);
    const q2 = corner(end + 8, -hw + 3);
    const bar = projectClipped(camera, width, height, quad(p1, q1, q2, p2));
    if (bar) fillScreenPoly(ctx, bar);
  }
  // Runway number painted at the south end.
  const num = corner(-hl + 34, 0);
  const np = projectClipped(camera, width, height, [[num.x, g(num) + 0.6, num.z]]);
  if (np && np[0].dist < 900) {
    ctx.fillStyle = '#f2f2ea';
    ctx.font = `bold ${Math.max(10, Math.round(4200 / np[0].dist))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(isHome ? '18' : '36', np[0].x, np[0].y);
  }
}

// ---- Rings, clouds, scenery ----------------------------------------------

function paintRing(ctx, project, ring, state, time) {
  // Ring frame: right = (cos h, 0, -sin h), up = (0,1,0).
  const rx = Math.cos(ring.heading);
  const rz = -Math.sin(ring.heading);
  const segments = 28;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const px = ring.x + rx * Math.cos(a) * ring.radius;
    const py = ring.y + Math.sin(a) * ring.radius;
    const pz = ring.z + rz * Math.cos(a) * ring.radius;
    const p = project(px, py, pz);
    if (p) points.push(p);
  }
  const centre = project(ring.x, ring.y, ring.z);
  const d = centre ? centre.dist : 9999;
  const widthPx = clamp(9000 / d, 2.5, 14);
  const pulse = 0.75 + 0.25 * Math.sin(time * 3);
  let colour;
  if (ring.passed) colour = '110, 220, 130';
  else if (state === 'next') colour = '255, 196, 66';
  else colour = '86, 205, 235';
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(${colour}, ${0.28 * pulse})`;
  ctx.lineWidth = widthPx * 2.6;
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = `rgba(${colour}, 0.95)`;
  ctx.lineWidth = Math.max(2, widthPx * 0.7);
  ctx.stroke();
  // Small chevrons on the ring to show the fly-through direction.
  if (state === 'next' && centre && d < 900) {
    ctx.fillStyle = `rgba(255, 220, 120, 0.95)`;
    ctx.font = `bold ${Math.max(13, Math.round(5200 / d))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(ring.label, centre.x, centre.y - ring.radius * centre.scale - 14);
  }
  ctx.restore();
}

function paintClouds(ctx, camera, project) {
  for (const cloud of cloudList()) {
    const p = project(cloud.x, cloud.y, cloud.z);
    if (!p) continue;
    const r = Math.max(6, cloud.size * p.scale * 0.5);
    if (r < 4) continue;
    const alpha = clamp(1.1 - p.dist / 6500, 0.15, 0.85);
    paintCloud(ctx, p.x, p.y, r, cloud.puffs, alpha);
  }
}

function paintScenery(ctx, project, time) {
  // Village: a cluster of small gabled houses with warm roofs.
  const v = SCENERY.village;
  for (let i = 0; i < v.houses; i++) {
    const hx = v.x + ((i * 37) % 220) - 110;
    const hz = v.z + ((i * 53) % 180) - 90;
    const h = groundHeight(hx, hz);
    const p = project(hx, h, hz);
    if (!p || p.dist > 1300) continue;
    const s = Math.max(3, 1100 / p.dist);
    ctx.fillStyle = '#e8ddc4';
    ctx.fillRect(p.x - s, p.y - s * 1.4, s * 2, s * 1.4);
    ctx.fillStyle = i % 3 === 0 ? '#a4543c' : '#7d5a44';
    ctx.beginPath();
    ctx.moveTo(p.x - s * 1.2, p.y - s * 1.4);
    ctx.lineTo(p.x, p.y - s * 2.4);
    ctx.lineTo(p.x + s * 1.2, p.y - s * 1.4);
    ctx.closePath();
    ctx.fill();
  }
  // Radio mast with a blinking red beacon.
  const m = SCENERY.mast;
  const base = project(m.x, groundHeight(m.x, m.z), m.z);
  const top = project(m.x, groundHeight(m.x, m.z) + m.height, m.z);
  if (base && top) {
    ctx.strokeStyle = '#5a6068';
    ctx.lineWidth = Math.max(1.5, 500 / base.dist);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    if (Math.sin(time * 2.4) > 0) {
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(top.x, top.y, Math.max(2, 600 / base.dist), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Windsock at the home strip, streaming with the wind.
  const w = SCENERY.windsockHome;
  const wp = project(w.x, groundHeight(w.x, w.z) + 9, w.z);
  const wb = project(w.x, groundHeight(w.x, w.z), w.z);
  if (wp && wb) {
    ctx.strokeStyle = '#8a8f96';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wb.x, wb.y);
    ctx.lineTo(wp.x, wp.y);
    ctx.stroke();
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(wp.x, wp.y);
    ctx.lineTo(wp.x + 14, wp.y + 3);
    ctx.lineTo(wp.x, wp.y + 6);
    ctx.closePath();
    ctx.fill();
  }
}

// The plane's shadow on the ground below, so height reads at a glance.
function paintGroundShadow(ctx, project, plane) {
  const g = groundHeight(plane.x, plane.z);
  const p = project(plane.x, g + 0.6, plane.z);
  if (!p) return;
  const heightAbove = Math.max(0, plane.y - g);
  const r = clamp(2600 / Math.max(p.dist, 1), 4, 46) * clamp(1 - heightAbove / 500, 0.25, 1);
  ctx.save();
  ctx.globalAlpha = clamp(0.34 - heightAbove / 1400, 0.06, 0.34);
  ctx.fillStyle = '#1a2a1a';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- The aircraft --------------------------------------------------------

// Drawn in screen space, centred just below the middle of the frame, as
// seen from the chase camera behind and slightly above: tail near the
// viewer, nose pointing away. Bank rolls the whole drawing.
export function paintAircraft(ctx, width, height, plane, time) {
  const cx = width / 2;
  const cy = height * 0.54 + plane.pitch * 60;
  const scale = Math.min(width, height) / 800;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(plane.bank * 0.9);
  ctx.scale(scale, scale);

  const body = '#dfe6ec';
  const bodyDark = '#9fb0bd';
  const accent = '#e8641c'; // Kestrel orange cheatline
  const dark = '#2c3844';

  // Wings: swept, slightly drooped at the tips, with orange tips.
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.moveTo(-14, 26);
  ctx.lineTo(-168, 66);
  ctx.lineTo(-176, 82);
  ctx.lineTo(-20, 58);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 26);
  ctx.lineTo(168, 66);
  ctx.lineTo(176, 82);
  ctx.lineTo(20, 58);
  ctx.closePath();
  ctx.fill();
  // Wingtip nav lights: red left, green right, white strobe blinking.
  ctx.fillStyle = '#ff2d2d';
  ctx.beginPath(); ctx.arc(-172, 74, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2dff5e';
  ctx.beginPath(); ctx.arc(172, 74, 4.5, 0, Math.PI * 2); ctx.fill();
  if (Math.sin(time * 6) > 0.4) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, 92, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // Fuselage: wide at the tail (near), tapering to the nose (far).
  const fuselage = ctx.createLinearGradient(-26, 0, 26, 0);
  fuselage.addColorStop(0, '#b9c7d2');
  fuselage.addColorStop(0.5, '#f4f7f9');
  fuselage.addColorStop(1, '#b9c7d2');
  ctx.fillStyle = fuselage;
  ctx.beginPath();
  ctx.moveTo(-24, 96);
  ctx.quadraticCurveTo(-30, 30, -13, -58);
  ctx.quadraticCurveTo(-6, -84, 0, -86);
  ctx.quadraticCurveTo(6, -84, 13, -58);
  ctx.quadraticCurveTo(30, 30, 24, 96);
  ctx.quadraticCurveTo(0, 106, -24, 96);
  ctx.closePath();
  ctx.fill();
  // Orange cheatline down the fuselage.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-25, 78);
  ctx.lineTo(-13, -52);
  ctx.lineTo(-9, -52);
  ctx.lineTo(-19, 78);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(25, 78);
  ctx.lineTo(13, -52);
  ctx.lineTo(9, -52);
  ctx.lineTo(19, 78);
  ctx.closePath();
  ctx.fill();
  // Canopy: dark glass over the nose.
  ctx.fillStyle = '#1d2f3d';
  ctx.beginPath();
  ctx.ellipse(0, -52, 9, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(160, 210, 235, 0.7)';
  ctx.beginPath();
  ctx.ellipse(-2, -58, 3.5, 12, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Vertical fin at the tail, with the Kestrel mark.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-4, 96);
  ctx.lineTo(-7, 52);
  ctx.lineTo(0, 38);
  ctx.lineTo(7, 52);
  ctx.lineTo(4, 96);
  ctx.closePath();
  ctx.fill();
  // Horizontal stabilisers.
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.moveTo(-10, 88);
  ctx.lineTo(-72, 106);
  ctx.lineTo(-74, 114);
  ctx.lineTo(-10, 100);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, 88);
  ctx.lineTo(72, 106);
  ctx.lineTo(74, 114);
  ctx.lineTo(10, 100);
  ctx.closePath();
  ctx.fill();

  // Twin engine nozzles with a heat glow that follows the throttle.
  const glow = 0.35 + plane.throttle * 0.65;
  for (const side of [-1, 1]) {
    const ex = side * 13;
    const eg = ctx.createRadialGradient(ex, 104, 1, ex, 104, 16 * glow + 4);
    eg.addColorStop(0, `rgba(255, 190, 90, ${0.9 * glow})`);
    eg.addColorStop(0.5, `rgba(255, 110, 40, ${0.45 * glow})`);
    eg.addColorStop(1, 'rgba(255, 110, 40, 0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, 104, 16 * glow + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(ex, 100, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 180, 80, ${glow})`;
    ctx.beginPath();
    ctx.arc(ex, 100, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Registration on the tail.
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('K-7', 0, 66);

  ctx.restore();
}

// ---- Frame ----------------------------------------------------------------

export function renderFrame(ctx, width, height, state) {
  const { camera, plane, run, time } = state;
  updateCamera(camera, plane);
  const project = makeProjector(camera, width, height);
  const sun = sunScreenPosition(camera, width, height);
  ctx.sunScreen = sun && sun.dist > 0 ? [sun.x, sun.y] : null;

  // Horizon line for the sky gradient.
  const horizonPoint = project(camera.x + camera.fx * 1000, camera.y, camera.z + camera.fz * 1000);
  const horizonY = horizonPoint ? horizonPoint.y : height * 0.42;
  paintSky(ctx, width, height, horizonY, plane.pitch);

  paintTerrain(ctx, camera, project, width, height, horizonY);
  paintStrip(ctx, camera, width, height, HOME_STRIP, true);
  paintStrip(ctx, camera, width, height, NORTH_STRIP, false);
  paintScenery(ctx, project, time);
  paintClouds(ctx, camera, project);
  paintGroundShadow(ctx, project, plane);

  if (run) {
    run.rings.forEach((ring, i) => {
      const ringState = ring.passed ? 'passed' : i === run.ringIndex ? 'next' : 'later';
      paintRing(ctx, project, ring, ringState, time);
    });
  }

  paintAircraft(ctx, width, height, plane, time);
  ctx.sunScreen = null;
}

export { feet, knots, headingDegrees };
