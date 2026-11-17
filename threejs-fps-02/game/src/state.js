// The one central state store. Every module reads and writes through here; main.js owns
// the transitions, the rest of the game reads. No module keeps its own copy of match truth.
export const PHASE = {
  BUY: 'buy', // buy menu open, players frozen, 15 s
  LIVE: 'live', // round running
  OVER: 'over', // round decided, banner showing
  MATCH: 'match', // match decided, final scoreboard
};

export function createState() {
  return {
    phase: PHASE.BUY,
    round: 1,
    roundsToWin: 5,
    roundTime: 15, // seconds left in the current phase
    fuseTime: 0, // seconds left on a planted device, 0 when none planted
    planted: false,
    plantSite: null, // 'A' | 'B' | null
    planting: 0, // 0..1 progress of the player's plant channel
    defusing: 0, // 0..1 progress of an enemy defuse channel
    defuser: null, // bot currently defusing, if any
    carrier: 'player', // who carries the device: 'player' or a bot id
    score: { vanguard: 0, dusk: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    roundWinner: null, // 'vanguard' | 'dusk' | null
    roundReason: '',
    matchWinner: null,
    freeze: true, // movement frozen during buy phase
    time: 0, // total sim time
    seed: 1,
  };
}
