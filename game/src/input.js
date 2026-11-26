// input.js — keyboard and mouse, kept in one place so the flight model
// never reads the DOM directly.
//
// Stick: ArrowUp/ArrowDown pitch, ArrowLeft/ArrowRight roll.
// Throttle: W/S or Shift/Ctrl. G gear, F flaps, R restart, P pause,
// Enter confirm, 1/2/3 pick a mission, M mute, H help.

export function makeInput() {
  return {
    keys: new Set(),
    pressed: new Set(), // keys pressed since the last frame was consumed
    mouseX: 0,
    mouseY: 0,
    mouseClicked: false,
    // Stick axes, -1..1, read fresh each frame.
    pitch: 0,
    roll: 0,
    throttle: 0,
  };
}

export function attachInput(input, element) {
  const down = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (!e.repeat) input.pressed.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    input.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };
  const up = (e) => {
    input.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => input.keys.clear());
  element.addEventListener('mousemove', (e) => {
    const rect = element.getBoundingClientRect();
    input.mouseX = (e.clientX - rect.left) * (element.width / rect.width);
    input.mouseY = (e.clientY - rect.top) * (element.height / rect.height);
  });
  element.addEventListener('mousedown', (e) => {
    e.preventDefault();
    input.mouseClicked = true;
    const rect = element.getBoundingClientRect();
    input.mouseX = (e.clientX - rect.left) * (element.width / rect.width);
    input.mouseY = (e.clientY - rect.top) * (element.height / rect.height);
  });
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

export function held(input, ...names) {
  return names.some((n) => input.keys.has(n));
}

export function wasPressed(input, ...names) {
  return names.some((n) => input.pressed.has(n));
}

// Read the stick axes from the held keys. Pitch: Up = nose down (stick
// forward), Down = nose up, as in a real stick. Roll: Left/Right bank.
export function readStick(input) {
  const pitchDown = held(input, 'ArrowUp') ? 1 : 0;
  const pitchUp = held(input, 'ArrowDown') ? 1 : 0;
  const rollLeft = held(input, 'ArrowLeft') ? 1 : 0;
  const rollRight = held(input, 'ArrowRight') ? 1 : 0;
  input.pitch = pitchUp - pitchDown;
  input.roll = rollRight - rollLeft;
  const thrUp = held(input, 'w', 'W', 'Shift') ? 1 : 0;
  const thrDown = held(input, 's', 'S', 'Control') ? 1 : 0;
  input.throttle = thrUp - thrDown;
  return input;
}

export function endFrame(input) {
  input.pressed.clear();
  input.mouseClicked = false;
}
