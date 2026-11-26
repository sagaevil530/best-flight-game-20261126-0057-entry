// main.js — Kestrel Ridge: boot, game loop, and the state machine.
//
// Phases: menu → flying → paused → debrief (or crashed/landed banners
// inside flying). The loop steps the flight model at a fixed 60 Hz,
// checks ring crossings and landings, and draws the scene plus the HUD.
// A ?shot= preset freezes the clock after the first frames so a
// screenshot is deterministic; normal play runs in real time.

import { makePlane, placeOnRunway, stepPlane, knots, feet } from './plane.js';
import { makeCamera, renderFrame } from './renderer.js';
import { drawHud } from './hud.js';
import {
  makeInput, attachInput, readStick, held, wasPressed, endFrame,
} from './input.js';
import {
  makeAudio, ensureAudio, updateAudio, ringChime, warningBeep, thud,
} from './audio.js';
import {
  MISSIONS, missionByIndex, startRun, nextRing, ringsDone,
  scoreRingPass, scoreLanding, finishRun, failRun,
} from './missions.js';
import { HOME_STRIP, NORTH_STRIP, onStrip, stripContains, ringOffset, stripForName } from './world.js';
import { parseShotParams, applyShot } from './shots.js';
import { groundHeight } from './terrain.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const game = {
  phase: 'menu', // menu | flying | paused | debrief
  missions: MISSIONS,
  selectedMission: 0,
  plane: makePlane(),
  camera: makeCamera(),
  run: null,
  input: makeInput(),
  audio: makeAudio(),
  time: 0,
  bestScore: 0,
  isRecord: false,
  banner: null,
  bannerUntil: 0,
  toast: null,
  toastUntil: 0,
  stallWarnedAt: -10,
  lowFuelWarned: false,
  lastFrame: performance.now(),
  shotMode: false,
  framesRendered: 0,
};

function showBanner(text, sub, colour, seconds = 2.6) {
  game.banner = { text, sub, colour };
  game.bannerUntil = game.time + seconds;
}

function showToast(text, colour, seconds = 3.2) {
  game.toast = { text, colour };
  game.toastUntil = game.time + seconds;
}

function startMission(index) {
  const mission = missionByIndex(index);
  game.selectedMission = mission.index;
  game.run = startRun(mission);
  game.run.mission = mission;
  placeOnRunway(game.plane, HOME_STRIP);
  game.plane.fuel = mission.fuelStart;
  game.phase = 'flying';
  game.banner = null;
  game.toast = null;
  game.lowFuelWarned = false;
  showToast(`${mission.name} — ${mission.tagline}`, '#ffc442', 4);
  ensureAudio(game.audio);
}

function endRunToDebrief() {
  game.phase = 'debrief';
  game.isRecord = game.run.score > game.bestScore && !game.run.failed;
  if (game.isRecord) game.bestScore = game.run.score;
}

function crashPlane(reason) {
  const run = game.run;
  failRun(run, reason);
  thud(game.audio);
  showBanner('CRASHED', reason, '#ff5a4e', 3.5);
  // Let the banner read, then show the debrief — unless the pilot
  // restarted into a new run meanwhile.
  setTimeout(() => { if (game.phase === 'flying' && game.run === run) endRunToDebrief(); }, 2600);
}

function landPlane(sinkRate, onStripNow) {
  const run = game.run;
  const strip = run.mission.id === 'valley-courier' ? NORTH_STRIP : HOME_STRIP;
  const centreOffset = Math.abs(
    (game.plane.x - strip.x) * Math.cos(strip.heading)
    - (game.plane.z - strip.z) * Math.sin(strip.heading),
  );
  const points = scoreLanding(run, sinkRate, centreOffset, game.plane.speed, onStripNow);
  thud(game.audio);
  const targetStrip = strip.name;
  const arrived = run.mission.id === 'valley-courier'
    ? stripContains(NORTH_STRIP, game.plane.x, game.plane.z)
    : stripContains(HOME_STRIP, game.plane.x, game.plane.z);
  const runAtLanding = run;
  const toDebrief = () => { if (game.phase === 'flying' && game.run === runAtLanding) endRunToDebrief(); };
  if (ringsDone(run) && arrived) {
    run.landed = true;
    finishRun(run, game.plane.fuel, run.mission);
    showBanner('LANDED — SORTIE COMPLETE', `+${points} for the landing  •  total ${run.score}`, '#6edc82', 3.2);
    setTimeout(toDebrief, 2800);
  } else if (ringsDone(run)) {
    run.landed = true;
    showBanner('LANDED — WRONG STRIP', `You put down off the strip. +${points} for the landing.`, '#ffc442', 3.2);
    setTimeout(toDebrief, 2800);
  } else {
    showBanner('LANDED EARLY', `Rings left: ${run.rings.length - run.ringIndex}. Press R to restart.`, '#ffc442', 3);
    run.landed = true;
    run.finished = true;
    setTimeout(toDebrief, 3000);
  }
}

// ---- Per-frame update -------------------------------------------------------

function update(dt) {
  const input = game.input;
  const plane = game.plane;

  if (game.phase === 'menu') {
    if (wasPressed(input, '1')) game.selectedMission = 0;
    if (wasPressed(input, '2')) game.selectedMission = 1;
    if (wasPressed(input, '3')) game.selectedMission = 2;
    if (wasPressed(input, 'ArrowLeft')) game.selectedMission = (game.selectedMission + 2) % 3;
    if (wasPressed(input, 'ArrowRight')) game.selectedMission = (game.selectedMission + 1) % 3;
    if (wasPressed(input, 'Enter', ' ')) startMission(game.selectedMission);
    if (input.mouseClicked) {
      // Clicking a mission card selects it; a second click starts it.
      const cardW = 330;
      const gap = 24;
      const totalW = cardW * 3 + gap * 2;
      const startX = (WIDTH - totalW) / 2;
      const mx = input.mouseX;
      const my = input.mouseY;
      for (let i = 0; i < 3; i++) {
        const x = startX + i * (cardW + gap);
        if (mx >= x && mx <= x + cardW && my >= 268 && my <= 458) {
          if (game.selectedMission === i) startMission(i);
          else game.selectedMission = i;
        }
      }
    }
    return;
  }

  if (game.phase === 'paused') {
    if (wasPressed(input, 'p', 'P')) game.phase = 'flying';
    if (wasPressed(input, 'Escape')) game.phase = 'menu';
    if (wasPressed(input, 'r', 'R')) startMission(game.selectedMission);
    return;
  }

  if (game.phase === 'debrief') {
    if (wasPressed(input, 'Enter', ' ')) startMission(game.selectedMission);
    if (wasPressed(input, '1')) startMission(0);
    if (wasPressed(input, '2')) startMission(1);
    if (wasPressed(input, '3')) startMission(2);
    if (wasPressed(input, 'Escape')) game.phase = 'menu';
    return;
  }

  // Flying.
  if (wasPressed(input, 'p', 'P')) { game.phase = 'paused'; return; }
  if (wasPressed(input, 'r', 'R')) { startMission(game.selectedMission); return; }
  if (wasPressed(input, 'Escape')) { game.phase = 'menu'; return; }
  if (wasPressed(input, 'm', 'M')) game.audio.muted = !game.audio.muted;
  if (wasPressed(input, 'g', 'G')) {
    plane.gearDown = !plane.gearDown;
    showToast(plane.gearDown ? 'GEAR DOWN' : 'GEAR UP', plane.gearDown ? '#6edc82' : '#ffc442', 1.6);
  }
  if (wasPressed(input, 'f', 'F')) {
    plane.flaps = !plane.flaps;
    showToast(plane.flaps ? 'FLAPS DOWN' : 'FLAPS UP', '#56cdeb', 1.6);
  }

  if (game.run && game.run.failed) {
    // The run is over; hold the wreck (or the parked plane) still and let
    // the debrief timer run. Nothing steps the flight model any more.
    if (game.time > game.bannerUntil) game.banner = null;
    if (game.time > game.toastUntil) game.toast = null;
    return;
  }
  readStick(input);
  const wind = game.run ? game.run.mission.wind : 2;
  const gust = game.run && game.run.mission.id === 'storm-trial'
    ? Math.sin(game.time * 0.9) * 3 + Math.sin(game.time * 2.3) * 1.5
    : Math.sin(game.time * 0.4) * 0.8;
  const sinkBefore = plane.verticalSpeed;
  const event = stepPlane(plane, input, dt, wind + gust, { onStrip });
  if (game.run) game.run.time += dt;

  if (event === 'takeoff' && game.run && !game.run.tookOff) {
    game.run.tookOff = true;
    showBanner('AIRBORNE', 'Gear up when you are climbing — G', '#6edc82', 2.4);
    ringChime(game.audio);
  }
  if (event === 'landed') landPlane(Math.max(0, -sinkBefore), onStrip(plane.x, plane.z));
  if (event === 'rough-landing') {
    const runAtTouchdown = game.run;
    showBanner('ROUGH LANDING', 'Off-strip touchdown — airframe damaged', '#ffc442', 3);
    game.run.landed = true;
    game.run.finished = true;
    setTimeout(() => { if (game.phase === 'flying' && game.run === runAtTouchdown) endRunToDebrief(); }, 3000);
  }
  if (event === 'crashed') {
    const ground = groundHeight(plane.x, plane.z);
    const reason = plane.y <= ground + 3 && Math.abs(plane.bank) > 0.5
      ? 'Banked into the ground'
      : !plane.gearDown && plane.y <= ground + 3
        ? 'Landed with the gear up'
        : plane.speed < 30
          ? 'Stalled into the terrain'
          : 'Flew into the terrain';
    crashPlane(reason);
  }

  // Ring crossings: the plane crosses a ring's plane between frames.
  if (game.run && !game.run.failed) {
    const ring = nextRing(game.run);
    if (ring) {
      const off = ringOffset(ring, plane.x, plane.y, plane.z);
      // A new ring means the old "along" value is meaningless; reseed it.
      if (game.lastRingIndex !== game.run.ringIndex) {
        game.lastRingIndex = game.run.ringIndex;
        game.prevRingAlong = off.along;
      }
      if (game.prevRingAlong < 0 && off.along >= 0) {
        // Crossed the ring plane this frame.
        if (off.miss <= ring.radius) {
          const points = scoreRingPass(game.run, ring, off.miss);
          const quality = off.miss < ring.radius * 0.25 ? 'DEAD CENTRE' : off.miss < ring.radius * 0.6 ? 'CLEAN' : 'THROUGH';
          showBanner(`${quality} — ${ring.label}`, `+${points} pts`, '#ffc442', 1.8);
          ringChime(game.audio);
        } else {
          showToast(`MISSED ${ring.label} — fly through the hoop`, '#ff5a4e', 2.4);
          warningBeep(game.audio);
          game.run.ringIndex++;
        }
      }
      game.prevRingAlong = off.along;
    }
  }

  // Warnings.
  if (plane.stalled && game.time - game.stallWarnedAt > 2.5) {
    game.stallWarnedAt = game.time;
    warningBeep(game.audio);
  }
  if (plane.fuel < 20 && !game.lowFuelWarned && plane.fuel > 0) {
    game.lowFuelWarned = true;
    showToast('LOW FUEL — HEAD FOR A STRIP', '#ff5a4e', 3.5);
    warningBeep(game.audio);
  }
  if (plane.fuel <= 0 && plane.onGround === false && game.run && !game.run.failed) {
    showToast('OUT OF FUEL — GLIDE!', '#ff5a4e', 2);
  }

  updateAudio(game.audio, {
    throttle: plane.throttle,
    speed: plane.speed,
    stalled: plane.stalled,
    airborne: !plane.onGround,
  });

  if (game.time > game.bannerUntil) game.banner = null;
  if (game.time > game.toastUntil) game.toast = null;
}

// ---- Frame loop -------------------------------------------------------------

function frame(now) {
  const dt = Math.min(0.05, (now - game.lastFrame) / 1000 || 0.016);
  game.lastFrame = now;
  if (!game.shotMode) {
    // Live play: the clock runs and the simulation steps.
    game.time += dt;
    update(dt);
  }
  // In shot mode the clock is frozen and the scene is rendered as staged.
  renderFrame(ctx, WIDTH, HEIGHT, {
    camera: game.camera,
    plane: game.plane,
    run: game.run,
    time: game.time,
  });
  drawHud(ctx, WIDTH, HEIGHT, game);
  game.framesRendered++;
  endFrame(game.input);

  if (game.shotMode) {
    // In shot mode the clock is frozen and we render a few frames to let
    // the scene settle, then stop — the screenshot tool takes it from here.
    if (game.framesRendered < 6) requestAnimationFrame(frame);
    return;
  }
  requestAnimationFrame(frame);
}

// ---- Boot -------------------------------------------------------------------

function boot() {
  attachInput(game.input, canvas);
  canvas.addEventListener('mousedown', () => ensureAudio(game.audio));
  window.addEventListener('keydown', () => ensureAudio(game.audio), { once: true });

  const { shot } = parseShotParams(window.location.search);
  placeOnRunway(game.plane, HOME_STRIP);
  if (shot) {
    game.shotMode = applyShot(game, shot);
    if (game.shotMode) {
      // Frozen clock, a fixed moment in the flight, for the screenshot.
      game.time = 12;
      game.bannerUntil = game.time + 10;
      game.toastUntil = game.time + 10;
    }
  }
  // Exposed for automated play-testing: state, and helpers to drive it.
  window.__game = {
    game,
    startMission,
    version: 'kestrel-ridge-1.0',
  };

  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { game, startMission };
export { knots, feet, groundHeight, stripForName };
