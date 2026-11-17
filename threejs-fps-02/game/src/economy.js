// The buy menu's numbers: round rewards, kill and plant bonuses, and the price list.
// main.js applies the rewards; hud.js renders the menu from this catalogue.
import { WEAPONS, GRENADES } from './weapons.js';

export const REWARDS = {
  win: 3250,
  loss: 1900,
  kill: 300,
  plant: 300,
  roundStart: 0,
};

export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50; // absorbs half of incoming damage until spent

export function catalogue() {
  const items = [];
  for (const w of [WEAPONS.rifle, WEAPONS.smg, WEAPONS.sniper, WEAPONS.pistol]) {
    items.push({ kind: 'weapon', id: w.id, name: w.name, price: w.price, blurb: `${w.damage} dmg · ${w.mag}-round mag${w.id === 'sniper' ? ' · scoped' : ''}` });
  }
  items.push({ kind: 'grenade', id: 'frag', name: GRENADES.frag.name, price: GRENADES.frag.price, blurb: 'Blast radius 7 m' });
  items.push({ kind: 'grenade', id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price, blurb: 'Blocks sight for 14 s' });
  items.push({ kind: 'armor', id: 'armor', name: 'Plated vest', price: ARMOR_PRICE, blurb: 'Absorbs half of damage' });
  return items;
}

// Buy one item. Returns a short message for the HUD, or null when it cannot be bought.
export function buy(state, weapon, item) {
  if (state.phase !== 'buy') return 'The buy window is closed.';
  if (state.money < item.price) return 'Not enough money.';
  if (item.kind === 'weapon') {
    if (weapon.state.id === item.id) return 'Already carrying it.';
    state.money -= item.price;
    weapon.equip(item.id);
    return `Bought ${item.name}.`;
  }
  if (item.kind === 'grenade') {
    if (weapon.state.grenades[item.id] >= 2) return 'Carrying the maximum of two.';
    state.money -= item.price;
    weapon.state.grenades[item.id] += 1;
    weapon.state.grenadeSelected = item.id;
    return `Bought ${item.name}.`;
  }
  if (item.kind === 'armor') {
    state.money -= item.price;
    return 'Bought a plated vest.';
  }
  return null;
}
