const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');
const { SCHEMA_SQL, SCHEMA_VERSION } = require('./schema');
const { runSeed } = require('./seed');

let instance = null;

function openDatabase(dbPath) {
  const inMemory = dbPath === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    if (!inMemory) db.pragma('journal_mode = WAL');

    const version = db.pragma('user_version', { simple: true });
    if (version < SCHEMA_VERSION) {
      db.transaction(() => {
        db.exec(SCHEMA_SQL);
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      })();
    }
    runSeed(db);
  } catch (err) {
    // Libera o handle (no Windows ele trava o arquivo .sqlite) e propaga o erro original.
    db.close();
    throw err;
  }
  return db;
}

function getDb() {
  if (!instance) instance = openDatabase(env.dbPath);
  return instance;
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, closeDb, openDatabase };
