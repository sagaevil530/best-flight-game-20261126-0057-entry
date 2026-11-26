// terrain.js — the valley the game flies over.
//
// Kestrel Ridge is one long valley running north-south, walled in by two
// mountain ridges, with a river winding down its floor and a grass strip
// at its southern end. Everything here is deterministic: the same
// coordinates always give the same ground, so screenshots and replays agree.

export const VALLEY_HALF = 420; // metres either side of the centreline that stay flat-ish
export const RIDGE_START = 520; // where the mountains begin to rise
export const RIDGE_TOP = 1500; // where the mountains stop getting taller
export const PEAK_HEIGHT = 640; // tallest summit, metres above the valley floor

// A small deterministic hash-noise, built from sines so it needs no tables.
export function hashNoise(x, z) {
  const s = Math.sin(x * 0.021 + z * 0.017) * 43758.5453
    + Math.sin(x * 0.008 - z * 0.013) * 12543.1234;
  return s - Math.floor(s);
}

function smoothNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const sx = xf * xf * (3 - 2 * xf);
  const sz = zf * zf * (3 - 2 * zf);
  const a = hashNoise(xi, zi);
  const b = hashNoise(xi + 1, zi);
  const c = hashNoise(xi, zi + 1);
  const d = hashNoise(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// Fractal ridge noise, 0..1.
function ridgeNoise(x, z) {
  let total = 0;
  let amp = 0.55;
  let freq = 0.0016;
  for (let octave = 0; octave < 4; octave++) {
    total += amp * smoothNoise(x * freq, z * freq);
    amp *= 0.5;
    freq *= 2.1;
  }
  return total;
}

// Height of the ground in metres at world (x, z). x east, z north.
export function groundHeight(x, z) {
  const ax = Math.abs(x);
  // Valley floor: gentle rolling hills, never steep near the centreline.
  // The floor sits a few metres above sea level so the altimeter never
  // reads negative on the strip.
  const floor = 12 + 14 * ridgeNoise(x * 0.6 + 40, z * 0.6)
    + 6 * Math.sin(z * 0.004) * Math.cos(x * 0.006);
  // Mountain walls: rise smoothly once past the valley edge, with ridges.
  const rise = smoothstep(RIDGE_START, RIDGE_TOP, ax);
  const mountains = rise * (180 + PEAK_HEIGHT * ridgeNoise(x + 900, z));
  // A second, lower ridge far to the east and west so the horizon is never flat.
  const far = smoothstep(2400, 4200, ax);
  const farRange = far * (300 + 500 * ridgeNoise(x * 0.5 + 31, z * 0.5 + 7));
  return floor + mountains + farRange;
}

// The river snakes down the valley floor; returns distance in metres from
// the river centreline at (x, z). Negative means "on the river".
export function riverDistance(x, z) {
  const centre = 220 * Math.sin(z * 0.0009 + 1.2) + 90 * Math.sin(z * 0.0027);
  return Math.abs(x - centre) - 16;
}

export function smoothstep(edge0, edge1, v) {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Colour of the ground at (x, z, height), as [r, g, b]. Valley grass,
// river blue, bare rock on steep slopes, snow on the high peaks.
export function groundColour(x, z, h) {
  const n = ridgeNoise(x * 1.7 + 11, z * 1.7 + 5);
  if (riverDistance(x, z) < 0 && h < 60) return [58, 122, 158];
  if (h > 470) return [238, 240, 244]; // snow
  if (h > 300) return [122, 112, 102]; // high rock
  if (h > 150) {
    // scree: rock flecked with alpine grass
    const mix = n > 0.55 ? [96, 104, 74] : [128, 118, 104];
    return mix;
  }
  // valley grass, patched by meadow and pine darkening
  const g = 92 + Math.floor(n * 46);
  return [74 + Math.floor(n * 22), g, 52 + Math.floor(n * 18)];
}

// Shade a ground colour by a slope/lighting factor 0..1 and a distance fog
// factor 0..1 (1 = fully fogged). Fog colour is the pale horizon blue.
export function shadeColour(rgb, light, fog) {
  const fogR = 178;
  const fogG = 205;
  const fogB = 224;
  const r = rgb[0] * light;
  const g = rgb[1] * light;
  const b = rgb[2] * light;
  return `rgb(${Math.round(lerp(r, fogR, fog))},${Math.round(lerp(g, fogG, fog))},${Math.round(lerp(b, fogB, fog))})`;
}
