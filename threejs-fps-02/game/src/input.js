// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only. Extra keys: 1-4 switch weapon, Q throw grenade, G cycle grenade, B buy menu,
// E plant / interact, right mouse aims (sniper scope), Shift walks quietly (slower, bots
// hear less), Tab shows the scoreboard.
export function createInput(canvas, onLockChange, callbacks) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0, pressed: false };

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
    if (down && !event.repeat) {
      if (event.code === 'KeyB') callbacks.onBuyToggle();
      if (event.code === 'KeyQ') callbacks.onThrowGrenade();
      if (event.code === 'KeyG') callbacks.onCycleGrenade();
      if (event.code === 'KeyR') callbacks.onReload();
      if (event.code === 'Digit1') callbacks.onWeaponSlot(0);
      if (event.code === 'Digit2') callbacks.onWeaponSlot(1);
      if (event.code === 'Digit3') callbacks.onWeaponSlot(2);
      if (event.code === 'Digit4') callbacks.onWeaponSlot(3);
      if (event.code === 'Digit5') callbacks.onWeaponSlot(4);
      if (event.code === 'Digit6') callbacks.onWeaponSlot(5);
      if (event.code === 'Digit7') callbacks.onWeaponSlot(6);
      if (event.code === 'Tab') { event.preventDefault(); callbacks.onScoreboard(true); }
    }
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => {
    setKey(event, false);
    if (event.code === 'Tab') callbacks.onScoreboard(false);
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) { state.firing = true; state.pressed = true; }
    if (event.button === 2) { state.aiming = true; callbacks.onAim(true); }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) { state.aiming = false; callbacks.onAim(false); }
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
      callbacks.onAim(false);
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Edge trigger for semi-automatic weapons: true once per click.
    takePressed() {
      const value = state.pressed;
      state.pressed = false;
      return value;
    },
  };
}
