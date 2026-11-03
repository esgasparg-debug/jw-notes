/**
 * Folds a SQLite write-ahead log into its main database file.
 *
 * JW Library sometimes zips `userData.db` together with a non-empty `userData.db-wal`.
 * Committed transactions that live only in the WAL would be lost if we opened the
 * main file alone, and sql.js cannot open WAL databases, so we replay the WAL here.
 *
 * Format reference: https://www.sqlite.org/fileformat2.html#walformat
 */

const WAL_HEADER = 32;
const FRAME_HEADER = 24;
const MAGIC_LE = 0x377f0682;
const MAGIC_BE = 0x377f0683;

export interface WalResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Number of committed frames replayed into the database. */
  appliedFrames: number;
}

export function applyWal(db: Uint8Array, wal: Uint8Array | undefined): WalResult {
  const out = toRollbackJournalMode(db);
  if (!wal || wal.byteLength < WAL_HEADER) return { bytes: out, appliedFrames: 0 };

  const h = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
  const magic = h.getUint32(0);
  if (magic !== MAGIC_LE && magic !== MAGIC_BE) return { bytes: out, appliedFrames: 0 };
  const bigEndian = magic === MAGIC_BE;
  const pageSize = h.getUint32(8) || 65536;
  const salt1 = h.getUint32(16);
  const salt2 = h.getUint32(20);

  let [s0, s1] = checksum(wal, 0, 24, 0, 0, bigEndian);
  if (s0 !== h.getUint32(24) || s1 !== h.getUint32(28)) return { bytes: out, appliedFrames: 0 };

  // Collect frames up to the last valid commit; anything after it is an incomplete transaction.
  const pending = new Map<number, number>();
  let committed = new Map<number, number>();
  let dbPages = 0;
  let applied = 0;
  const frameSize = FRAME_HEADER + pageSize;
  for (let off = WAL_HEADER; off + frameSize <= wal.byteLength; off += frameSize) {
    if (h.getUint32(off + 8) !== salt1 || h.getUint32(off + 12) !== salt2) break;
    [s0, s1] = checksum(wal, off, 8, s0, s1, bigEndian);
    [s0, s1] = checksum(wal, off + FRAME_HEADER, pageSize, s0, s1, bigEndian);
    if (s0 !== h.getUint32(off + 16) || s1 !== h.getUint32(off + 20)) break;

    pending.set(h.getUint32(off), off + FRAME_HEADER);
    const commitSize = h.getUint32(off + 4);
    if (commitSize > 0) {
      committed = new Map([...committed, ...pending]);
      pending.clear();
      dbPages = commitSize;
      applied = committed.size;
    }
  }
  if (!applied) return { bytes: out, appliedFrames: 0 };

  const result = new Uint8Array(dbPages * pageSize);
  result.set(out.subarray(0, Math.min(out.byteLength, result.byteLength)));
  for (const [pgno, dataOff] of committed) {
    if (pgno > dbPages) continue;
    result.set(wal.subarray(dataOff, dataOff + pageSize), (pgno - 1) * pageSize);
  }
  return { bytes: toRollbackJournalMode(result), appliedFrames: applied };
}

/**
 * Bytes 18–19 of the header are 2 when the file is in WAL mode. Setting them to 1 lets
 * engines without WAL support (sql.js) open it; JW Library re-enables WAL on its own.
 */
function toRollbackJournalMode(db: Uint8Array): Uint8Array<ArrayBuffer> {
  return withJournalFlag(db, 2, 1);
}

/** Restores the WAL flag before the database goes back into a backup, matching what JW Library writes. */
export function toWalMode(db: Uint8Array): Uint8Array<ArrayBuffer> {
  return withJournalFlag(db, 1, 2);
}

function withJournalFlag(db: Uint8Array, from: number, to: number): Uint8Array<ArrayBuffer> {
  const copy = db.slice();
  if (copy.byteLength >= 20 && copy[18] === from && copy[19] === from) {
    copy[18] = to;
    copy[19] = to;
  }
  return copy;
}

function checksum(buf: Uint8Array, off: number, len: number, s0: number, s1: number, bigEndian: boolean): [number, number] {
  const v = new DataView(buf.buffer, buf.byteOffset + off, len);
  for (let i = 0; i < len; i += 8) {
    s0 = (s0 + v.getUint32(i, !bigEndian) + s1) >>> 0;
    s1 = (s1 + v.getUint32(i + 4, !bigEndian) + s0) >>> 0;
  }
  return [s0, s1];
}
