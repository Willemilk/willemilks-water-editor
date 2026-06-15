// Custom challenges. The real game stores per level challenges in water.db
// (table CrankyChallengeInfo) as a LevelName, a space separated LevelRequirements
// token string, and a Desc localization key. The native engine evaluates the
// tokens, so we only expose tokens proven to ship in the real game (decoded from
// the 24 stock Cranky challenges) — inventing new tokens would not be evaluated.
// "New" challenges are PRESETS that combine these real tokens.

/**
 * Every condition token the game understands. `kind` drives the editor control:
 *   flag   -> token on its own (crankyducks)
 *   int    -> token:number (ducks:3)
 *   fluid  -> token:fluidname (losefluid:water)
 *   object -> token:ObjectName, picked from level objects of `objKinds`
 */
export const CONDITIONS = [
  { token: 'ducks',       kind: 'int',   label: 'Ducks to collect',        dflt: '3', desc: 'CHALLENGE_CRANKY_DUCKS' },
  { token: 'crankyducks', kind: 'flag',  label: 'Cranky (dirty) ducks',    desc: 'CHALLENGE_CRANKY_DUCKS' },
  { token: 'swampyducks', kind: 'flag',  label: 'Swampy (clean) ducks',    desc: 'CHALLENGE_SWAMPY_DUCKS' },
  { token: 'explosions',  kind: 'int',   label: 'Explosions allowed',      dflt: '0', desc: 'CHALLENGE_NO_EXPLOSIONS' },
  { token: 'nospout',     kind: 'object', label: 'Do not use spout',       objKinds: ['spout', 'sprinkler', 'vacuum'], desc: 'CHALLENGE_BOTTOM_SPOUT' },
  { token: 'noswitch',    kind: 'object', label: 'Do not use switch',      objKinds: ['switch'], desc: 'CHALLENGE_NO_SWITCH' },
  { token: 'nopop',       kind: 'object', label: 'Do not pop balloon',     objKinds: ['balloon'], desc: 'CHALLENGE_NO_BALLOON' },
  { token: 'nofingerpop', kind: 'object', label: 'Do not finger pop balloon', objKinds: ['balloon'], desc: 'CHALLENGE_SQUEEZE_POP' },
  { token: 'losefluid',   kind: 'fluid', label: 'Lose all of a fluid',     dflt: 'water', desc: 'CHALLENGE_NO_WATER' },
  { token: 'yswitchcount', kind: 'int',  label: 'Y switch uses',           dflt: '0', desc: 'CHALLENGE_NO_Y' },
  { token: 'winwait',     kind: 'int',   label: 'Hold the win for (s)',    dflt: '3', desc: 'CHALLENGE_CRANKY_DUCKS' },
  { token: 'waitforwin',  kind: 'int',   label: 'Wait for win',            dflt: '0', desc: 'CHALLENGE_CRANKY_DUCKS' },
  { token: 'ignoremixing', kind: 'flag', label: 'Ignore fluid mixing',     desc: 'CHALLENGE_CRANKY_DUCKS' },
  { token: 'noalgaeooze', kind: 'flag',  label: 'No algae or ooze',        desc: 'CHALLENGE_NO_GREEN_OOZE' },
];

export const FLUID_VALUES = ['water', 'ooze', 'poison', 'steam', 'mud'];

// The Desc localization keys the game ships (each maps to real popup text).
export const DESC_KEYS = [
  'CHALLENGE_CRANKY_DUCKS', 'CHALLENGE_SWAMPY_DUCKS', 'CHALLENGE_ZERO_DUCK',
  'CHALLENGE_NO_EXPLOSIONS', 'CHALLENGE_ALL_EXPLOSIONS', 'CHALLENGE_EXPLOSIONS_TRI',
  'CHALLENGE_NO_WATER', 'CHALLENGE_NO_GREEN_OOZE', 'CHALLENGE_NO_BALLOON',
  'CHALLENGE_SQUEEZE_POP', 'CHALLENGE_NO_SWITCH', 'CHALLENGE_NO_BRIDGE',
  'CHALLENGE_NO_BRIDGE_BUILDING', 'CHALLENGE_NO_ORANGE_GATE', 'CHALLENGE_BOTTOM_SPOUT',
  'CHALLENGE_8_Y_SWITCHES', 'CHALLENGE_NO_Y',
];

export function conditionFor(token) {
  return CONDITIONS.find((c) => c.token === token) || null;
}

/** Build the LevelRequirements string from a list of {token, value}. */
export function buildRequirements(list) {
  return list
    .map(({ token, value }) => {
      const c = conditionFor(token);
      if (!c) return '';
      if (c.kind === 'flag') return token;
      return value != null && value !== '' ? `${token}:${value}` : '';
    })
    .filter(Boolean)
    .join(' ');
}

/** Parse a LevelRequirements string back into a list of {token, value}. */
export function parseRequirements(str) {
  return String(str || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((tk) => {
      const i = tk.indexOf(':');
      return i === -1 ? { token: tk, value: undefined } : { token: tk.slice(0, i), value: tk.slice(i + 1) };
    })
    .filter(({ token }) => conditionFor(token));
}

/**
 * Ready made challenge presets that combine real tokens. `build(objectsByKind)`
 * receives a helper returning the names of level objects of a given kind.
 */
export const PRESETS = [
  { id: 'triduck_cranky', label: 'Triduck with Cranky ducks', desc: 'CHALLENGE_CRANKY_DUCKS',
    build: () => [{ token: 'crankyducks' }, { token: 'ducks', value: '3' }] },
  { id: 'zero_duck', label: 'Zero duck run', desc: 'CHALLENGE_ZERO_DUCK',
    build: () => [{ token: 'ducks', value: '0' }] },
  { id: 'pacifist', label: 'Pacifist (no explosions)', desc: 'CHALLENGE_NO_EXPLOSIONS',
    build: () => [{ token: 'explosions', value: '0' }, { token: 'ducks', value: '3' }] },
  { id: 'drought', label: 'Drought (lose all water)', desc: 'CHALLENGE_NO_WATER',
    build: () => [{ token: 'losefluid', value: 'water' }, { token: 'ducks', value: '3' }] },
  { id: 'no_switches', label: 'No switches', desc: 'CHALLENGE_NO_SWITCH',
    build: (names) => [...names('switch').map((n) => ({ token: 'noswitch', value: n })), { token: 'ducks', value: '3' }] },
  { id: 'balloon_saver', label: 'Balloon saver (pop none)', desc: 'CHALLENGE_NO_BALLOON',
    build: (names) => names('balloon').flatMap((n) => [{ token: 'nopop', value: n }, { token: 'nofingerpop', value: n }]) },
];
