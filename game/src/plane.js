// plane.js — the Kestrel K-7's flight model.
//
// An arcade model with real trade-offs: speed comes from throttle and
// costs fuel, turning costs speed, climbing costs speed, and a slow wing
// stalls. The numbers are tuned so take-off, cruise and a gentle landing
// all feel different, and so a careless pilot runs out of fuel or airframe.

import { clamp, groundHeight } from './terrain.js';

export const STALL_SPEED = 34; // m/s, clean; flaps lower it
export const ROTATE_SPEED = 52; // m/s, enough lift to leave the strip
export const MAX_SPEED = 118; // m/s at full throttle, level
export const CRUISE_SPEED = 78;

export function makePlane() {
  return {
    // World state
    x: 0,
    y: 0, // altitude above sea level (valley floor is ~0-20 m)
    z: -260, // parked near the south end of the home strip
    heading: 0, // radians, 0 = north (+z)
    pitch: 0, // radians, + = nose up
    bank: 0, // radians, + = right wing down
    speed: 0, // m/s along the nose
    throttle: 0, // 0..1
    // Systems
    fuel: 100, // percent
    damage: 0, // percent; 100 = airframe lost
    gearDown: true,
    flaps: false,
    onGround: true,
    crashed: false, // a wreck never flies again; the sim freezes it
    // Derived each frame
    verticalSpeed: 0,
    turnRate: 0,
    stalled: false,
    gForce: 1,
  };
}

// Reset the plane to the start of a sortie at the home strip.
export function placeOnRunway(plane, runway) {
  plane.x = runway.x;
  plane.z = runway.z - runway.length / 2 + 60;
  plane.y = groundHeight(plane.x, plane.z) + 2.2;
  plane.heading = runway.heading;
  plane.pitch = 0;
  plane.bank = 0;
  plane.speed = 0;
  plane.throttle = 0;
  plane.fuel = 100;
  plane.damage = 0;
  plane.gearDown = true;
  plane.flaps = false;
  plane.onGround = true;
  plane.verticalSpeed = 0;
  plane.stalled = false;
}

// One simulation step. input: { pitch: -1..1, roll: -1..1, throttle: -1..1 }
// (throttle is a delta: +1 raises, -1 lowers). dt in seconds. wind in m/s
// across the valley (x component). world.onStrip(x, z) says whether the
// wheels are over a runway. Returns an event string or ''.
export function stepPlane(plane, input, dt, wind, world) {
  // A wreck stays a wreck: once crashed, the sim freezes the plane so a
  // later frame cannot re-read the impact as a gentle landing.
  if (plane.crashed) return '';
  const stall = plane.flaps ? STALL_SPEED - 7 : STALL_SPEED;
  const prevY = plane.y;

  // Throttle lever moves at a fixed rate; fuel burns with throttle squared.
  plane.throttle = clamp(plane.throttle + input.throttle * dt * 0.55, 0, 1);
  if (plane.throttle > 0.02) {
    plane.fuel = Math.max(0, plane.fuel - dt * (0.12 + plane.throttle * plane.throttle * 0.55));
  }
  const outOfFuel = plane.fuel <= 0;
  if (outOfFuel) plane.throttle = Math.max(0, plane.throttle - dt * 0.4);

  const airborne = !plane.onGround;

  if (airborne) {
    // --- In the air ---
    // Pitch: the stick commands a pitch rate, eased toward the target.
    const pitchTarget = clamp(input.pitch * 0.42, -0.42, 0.42);
    plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, dt * 2.2);
    // Roll: the stick banks the wing; the wing levels itself gently.
    const bankTarget = clamp(input.roll * 0.85, -0.85, 0.85);
    plane.bank += (bankTarget - plane.bank) * Math.min(1, dt * 1.8);
    plane.bank += (0 - plane.bank) * dt * 0.12;
    // Turn rate follows bank; a steep bank turns hard and bleeds speed.
    plane.turnRate = -Math.tan(plane.bank) * 9.81 / Math.max(plane.speed, 20) * 0.9;
    plane.heading += plane.turnRate * dt;

    // Speed: thrust minus drag minus the cost of climbing.
    const thrust = plane.throttle * 46;
    const drag = 0.0038 * plane.speed * plane.speed + (plane.flaps ? 3.5 : 0);
    const climbCost = 9.81 * Math.sin(plane.pitch) * 1.15;
    const bankCost = Math.abs(Math.tan(plane.bank)) * 2.2;
    plane.speed += (thrust - drag - climbCost - bankCost) * dt;
    plane.speed = clamp(plane.speed, 0, MAX_SPEED + 12);

    // Stall: below stall speed the wing quits and the nose drops.
    plane.stalled = plane.speed < stall;
    if (plane.stalled) {
      plane.pitch += (-0.18 - plane.pitch) * Math.min(1, dt * 1.5);
      plane.speed += 6 * dt; // falling picks up speed again
    }

    // Move along the nose, plus a sideways push from the valley wind.
    const fx = Math.sin(plane.heading);
    const fz = Math.cos(plane.heading);
    plane.x += fx * plane.speed * Math.cos(plane.pitch) * dt + wind * dt;
    plane.z += fz * plane.speed * Math.cos(plane.pitch) * dt;
    plane.y += plane.speed * Math.sin(plane.pitch) * dt;
    plane.verticalSpeed = (plane.y - prevY) / Math.max(dt, 0.001);
    plane.gForce = 1 + Math.abs(Math.tan(plane.bank)) * 0.35;
  } else {
    // --- On the ground: rolling on the strip ---
    plane.pitch = 0;
    plane.bank += (0 - plane.bank) * Math.min(1, dt * 3);
    const thrust = plane.throttle * 46;
    const drag = 0.0022 * plane.speed * plane.speed + 1.2;
    plane.speed += (thrust - drag) * dt;
    plane.speed = clamp(plane.speed, 0, MAX_SPEED);
    const fx = Math.sin(plane.heading);
    const fz = Math.cos(plane.heading);
    plane.x += fx * plane.speed * dt;
    plane.z += fz * plane.speed * dt;
    plane.y = groundHeight(plane.x, plane.z) + 2.2;
    plane.verticalSpeed = 0;
    plane.turnRate = 0;
    // Steering on the ground is gentle; the rudder only bites at speed.
    plane.heading += input.roll * dt * 0.25 * Math.min(1, plane.speed / 30);
    // Rotate: pull up past rotate speed and the wing lifts the plane off.
    if (plane.speed > ROTATE_SPEED && input.pitch > 0.25) {
      plane.onGround = false;
      plane.pitch = 0.1;
      return 'takeoff';
    }
  }

  // --- Ground contact while airborne ---
  const ground = groundHeight(plane.x, plane.z);
  if (plane.y <= ground + 2.2) {
    plane.y = ground + 2.2;
    const sink = -plane.verticalSpeed;
    const onStrip = world && world.onStrip ? world.onStrip(plane.x, plane.z) : false;
    if (!plane.onGround) {
      if (sink < 4.5 && Math.abs(plane.bank) < 0.35 && plane.speed > 28 && plane.gearDown && onStrip) {
        plane.onGround = true;
        plane.pitch = 0;
        plane.bank = 0;
        plane.verticalSpeed = 0;
        return 'landed';
      }
      if (sink < 7 && Math.abs(plane.bank) < 0.5 && plane.speed > 25 && plane.gearDown && !onStrip) {
        // A survivable off-strip touchdown on flat grass, but it hurts.
        plane.onGround = true;
        plane.damage = Math.min(100, plane.damage + 18);
        plane.pitch = 0;
        plane.bank = 0;
        return 'rough-landing';
      }
      // Anything else is a crash: too hard, too steep, gear up, or terrain.
      plane.damage = 100;
      plane.crashed = true;
      plane.speed = 0;
      return 'crashed';
    }
  }

  // --- Envelope warnings ---
  if (plane.y > 1500) {
    plane.y = 1500;
    plane.pitch = Math.min(plane.pitch, 0);
  }
  return '';
}

export function knots(speedMs) {
  return Math.round(speedMs * 1.94384);
}

export function feet(altM) {
  return Math.round(altM * 3.28084);
}

export function headingDegrees(headingRad) {
  const deg = ((headingRad * 180) / Math.PI) % 360;
  return Math.round((deg + 360) % 360);
}
