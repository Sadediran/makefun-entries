// SANDLINE — Meridian Yard. The look plan, in one place: a desert dusk yard — warm sand,
// rusted steel, deep dusk blue, one teal accent. Every colour in the game is one of these.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#232838', // dusk sky
  surface: '#3a3f4d', // concrete
  hairline: '#565d6e', // steel edge
  ink: '#f2ead9', // warm off-white
  muted: '#9a938a', // dusty grey
  accent: '#37c8a3', // teal — Vanguard
  sand: '#c8a06a',
  sandDark: '#a67c4e',
  rust: '#b4552d', // Dusk team / hazard
  rustDark: '#7e3a1e',
  containerBlue: '#3f6d8e',
  containerGreen: '#5d7a4a',
  siteA: '#37c8a3',
  siteB: '#e8a33d',
  danger: '#e5484d',
};

export function shade(name) {
  return PALETTE[name];
}
