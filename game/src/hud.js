// hud.js — everything drawn over the scene: the instruments, the mission
// panel, the minimap, the banners, and the menu / pause / debrief screens.
// Instruments look flown, not drawn: lit digits, tapes, and a proper
// attitude ball, all readable at a glance when the frame is shrunk.

import { knots, feet, headingDegrees } from './plane.js';
import { clamp, lerp } from './terrain.js';
import { HOME_STRIP, NORTH_STRIP } from './world.js';
import { objectiveLines } from './missions.js';

const PANEL = 'rgba(8, 18, 28, 0.72)';
const PANEL_EDGE = 'rgba(120, 190, 230, 0.35)';
const INK = '#d9ecf7';
const DIM = '#8fb4c9';
const AMBER = '#ffc442';
const GREEN = '#6edc82';
const RED = '#ff5a4e';
const CYAN = '#56cdeb';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
}

function bigDigits(ctx, text, x, y, size, colour = INK) {
  ctx.fillStyle = colour;
  ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

// ---- Instruments -----------------------------------------------------------

function drawAirspeed(ctx, x, y, speed, stalled) {
  panel(ctx, x, y, 148, 64);
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('AIRSPEED', x + 12, y + 18);
  bigDigits(ctx, String(knots(speed)), x + 12, y + 50, 30, stalled ? RED : INK);
  ctx.fillStyle = DIM;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText('KT', x + 108, y + 50);
  if (stalled) {
    ctx.fillStyle = RED;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText('STALL', x + 12, y + 62 - 2);
  }
}

function drawAltitude(ctx, x, y, altM, verticalSpeed) {
  panel(ctx, x, y, 168, 64);
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ALTITUDE', x + 12, y + 18);
  bigDigits(ctx, String(feet(altM)), x + 12, y + 50, 30);
  ctx.fillStyle = DIM;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText('FT', x + 128, y + 50);
  const vs = Math.round(verticalSpeed * 196.85); // ft/min
  ctx.fillStyle = vs > 100 ? GREEN : vs < -100 ? AMBER : DIM;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${vs >= 0 ? '+' : ''}${vs} FPM`, x + 156, y + 18);
  ctx.textAlign = 'left';
}

function drawHeadingTape(ctx, cx, y, heading) {
  const w = 420;
  const h = 34;
  panel(ctx, cx - w / 2, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - w / 2, y, w, h);
  ctx.clip();
  const deg = headingDegrees(heading);
  const pxPerDeg = 3.2;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let d = deg - 60; d <= deg + 60; d += 5) {
    const norm = ((d % 360) + 360) % 360;
    const dx = cx + (d - deg) * pxPerDeg;
    if (d % 30 === 0) {
      const label = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm).padStart(3, '0');
      ctx.fillStyle = INK;
      ctx.fillText(label, dx, y + 22);
      ctx.fillRect(dx - 0.5, y + 26, 1, 6);
    } else {
      ctx.fillStyle = DIM;
      ctx.fillRect(dx - 0.5, y + 28, 1, 4);
    }
  }
  ctx.restore();
  // Centre caret and digital readout.
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(cx - 7, y);
  ctx.lineTo(cx + 7, y);
  ctx.lineTo(cx, y + 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(deg).padStart(3, '0') + '°', cx, y + h + 16);
  ctx.textAlign = 'left';
}

function drawAttitude(ctx, x, y, pitch, bank) {
  const r = 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(bank);
  const pitchPx = clamp(pitch, -0.5, 0.5) * 110;
  // Sky half and ground half, split by the horizon line.
  ctx.fillStyle = '#2f6ea8';
  ctx.fillRect(-r, -r + pitchPx - r, r * 2, r * 2);
  ctx.fillStyle = '#7a5a34';
  ctx.fillRect(-r, pitchPx, r * 2, r * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r, pitchPx);
  ctx.lineTo(r, pitchPx);
  ctx.stroke();
  // Pitch ladder rungs.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  for (const deg of [-20, -10, 10, 20]) {
    const yy = pitchPx - Math.tan((deg * Math.PI) / 180) * 110;
    ctx.beginPath();
    ctx.moveTo(-18, yy);
    ctx.lineTo(18, yy);
    ctx.stroke();
  }
  ctx.restore();
  // Fixed wings marker and bezel.
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 34, y);
  ctx.lineTo(x - 12, y);
  ctx.moveTo(x + 12, y);
  ctx.lineTo(x + 34, y);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DIM;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', x, y + r + 13);
  ctx.textAlign = 'left';
}

function drawThrottleFuel(ctx, x, y, throttle, fuel, damage) {
  panel(ctx, x, y, 168, 96);
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('THROTTLE', x + 12, y + 18);
  const barX = x + 12;
  const barW = 144;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(barX, y + 26, barW, 10);
  const thrGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  thrGrad.addColorStop(0, '#2f9e5f');
  thrGrad.addColorStop(1, '#ffc442');
  ctx.fillStyle = thrGrad;
  ctx.fillRect(barX, y + 26, barW * throttle, 10);
  ctx.fillStyle = INK;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`${Math.round(throttle * 100)}%`, barX + barW + 6 - 144 + 118, y + 35);
  // Fuel bar.
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('FUEL', x + 12, y + 54);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(barX, y + 60, barW, 10);
  ctx.fillStyle = fuel < 20 ? RED : fuel < 45 ? AMBER : CYAN;
  ctx.fillRect(barX, y + 60, barW * clamp(fuel / 100, 0, 1), 10);
  ctx.fillStyle = INK;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`${Math.round(fuel)}%`, barX + 118, y + 70);
  // Damage.
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('AIRFRAME', x + 12, y + 88);
  ctx.fillStyle = damage > 60 ? RED : damage > 25 ? AMBER : GREEN;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(damage === 0 ? 'OK' : `${Math.round(damage)}% DAMAGE`, x + 78, y + 88);
}

// ---- Mission panel & minimap -----------------------------------------------

function drawMissionPanel(ctx, x, y, run, score) {
  const lines = objectiveLines(run);
  const h = 34 + lines.length * 20 + 30;
  panel(ctx, x, y, 288, h);
  ctx.fillStyle = AMBER;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText(run.mission.name, x + 12, y + 20);
  ctx.fillStyle = INK;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`SCORE ${score}`, x + 276, y + 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, sans-serif';
  const mins = Math.floor(run.time / 60);
  const secs = Math.floor(run.time % 60);
  ctx.fillText(`TIME ${mins}:${String(secs).padStart(2, '0')}  •  RING ${Math.min(run.ringIndex + 1, run.rings.length)}/${run.rings.length}`, x + 12, y + 36);
  lines.forEach((line, i) => {
    const ly = y + 56 + i * 20;
    ctx.fillStyle = line.done ? GREEN : line.current ? AMBER : DIM;
    ctx.font = '600 12px system-ui, sans-serif';
    const mark = line.done ? '✓' : line.current ? '►' : '·';
    ctx.fillText(`${mark}  ${line.text}`, x + 12, ly);
  });
}

function drawMinimap(ctx, x, y, size, plane, run) {
  panel(ctx, x, y, size, size);
  const scale = size / 5200; // covers the valley north-south
  const toMap = (wx, wz) => [x + size / 2 + wx * scale, y + size - (wz + 600) * scale];
  // Valley shading.
  ctx.fillStyle = 'rgba(90, 140, 90, 0.5)';
  ctx.fillRect(x + size / 2 - 420 * scale, y, 840 * scale, size);
  // River.
  ctx.strokeStyle = 'rgba(86, 160, 210, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let z = -600; z <= 4600; z += 200) {
    const [mx, my] = toMap(220 * Math.sin(z * 0.0009 + 1.2) + 90 * Math.sin(z * 0.0027), z);
    if (z === -600) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  }
  ctx.stroke();
  // Strips.
  for (const strip of [HOME_STRIP, NORTH_STRIP]) {
    const [mx, my] = toMap(strip.x, strip.z);
    ctx.fillStyle = '#e8e8e0';
    ctx.fillRect(mx - 2, my - 5, 4, 10);
  }
  // Rings.
  if (run) {
    run.rings.forEach((ring, i) => {
      const [mx, my] = toMap(ring.x, ring.z);
      ctx.strokeStyle = ring.passed ? GREEN : i === run.ringIndex ? AMBER : CYAN;
      ctx.lineWidth = i === run.ringIndex ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, i === run.ringIndex ? 5 : 3.5, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  // Plane arrow, rotated by heading.
  const [px, py] = toMap(plane.x, plane.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-plane.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = DIM;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('MAP', x + 8, y + 12);
}

// ---- Banners & messages -----------------------------------------------------

export function drawBanner(ctx, width, text, sub, colour = AMBER) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = colour;
  ctx.fillText(text, width / 2, 190);
  if (sub) {
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(sub, width / 2, 224);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

export function drawToast(ctx, width, text, colour = INK) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(8, 18, 28, 0.72)';
  const w = ctx.measureText(text).width + 36;
  ctx.beginPath();
  ctx.roundRect(width / 2 - w / 2, 268, w, 36, 8);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(text, width / 2, 292);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawWarnings(ctx, width, plane, run) {
  const warnings = [];
  if (plane.stalled) warnings.push(['STALL — NOSE DOWN, ADD POWER', RED]);
  if (plane.fuel < 20 && plane.fuel > 0) warnings.push(['LOW FUEL', AMBER]);
  if (plane.fuel <= 0) warnings.push(['OUT OF FUEL — GLIDE TO A STRIP', RED]);
  if (!plane.onGround && plane.y < 60 && plane.speed < 45) warnings.push(['TOO LOW — PULL UP', RED]);
  if (!plane.gearDown && !plane.onGround && plane.y < 120) warnings.push(['GEAR UP — PRESS G', AMBER]);
  warnings.forEach(([text, colour], i) => {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = colour;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.fillText(text, width / 2, 320 + i * 30);
    ctx.restore();
  });
  ctx.textAlign = 'left';
}

// ---- Screens ----------------------------------------------------------------

function drawMenu(ctx, width, height, missions, selected, bestScore) {
  ctx.fillStyle = 'rgba(6, 14, 22, 0.55)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb347';
  ctx.font = '800 64px system-ui, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16;
  ctx.fillText('KESTREL RIDGE', width / 2, 150);
  ctx.shadowBlur = 0;
  ctx.fillStyle = INK;
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText('A L P I N E   C O U R I E R', width / 2, 188);
  ctx.fillStyle = DIM;
  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillText('Fly the Kestrel K-7 through the valley. Mind your throttle, your fuel, and the mountains.', width / 2, 220);

  // Mission cards.
  const cardW = 330;
  const gap = 24;
  const totalW = cardW * 3 + gap * 2;
  const startX = (width - totalW) / 2;
  missions.forEach((m, i) => {
    const x = startX + i * (cardW + gap);
    const y = 268;
    const h = 190;
    ctx.fillStyle = i === selected ? 'rgba(255, 180, 66, 0.16)' : 'rgba(8, 18, 28, 0.78)';
    ctx.strokeStyle = i === selected ? AMBER : PANEL_EDGE;
    ctx.lineWidth = i === selected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === selected ? AMBER : INK;
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}  ${m.name}`, x + cardW / 2, y + 34);
    ctx.fillStyle = DIM;
    ctx.font = '400 14px/1.5 system-ui, sans-serif';
    ctx.textAlign = 'left';
    wrapText(ctx, m.brief, x + 18, y + 62, cardW - 36, 20);
    ctx.fillStyle = i === selected ? AMBER : DIM;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i === selected ? '▶ PRESS ENTER TO FLY' : 'PRESS ' + (i + 1), x + cardW / 2, y + h - 18);
  });

  ctx.fillStyle = DIM;
  ctx.font = '400 14px/1.7 system-ui, sans-serif';
  const controls = '↑ ↓ pitch    ← → bank    W / S throttle    G gear    F flaps    P pause    R restart    M sound';
  ctx.fillText(controls, width / 2, 512);
  ctx.fillText('Take off at 100 kt, rotate gently, and land slow with the gear down.', width / 2, 540);
  if (bestScore > 0) {
    ctx.fillStyle = AMBER;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`Best score so far: ${bestScore}`, width / 2, 576);
  }
  ctx.textAlign = 'left';
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawPause(ctx, width, height) {
  ctx.fillStyle = 'rgba(6, 14, 22, 0.6)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.fillText('PAUSED', width / 2, height / 2 - 10);
  ctx.font = '400 16px system-ui, sans-serif';
  ctx.fillStyle = DIM;
  ctx.fillText('Press P to keep flying — R to restart the sortie — Esc for the menu', width / 2, height / 2 + 26);
  ctx.textAlign = 'left';
}

function drawDebrief(ctx, width, height, run, bestScore, isRecord) {
  ctx.fillStyle = 'rgba(6, 14, 22, 0.62)';
  ctx.fillRect(0, 0, width, height);
  const panelW = 560;
  const panelH = 420;
  const x = (width - panelW) / 2;
  const y = (height - panelH) / 2;
  panel(ctx, x, y, panelW, panelH);
  ctx.textAlign = 'center';
  const title = run.failed ? 'SORTIE FAILED' : 'SORTIE COMPLETE';
  ctx.fillStyle = run.failed ? RED : GREEN;
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText(title, width / 2, y + 52);
  if (run.failed) {
    ctx.fillStyle = INK;
    ctx.font = '400 16px system-ui, sans-serif';
    ctx.fillText(run.failReason, width / 2, y + 82);
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '400 15px system-ui, sans-serif';
    ctx.fillText(run.mission.name + '  •  ' + fmtTime(run.time), width / 2, y + 82);
  }
  const rows = [
    ['Rings flown', `${run.ringScore} pts  (${run.rings.filter((r) => r.passed).length}/${run.rings.length} rings)`],
    ['Landing', `${run.landingScore} pts`],
    ['Fuel left over', `${run.fuelBonus} pts`],
    ['Time bonus', `${run.timeBonus} pts`],
  ];
  ctx.textAlign = 'left';
  rows.forEach(([label, value], i) => {
    const ry = y + 122 + i * 34;
    ctx.fillStyle = DIM;
    ctx.font = '400 16px system-ui, sans-serif';
    ctx.fillText(label, x + 40, ry);
    ctx.fillStyle = INK;
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value, x + panelW - 40, ry);
    ctx.textAlign = 'left';
  });
  ctx.strokeStyle = PANEL_EDGE;
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 268);
  ctx.lineTo(x + panelW - 40, y + 268);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', x + 40, y + 306);
  ctx.fillStyle = INK;
  ctx.textAlign = 'right';
  ctx.fillText(String(run.score), x + panelW - 40, y + 306);
  ctx.textAlign = 'center';
  if (isRecord && !run.failed) {
    ctx.fillStyle = AMBER;
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText('★ NEW BEST SCORE ★', width / 2, y + 342);
  }
  ctx.fillStyle = DIM;
  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillText('ENTER — fly again    •    1/2/3 — another mission    •    Esc — menu', width / 2, y + 378);
  ctx.textAlign = 'left';
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- Main HUD entry ---------------------------------------------------------

export function drawHud(ctx, width, height, game) {
  const { plane, run, phase } = game;
  if (phase === 'menu') {
    drawMenu(ctx, width, height, game.missions, game.selectedMission, game.bestScore);
    return;
  }
  if (phase === 'paused') {
    drawAirspeed(ctx, 20, 20, plane.speed, plane.stalled);
    drawAltitude(ctx, width - 188, 20, plane.y, plane.verticalSpeed);
    drawHeadingTape(ctx, width / 2, 20, plane.heading);
    drawPause(ctx, width, height);
    return;
  }
  if (phase === 'debrief') {
    drawDebrief(ctx, width, height, run, game.bestScore, game.isRecord);
    return;
  }

  // Flying (and crashed/landed overlays ride on the same instruments).
  drawAirspeed(ctx, 20, 20, plane.speed, plane.stalled);
  drawAltitude(ctx, width - 188, 20, plane.y, plane.verticalSpeed);
  drawHeadingTape(ctx, width / 2, 20, plane.heading);
  drawAttitude(ctx, 258, height - 92, plane.pitch, plane.bank);
  drawThrottleFuel(ctx, 20, height - 116, plane.throttle, plane.fuel, plane.damage);
  if (run) {
    drawMissionPanel(ctx, width - 308, 96, run, run.score);
    drawMinimap(ctx, width - 168, height - 168, 148, plane, run);
  }
  drawWarnings(ctx, width, plane, run);

  // Flight-path marker: a small circle where the nose is actually going.
  const cx = width / 2;
  const cy = height * 0.54;
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 20, cy);
  ctx.moveTo(cx, cy - 20);
  ctx.lineTo(cx, cy - 8);
  ctx.stroke();

  if (game.banner) drawBanner(ctx, width, game.banner.text, game.banner.sub, game.banner.colour);
  if (game.toast) drawToast(ctx, width, game.toast.text, game.toast.colour);

  // Gear / flaps state, bottom centre.
  ctx.textAlign = 'center';
  ctx.font = '700 13px system-ui, sans-serif';
  const gearText = plane.gearDown ? 'GEAR DOWN' : 'GEAR UP';
  ctx.fillStyle = plane.gearDown ? GREEN : AMBER;
  ctx.fillText(gearText, width / 2, height - 24);
  ctx.fillStyle = plane.flaps ? CYAN : DIM;
  ctx.fillText(plane.flaps ? 'FLAPS DOWN' : 'FLAPS UP', width / 2, height - 8);
  ctx.textAlign = 'left';
}

export { fmtTime, clamp, lerp };
