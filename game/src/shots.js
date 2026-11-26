// shots.js — deterministic staging for screenshots.
//
// ?shot=cover | takeoff | approach | menu (with ?seed= for the terrain
// variant) puts the game into a photogenic state the moment it loads, so
// a screenshot is a real render of the game's own code, just staged.
// Nothing here changes how the game plays; it only chooses where the
// plane starts and which mission is selected.

import { makePlane, placeOnRunway } from './plane.js';
import { startRun, missionByIndex } from './missions.js';
import { HOME_STRIP, stripForName } from './world.js';
import { groundHeight } from './terrain.js';

export function parseShotParams(search) {
  const params = new URLSearchParams(search);
  return {
    shot: params.get('shot') || '',
    seed: Number(params.get('seed') || 1),
  };
}

// Apply a shot preset to a fresh game object. Returns true when a preset
// was applied (the game should then render one frame and stop the clock
// for the screenshot), false for normal interactive play.
export function applyShot(game, shot) {
  if (!shot) return false;
  const plane = game.plane;

  if (shot === 'menu') {
    game.phase = 'menu';
    game.selectedMission = 1;
    return true;
  }

  if (shot === 'takeoff') {
    game.selectedMission = 0;
    game.run = startRun(missionByIndex(0));
    placeOnRunway(plane, HOME_STRIP);
    plane.throttle = 0.85;
    plane.speed = 46;
    plane.heading = 0;
    game.phase = 'flying';
    game.toast = { text: 'THROTTLE UP — ROTATE AT 100 KT', colour: '#ffc442' };
    return true;
  }

  if (shot === 'approach') {
    game.selectedMission = 1;
    game.run = startRun(missionByIndex(1));
    game.run.tookOff = true;
    game.run.rings.forEach((r) => { r.passed = true; });
    game.run.ringIndex = game.run.rings.length;
    // Final approach: 420 m south of Laketown Strip, gear and flaps down.
    const strip = stripForName('Laketown Strip');
    plane.x = strip.x + 24;
    plane.z = strip.z - 420;
    plane.y = groundHeight(plane.x, plane.z) + 62;
    plane.heading = strip.heading;
    plane.pitch = -0.06;
    plane.bank = 0;
    plane.speed = 52;
    plane.throttle = 0.42;
    plane.gearDown = true;
    plane.flaps = true;
    plane.onGround = false;
    plane.fuel = 62;
    game.phase = 'flying';
    game.toast = { text: 'FINAL APPROACH — LAKETOWN STRIP', colour: '#6edc82' };
    return true;
  }

  // Default: 'cover' — mid-flight through the valley, second ring ahead,
  // instruments lit, runway behind, mountains on both sides.
  game.selectedMission = 0;
  game.run = startRun(missionByIndex(0));
  game.run.tookOff = true;
  game.run.rings[0].passed = true;
  game.run.ringIndex = 1;
  game.run.score = 320;
  game.run.time = 74;
  plane.x = 30;
  plane.z = 1080;
  plane.y = 235;
  plane.heading = 0.06;
  plane.pitch = 0.02;
  plane.bank = 0.1;
  plane.speed = 84;
  plane.throttle = 0.72;
  plane.gearDown = false;
  plane.flaps = false;
  plane.onGround = false;
  plane.fuel = 78;
  game.phase = 'flying';
  return true;
}

export { makePlane };
