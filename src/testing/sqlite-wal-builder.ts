/**
 * Writes a real SQLite write-ahead log, like the userData.db-wal JW Library leaves next to its
 * database while changes are not yet checkpointed. Each transaction carries the pages that differ
 * from the previous state; `commit: false` leaves it unfinished, as if the app was mid-write.
 *
 * Format: https://www.sqlite.org/fileformat2.html#walformat (big-endian checksums).
 */
export function buildWal(before: Uint8Array, transactions: { after: Uint8Array; commit?: boolean }[]): Uint8Array {
  const pageSize = pageSizeOf(before);
  const salt1 = 0x1234_5678;
  const salt2 = 0x0abc_def0;
  const frames: { pgno: number; page: Uint8Array; commitSize: number }[] = [];
  let previous = before;
  for (const { after, commit = true } of transactions) {
    const pages = after.byteLength / pageSize;
    const changed: number[] = [];
    for (let pgno = 1; pgno <= pages; pgno++) {
      const page = after.subarray((pgno - 1) * pageSize, pgno * pageSize);
      const old = previous.subarray((pgno - 1) * pageSize, pgno * pageSize);
      if (old.byteLength !== pageSize || page.some((b, i) => b !== old[i])) changed.push(pgno);
    }
    changed.forEach((pgno, i) =>
      frames.push({
        pgno,
        page: after.subarray((pgno - 1) * pageSize, pgno * pageSize),
        commitSize: commit && i === changed.length - 1 ? pages : 0,
      }),
    );
    previous = after;
  }

  const wal = new Uint8Array(32 + frames.length * (24 + pageSize));
  const v = new DataView(wal.buffer);
  v.setUint32(0, 0x377f0683);
  v.setUint32(4, 3007000);
  v.setUint32(8, pageSize);
  v.setUint32(16, salt1);
  v.setUint32(20, salt2);
  let [s0, s1] = checksum(wal, 0, 24, 0, 0);
  v.setUint32(24, s0);
  v.setUint32(28, s1);
  frames.forEach(({ pgno, page, commitSize }, i) => {
    const off = 32 + i * (24 + pageSize);
    v.setUint32(off, pgno);
    v.setUint32(off + 4, commitSize);
    v.setUint32(off + 8, salt1);
    v.setUint32(off + 12, salt2);
    wal.set(page, off + 24);
    [s0, s1] = checksum(wal, off, 8, s0, s1);
    [s0, s1] = checksum(wal, off + 24, pageSize, s0, s1);
    v.setUint32(off + 16, s0);
    v.setUint32(off + 20, s1);
  });
  return wal;
}

function pageSizeOf(db: Uint8Array): number {
  const size = (db[16] << 8) | db[17];
  return size === 1 ? 65536 : size;
}

function checksum(buf: Uint8Array, off: number, len: number, s0: number, s1: number): [number, number] {
  const v = new DataView(buf.buffer, buf.byteOffset + off, len);
  for (let i = 0; i < len; i += 8) {
    s0 = (s0 + v.getUint32(i) + s1) >>> 0;
    s1 = (s1 + v.getUint32(i + 4) + s0) >>> 0;
  }
  return [s0, s1];
}
