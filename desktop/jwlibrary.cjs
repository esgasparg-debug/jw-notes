// Finds, reads and (after a sync) replaces JW Library's own database on this computer, so the
// app can back it up and update it without "Criar backup" / "Restaurar backup" in JW Library.
//
// JW Library for Windows (Microsoft Store) keeps it in
//   %LOCALAPPDATA%\Packages\WatchtowerBibleandTractSo.<id>\LocalState\UserData\userData.db
// Set JW_LIBRARY_DB to the full path of userData.db for any other install.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_PREFIX = 'watchtowerbibleandtract';
const DB_NAME = 'userData.db';
const SNAPSHOT_ATTEMPTS = 5;
const RETRY_MS = 400;

/** Full path of userData.db, or null when JW Library is not installed here. */
function locateJwLibrary() {
  const override = process.env.JW_LIBRARY_DB;
  if (override) return fs.existsSync(override) ? override : null;
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;

  const packages = path.join(process.env.LOCALAPPDATA, 'Packages');
  let entries;
  try {
    entries = fs.readdirSync(packages, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith(PACKAGE_PREFIX)) continue;
    const localState = path.join(packages, entry.name, 'LocalState');
    const usual = path.join(localState, 'UserData', DB_NAME);
    const found = fs.existsSync(usual) ? usual : findFile(localState, DB_NAME, 3);
    if (found) return found;
  }
  return null;
}

/**
 * Copies userData.db and its WAL while JW Library may be running. SQLite opens them with
 * shared read access, so reading is safe; to avoid pairing a database and a WAL from different
 * moments (a checkpoint in between), both are read again until their size and date stay still.
 * Torn tails of the WAL are harmless: only committed frames with valid checksums are replayed.
 */
async function readJwLibrary(dbPath) {
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const before = await stamp(dbPath);
    const [database, wal] = await Promise.all([fsp.readFile(dbPath), readOptional(`${dbPath}-wal`)]);
    if (before === (await stamp(dbPath))) return { database, ...(wal?.length ? { wal } : {}) };
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  throw new Error('O JW Library está gravando dados agora. Tente de novo em alguns segundos.');
}

/**
 * Replaces JW Library's database with `database` (a merged userData.db, WAL flag set). Only
 * while JW Library is closed: SQLite keeps the file open without delete sharing, so renaming it
 * fails when the app is running. The current files are copied to `backupDir` first, and the old
 * -wal/-shm are removed, otherwise SQLite would replay stale pages over the new database.
 */
async function applyJwLibrary(dbPath, database, backupDir) {
  const probe = `${dbPath}.jw-notes-probe`;
  try {
    await fsp.rename(dbPath, probe);
    await fsp.rename(probe, dbPath);
  } catch (e) {
    if (fs.existsSync(probe)) await fsp.rename(probe, dbPath);
    throw new Error('Feche o JW Library para atualizar os dados dele e tente de novo.');
  }

  const sideFiles = [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`].filter((p) => fs.existsSync(p));
  await fsp.mkdir(backupDir, { recursive: true });
  for (const file of [dbPath, ...sideFiles]) await fsp.copyFile(file, path.join(backupDir, path.basename(file)));

  const temp = `${dbPath}.jw-notes-new`;
  await fsp.writeFile(temp, database);
  for (const file of sideFiles) await fsp.rm(file, { force: true });
  await fsp.rename(temp, dbPath);
  return { backupDir };
}

async function stamp(dbPath) {
  const parts = await Promise.all(
    [dbPath, `${dbPath}-wal`].map((p) =>
      fsp.stat(p).then(
        (s) => `${s.size}:${s.mtimeMs}`,
        () => '-',
      ),
    ),
  );
  return parts.join('|');
}

async function readOptional(file) {
  try {
    return await fsp.readFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
}

function findFile(dir, name, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === name.toLowerCase());
  if (hit) return path.join(dir, hit.name);
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findFile(path.join(dir, e.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

module.exports = { locateJwLibrary, readJwLibrary, applyJwLibrary };
