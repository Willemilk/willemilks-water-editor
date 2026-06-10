// Official terrain material palette for Where's My Water?
// Source: assets/Levels/LevelEditor.psd (developer-left documentation inside the game)
// The engine identifies materials by RGB color in the level PNG.

export const MATERIALS = [
  { id: 'empty',     name: 'Empty (air)',     rgb: [255, 255, 255], dig: false, desc: 'Open space. Fluids flow freely here.' },
  { id: 'dirt',      name: 'Dirt',            rgb: [113, 91, 49],   dig: true,  desc: 'Diggable ground. The player swipes through this.' },
  { id: 'rock',      name: 'Rock',            rgb: [71, 71, 71],    dig: false, desc: 'Solid, can never be dug.' },
  { id: 'rock_sh',   name: 'Rock shadow',     rgb: [40, 40, 40],    dig: false, desc: 'Visual shading variant of rock (solid).' },
  { id: 'rock_hi',   name: 'Rock highlight',  rgb: [166, 166, 166], dig: false, desc: 'Visual highlight variant of rock (solid).' },
  { id: 'water',     name: 'Water',           rgb: [43, 33, 254],   dig: false, desc: 'Pre-placed water at level start.' },
  { id: 'poison',    name: 'Poison',          rgb: [139, 25, 135],  dig: false, desc: 'Pre-placed contaminated water.' },
  { id: 'ooze',      name: 'Ooze',            rgb: [190, 101, 47],  dig: false, desc: 'Pre-placed ooze (lava).' },
  { id: 'algae',     name: 'Algae',           rgb: [25, 139, 38],   dig: false, desc: 'Grows when watered; absorbs fluids.' },
  { id: 'room',      name: "Swampy's room",   rgb: [255, 234, 0],   dig: false, desc: 'Marks the room/bathtub area (yellow).' },
];

// A few near-duplicate colors that appear in shipped levels (compression-era variants).
// Treated as aliases for classification, never written when painting.
export const MATERIAL_ALIASES = {
  '112,91,49': 'dirt',
  '254,234,0': 'room',
  '255,235,18': 'room',
  '43,34,254': 'water',
};

export const DEFAULT_LEVEL_WIDTH = 90;
export const DEFAULT_LEVEL_HEIGHT = 120;

/** The three rock variants behave as one material when Smart rock is on. */
export const ROCK_FAMILY_IDS = ['rock', 'rock_sh', 'rock_hi'];
export const rockFamilyRgbs = () =>
  ROCK_FAMILY_IDS.map((id) => MATERIALS.find((m) => m.id === id).rgb);

const byKey = new Map();
for (const m of MATERIALS) byKey.set(m.rgb.join(','), m);

export function materialForColor(r, g, b) {
  const key = `${r},${g},${b}`;
  if (byKey.has(key)) return byKey.get(key);
  const alias = MATERIAL_ALIASES[key];
  if (alias) return MATERIALS.find((m) => m.id === alias);
  return null;
}

/** Nearest material by RGB distance — used only for labeling unknown pixels. */
export function nearestMaterial(r, g, b) {
  const exact = materialForColor(r, g, b);
  if (exact) return exact;
  let best = MATERIALS[0];
  let bestD = Infinity;
  for (const m of MATERIALS) {
    const dr = m.rgb[0] - r, dg = m.rgb[1] - g, db = m.rgb[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

export function getMaterial(id) {
  return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
}
