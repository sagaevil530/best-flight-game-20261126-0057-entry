// missions.js — the three sorties, their goals, and the scoring.
//
// Every mission is a short story with a different flying problem:
//   1. RIDGE RUN — take off, thread five rings up the valley, land home.
//   2. VALLEY COURIER — carry a parcel to Laketown Strip and land there.
//   3. STORM TRIAL — eight rings against the clock in a gusting crosswind.
//
// Score rewards clean flying: centred rings, gentle landings, fuel left
// over, and time. Crashes and running dry end the sortie at once.

import { makeRing } from './world.js';
import { groundHeight } from './terrain.js';

export const MISSIONS = [
  {
    id: 'ridge-run',
    index: 0,
    name: 'RIDGE RUN',
    tagline: 'Thread five rings up the valley and bring her home.',
    brief: 'Take off from Kestrel Field, fly the five rings in order, then land back on the strip. Smooth turns beat fast ones: banking hard bleeds speed.',
    fuelStart: 100,
    wind: 2,
    parTime: 300,
  },
  {
    id: 'valley-courier',
    index: 1,
    name: 'VALLEY COURIER',
    tagline: 'A parcel for Laketown, 4.2 km north. Land it gently.',
    brief: 'Take off with the parcel, follow the river north past the village, and put down on Laketown Strip. Watch your fuel — a go-around costs more than a good approach.',
    fuelStart: 100,
    wind: 4,
    parTime: 420,
  },
  {
    id: 'storm-trial',
    index: 2,
    name: 'STORM TRIAL',
    tagline: 'Eight rings, a gusting crosswind, and the clock running.',
    brief: 'Eight rings, low and fast, with gusts pushing you sideways. Rings are worth more the closer to the centre you pass them. Land anywhere safe when the last ring is through.',
    fuelStart: 85,
    wind: 9,
    parTime: 240,
  },
];

export function missionByIndex(i) {
  return MISSIONS[((i % MISSIONS.length) + MISSIONS.length) % MISSIONS.length];
}

// Build the ring course for a mission. Rings sit in the valley so the
// pilot always has ground to read height against.
export function buildRings(mission) {
  if (mission.id === 'ridge-run') {
    return [
      makeRing(-60, 150, 700, 42, 0, 'R1'),
      makeRing(140, 210, 1400, 42, 0, 'R2'),
      makeRing(-160, 260, 2100, 40, 0, 'R3'),
      makeRing(90, 300, 2800, 40, 0, 'R4'),
      makeRing(-40, 230, 3500, 44, 0, 'R5'),
    ];
  }
  if (mission.id === 'valley-courier') {
    return [
      makeRing(60, 170, 900, 46, 0, 'R1'),
      makeRing(220, 220, 1900, 46, 0, 'R2'),
      makeRing(180, 200, 3000, 46, 0, 'R3'),
    ];
  }
  // storm trial: low, wide, alternating sides
  return [
    makeRing(-220, 130, 600, 36, 0, 'R1'),
    makeRing(240, 160, 1100, 36, 0, 'R2'),
    makeRing(-260, 190, 1650, 34, 0, 'R3'),
    makeRing(200, 150, 2200, 34, 0, 'R4'),
    makeRing(-180, 210, 2750, 34, 0, 'R5'),
    makeRing(160, 170, 3300, 34, 0, 'R6'),
    makeRing(-140, 230, 3850, 34, 0, 'R7'),
    makeRing(60, 190, 4300, 36, 0, 'R8'),
  ];
}

// A fresh run of a mission: rings, timer, score, and objective list.
export function startRun(mission) {
  return {
    mission,
    rings: buildRings(mission),
    ringIndex: 0,
    score: 0,
    time: 0,
    tookOff: false,
    landed: false,
    finished: false,
    failed: false,
    failReason: '',
    events: [], // { text, at } lines for the debrief
    ringScore: 0,
    landingScore: 0,
    fuelBonus: 0,
    timeBonus: 0,
  };
}

export function nextRing(run) {
  return run.rings[run.ringIndex] ?? null;
}

export function ringsDone(run) {
  return run.ringIndex >= run.rings.length;
}

// Called when the plane crosses a ring's plane. Returns points earned.
export function scoreRingPass(run, ring, miss) {
  const centre = Math.max(0, 1 - miss / ring.radius);
  const points = Math.round(100 + 300 * centre * centre);
  run.ringScore += points;
  run.score += points;
  ring.bestMiss = miss;
  ring.passed = true;
  run.ringIndex++;
  return points;
}

// Score a landing: gentle sink, on the centreline, with speed in the
// window, and the gear down. Returns points earned.
export function scoreLanding(run, sinkRate, centreOffset, speed, onStrip) {
  const soft = Math.max(0, 1 - sinkRate / 4.5);
  const centre = Math.max(0, 1 - centreOffset / 14);
  const speedOk = speed > 28 && speed < 75 ? 1 : 0.5;
  const stripBonus = onStrip ? 1 : 0.4;
  const points = Math.round(400 * soft * centre * speedOk * stripBonus);
  run.landingScore += points;
  run.score += points;
  return points;
}

// Final bonuses when a run ends successfully.
export function finishRun(run, fuel, mission) {
  run.finished = true;
  run.fuelBonus = Math.round(fuel * 2);
  const timeLeft = Math.max(0, mission.parTime - run.time);
  run.timeBonus = Math.round(timeLeft * 1.5);
  run.score += run.fuelBonus + run.timeBonus;
}

export function failRun(run, reason) {
  run.failed = true;
  run.failReason = reason;
}

export function objectiveLines(run) {
  const lines = [];
  lines.push({
    done: run.tookOff,
    text: run.mission.id === 'valley-courier'
      ? 'Take off from Kestrel Field'
      : 'Take off from Kestrel Field',
  });
  for (let i = 0; i < run.rings.length; i++) {
    lines.push({
      done: run.rings[i].passed,
      current: !run.rings[i].passed && i === run.ringIndex,
      text: `Fly through ring ${i + 1} of ${run.rings.length}`,
    });
  }
  lines.push({
    done: run.landed,
    current: ringsDone(run) && !run.landed,
    text: run.mission.id === 'valley-courier'
      ? 'Land on Laketown Strip'
      : 'Land back on Kestrel Field',
  });
  return lines;
}

export { groundHeight };
