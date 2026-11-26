// world.js — the airfield, the remote strip, and the scenery the pilot
// navigates by: runways, windsocks, a lake-side village, and the ring
// gates each mission flies through.

import { groundHeight, clamp } from './terrain.js';

// Home strip: "Kestrel Field", a grass-and-asphalt strip in the valley.
export const HOME_STRIP = {
  name: 'Kestrel Field',
  x: 0,
  z: 0,
  heading: 0, // runway runs north-south
  length: 620,
  width: 26,
};

// Remote strip for the courier mission, 4.2 km north, beside the lake.
export const NORTH_STRIP = {
  name: 'Laketown Strip',
  x: 210,
  z: 4200,
  heading: 0.12,
  length: 480,
  width: 22,
};

// Is (x, z) over either runway's pavement? Used for landing checks.
export function onStrip(x, z) {
  return stripContains(HOME_STRIP, x, z) || stripContains(NORTH_STRIP, x, z);
}

export function stripContains(strip, x, z) {
  const dx = x - strip.x;
  const dz = z - strip.z;
  const along = dx * Math.sin(strip.heading) + dz * Math.cos(strip.heading);
  const across = dx * Math.cos(strip.heading) - dz * Math.sin(strip.heading);
  return Math.abs(along) < strip.length / 2 && Math.abs(across) < strip.width / 2;
}

export function stripForName(name) {
  return name === 'Laketown Strip' ? NORTH_STRIP : HOME_STRIP;
}

// Ring gates: a ring is a glowing hoop the pilot flies through. Each ring
// has a centre, a radius, and the direction the pilot should be flying
// when they pass it (the ring faces that way).
export function makeRing(x, y, z, radius, heading, label) {
  return {
    x, y, z, radius, heading, label,
    passed: false,
    bestMiss: null, // metres from centre at the moment of passing
  };
}

// Distance from the plane to a ring's centre, in the ring's own frame:
// along = how far past the ring plane, across = how far off centre.
export function ringOffset(ring, px, py, pz) {
  const dx = px - ring.x;
  const dz = pz - ring.z;
  const along = dx * Math.sin(ring.heading) + dz * Math.cos(ring.heading);
  const across = dx * Math.cos(ring.heading) - dz * Math.sin(ring.heading);
  const dy = py - ring.y;
  return { along, across, dy, miss: Math.hypot(across, dy) };
}

// Scenery the pilot steers by: a village, a lake, a radio mast, windsocks.
export const SCENERY = {
  village: { x: 260, z: 1750, houses: 14 },
  mast: { x: -560, z: 900, height: 120 },
  windsockHome: { x: 34, z: -180 },
  windsockNorth: { x: 236, z: 4020 },
  lake: { x: 210, z: 3900, radius: 320 },
};

// Height of the terrain plus a windsock pole, for drawing the sock.
export function windsockHeight(x, z) {
  return groundHeight(x, z) + 9;
}

export { clamp };
