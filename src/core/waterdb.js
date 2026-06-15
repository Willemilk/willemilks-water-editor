// Thin, lazy wrapper around sql.js for reading and writing the game's water.db.
// Everything here is dynamically imported on first use so the WASM never touches
// app start up — if it fails to load the editor keeps working and the caller can
// fall back to the plain requirements string.

let _SQL = null;
async function getSQL() {
  if (_SQL) return _SQL;
  const initSqlJs = (await import('sql.js/dist/sql-wasm.js')).default;
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  _SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return _SQL;
}

const TABLE = 'CrankyChallengeInfo';

/** Read the challenge stored for a level path ("/Levels/foo"), or null. */
export async function readChallenge(dbBytes, levelPath) {
  const SQL = await getSQL();
  const db = new SQL.Database(new Uint8Array(dbBytes));
  try {
    const res = db.exec(`SELECT LevelRequirements, Desc FROM ${TABLE} WHERE LevelName = :p`, { ':p': levelPath });
    if (!res.length || !res[0].values.length) return null;
    const [requirements, desc] = res[0].values[0];
    return { requirements: requirements || '', desc: desc || '' };
  } finally {
    db.close();
  }
}

/**
 * Upsert a challenge for a level into water.db and return the new db bytes.
 * Updates the existing row for the level, or inserts a fresh one with a new ID.
 */
export async function writeChallenge(dbBytes, levelPath, requirements, desc) {
  const SQL = await getSQL();
  const db = new SQL.Database(new Uint8Array(dbBytes));
  try {
    const existing = db.exec(`SELECT ID FROM ${TABLE} WHERE LevelName = :p`, { ':p': levelPath });
    if (existing.length && existing[0].values.length) {
      db.run(`UPDATE ${TABLE} SET LevelRequirements = :r, Desc = :d, Available = 1 WHERE LevelName = :p`,
        { ':r': requirements, ':d': desc, ':p': levelPath });
    } else {
      const m = db.exec(`SELECT MAX(ID) FROM ${TABLE}`);
      const nextId = (m.length && m[0].values[0][0] != null ? m[0].values[0][0] : 0) + 1;
      db.run(
        `INSERT INTO ${TABLE} (ID, Available, Completed, LevelName, LevelRequirements, TimesPlayed, TimesCompleted, Desc)
         VALUES (:id, 1, 0, :p, :r, 0, 0, :d)`,
        { ':id': nextId, ':p': levelPath, ':r': requirements, ':d': desc });
    }
    return db.export();
  } finally {
    db.close();
  }
}

/** Remove the challenge row for a level. Returns new db bytes. */
export async function clearChallenge(dbBytes, levelPath) {
  const SQL = await getSQL();
  const db = new SQL.Database(new Uint8Array(dbBytes));
  try {
    db.run(`DELETE FROM ${TABLE} WHERE LevelName = :p`, { ':p': levelPath });
    return db.export();
  } finally {
    db.close();
  }
}
