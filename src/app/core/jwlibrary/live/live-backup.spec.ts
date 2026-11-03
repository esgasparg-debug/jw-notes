import { TestBed } from '@angular/core/testing';
import JSZip from 'jszip';
import { buildWal } from '../../../../testing/sqlite-wal-builder';
import { createUserDataDb, seed } from '../../../../testing/userdata-schema';
import { JwManifest, sha256Hex } from '../archive/jwlibrary-archive';
import { toWalMode } from '../archive/sqlite-wal';
import { SqlJsService } from '../database/sql-js.service';
import { JwLibraryService } from '../jwlibrary.service';
import { LiveDatabase, backupFileName } from './local-jwlibrary';

describe('backup from the live JW Library database', () => {
  let jw: JwLibraryService;
  let sql: SqlJsService;

  beforeEach(() => {
    jw = TestBed.inject(JwLibraryService);
    sql = TestBed.inject(SqlJsService);
  });

  /**
   * userData.db as JW Library leaves it on disk: an older checkpointed main file (WAL flag set)
   * plus a WAL holding the latest note and LastModified.
   */
  async function liveDatabase(opts: { unfinished?: boolean } = {}): Promise<LiveDatabase> {
    const db = await createUserDataDb(sql, '2026-10-01T08:00:00Z');
    seed(db).note('A', 'antiga', '', '2026-10-01T08:00:00Z');
    const checkpointed = toWalMode(db.export());
    seed(db).note('B', 'só no WAL', '', '2026-11-02T21:15:00Z');
    db.run('UPDATE LastModified SET LastModified = ?', ['2026-11-02T21:15:00Z']);
    const committed = toWalMode(db.export());
    seed(db).note('C', 'sendo gravada', '', '2026-11-02T21:16:00Z');
    const writing = toWalMode(db.export());
    db.close();
    const transactions = [{ after: committed }, ...(opts.unfinished ? [{ after: writing, commit: false }] : [])];
    return { database: checkpointed, wal: buildWal(checkpointed, transactions), deviceName: 'PC da sala' };
  }

  async function noteTitles(bytes: Uint8Array<ArrayBuffer>): Promise<string[]> {
    const doc = await jw.open({ ref: { providerId: 'local', id: 'x', name: 'x.jwlibrary' }, bytes });
    const titles = doc.userData.notes
      .list()
      .map((n) => n.title ?? '')
      .sort();
    doc.close();
    return titles;
  }

  it("lays the file out like JW Library's own backup", async () => {
    const backup = await jw.createBackup(await liveDatabase(), new Date(2026, 10, 3, 9, 30));

    const zip = await JSZip.loadAsync(backup.bytes);
    expect(Object.keys(zip.files)).toEqual(['userData.db', 'default_thumbnail.png', 'manifest.json']);
    const db = new Uint8Array(await zip.file('userData.db')!.async('arraybuffer'));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as JwManifest;
    expect(manifest).toEqual({
      name: 'UserdataBackup_2026-11-03_PC_da_sala.jwlibrary',
      creationDate: '2026-11-03',
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: '2026-11-02T21:15:00Z',
        deviceName: 'PC_da_sala',
        databaseName: 'userData.db',
        hash: await sha256Hex(db),
        schemaVersion: 16,
      },
    });
    // Same key order as JW Library writes.
    expect(Object.keys(manifest)).toEqual(['name', 'creationDate', 'version', 'type', 'userDataBackup']);
    expect(Object.keys(manifest.userDataBackup)).toEqual(['lastModifiedDate', 'deviceName', 'databaseName', 'hash', 'schemaVersion']);
    expect([db[18], db[19]]).toEqual([2, 2]);
    const png = await zip.file('default_thumbnail.png')!.async('uint8array');
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    expect(backup.name).toBe(manifest.name);
  });

  it('includes changes that JW Library has only written to the WAL', async () => {
    const backup = await jw.createBackup(await liveDatabase());

    expect(backup.walFrames).toBeGreaterThan(0);
    expect(backup.lastModified).toBe('2026-11-02T21:15:00Z');
    expect(await noteTitles(backup.bytes)).toEqual(['antiga', 'só no WAL']);
  });

  it('leaves out a transaction JW Library had not finished writing', async () => {
    const backup = await jw.createBackup(await liveDatabase({ unfinished: true }));

    expect(await noteTitles(backup.bytes)).toEqual(['antiga', 'só no WAL']);
  });

  it('works without a WAL file', async () => {
    const { database } = await liveDatabase();
    const backup = await jw.createBackup({ database, deviceName: 'PC' });

    expect(backup.walFrames).toBe(0);
    expect(await noteTitles(backup.bytes)).toEqual(['antiga']);
  });

  it('refuses databases that are not from JW Library', async () => {
    const other = await sql.open();
    other.run('CREATE TABLE Coisa (Id INTEGER)');
    const bytes = other.export();
    other.close();

    await expect(jw.createBackup({ database: bytes, deviceName: 'PC' })).rejects.toThrow(/não é o banco de dados do JW Library/);
  });

  it('names files the way JW Library does', () => {
    expect(backupFileName(new Date(2026, 0, 5), 'Samsung SM-X216B')).toBe('UserdataBackup_2026-01-05_Samsung_SM-X216B.jwlibrary');
    expect(backupFileName(new Date(2026, 0, 5), '  ')).toBe('UserdataBackup_2026-01-05_Computador.jwlibrary');
  });
});
