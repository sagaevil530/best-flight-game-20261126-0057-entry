// sky.js — the sky dome, sun, and drifting clouds.
//
// The sky is a vertical gradient with a low sun and a few soft cloud
// billboards. Clouds live at fixed world positions so the pilot can fly
// under them and watch them slide past.

import { clamp, lerp } from './terrain.js';

export const SUN_AZIMUTH = -0.9; // radians, west of north
export const SUN_ELEVATION = 0.42;

// Horizon and zenith colours for a late-afternoon alpine sky.
const HORIZON = [214, 228, 238];
const MID = [138, 186, 222];
const ZENITH = [58, 110, 178];

export function paintSky(ctx, width, height, horizonY, pitch) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, rgb(ZENITH));
  grad.addColorStop(Math.max(0, Math.min(1, horizonY / height)), rgb(MID));
  grad.addColorStop(1, rgb(HORIZON));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Sun disc with a warm halo, placed by azimuth/elevation relative to
  // the camera heading. Its screen position is handed in by the renderer
  // through the shared sunScreen slot on the context.
  if (ctx.sunScreen) {
    const [sx, sy] = ctx.sunScreen;
    const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, 180);
    halo.addColorStop(0, 'rgba(255, 236, 180, 0.9)');
    halo.addColorStop(0.25, 'rgba(255, 214, 130, 0.45)');
    halo.addColorStop(1, 'rgba(255, 214, 130, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 190, sy - 190, 380, 380);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  void pitch;
}

function rgb(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Cloud billboards: fixed world positions, so they parallax honestly.
const CLOUDS = [];
(function seedClouds() {
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    CLOUDS.push({
      x: (rand() - 0.5) * 9000,
      z: (rand() - 0.5) * 9000,
      y: 520 + rand() * 260,
      size: 180 + rand() * 320,
      puffs: 3 + Math.floor(rand() * 3),
    });
  }
})();

export function cloudList() {
  return CLOUDS;
}

// Draw one cloud billboard centred at screen (sx, sy) with radius r.
export function paintCloud(ctx, sx, sy, r, puffs, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < puffs; i++) {
    const off = (i - (puffs - 1) / 2) * r * 0.55;
    const pr = r * (0.55 + 0.14 * Math.sin(i * 2.3 + 1));
    ctx.beginPath();
    ctx.ellipse(sx + off, sy - Math.abs(off) * 0.12, pr, pr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Distance haze colour used by the terrain renderer for far ground.
export function fogColour() {
  return [178, 205, 224];
}

export { clamp, lerp };
