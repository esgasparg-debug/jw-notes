import { TestBed } from '@angular/core/testing';
import JSZip from 'jszip';
import { createUserDataDb } from '../../../../testing/userdata-schema';
import { SqlJsService } from '../database/sql-js.service';
import { JwManifest, readArchive, sha256Hex, writeArchive } from './jwlibrary-archive';
import { applyWal, toWalMode } from './sqlite-wal';

const MANIFEST: JwManifest = {
  name: 'UserdataBackup_test.jwlibrary',
  creationDate: '2026-01-01',
  version: 1,
  type: 0,
  userDataBackup: {
    lastModifiedDate: '2026-01-01T00:00:00Z',
    deviceName: 'Teste',
    databaseName: 'userData.db',
    hash: '',
    schemaVersion: 16,
  },
};

describe('jwlibrary archive', () => {
  async function sampleDb(): Promise<Uint8Array> {
    const db = await createUserDataDb(TestBed.inject(SqlJsService));
    db.run("INSERT INTO Note (Guid, Title, Content) VALUES ('G', 'olá', 'mundo')");
    const bytes = db.export();
    db.close();
    return bytes;
  }

  it('round-trips the database, manifest and attachments', async () => {
    const database = await sampleDb();
    const thumb = new Uint8Array([1, 2, 3]);
    const bytes = await writeArchive(
      { manifest: MANIFEST, database, attachments: new Map([['default_thumbnail.png', thumb]]) },
      { fileName: 'saida.jwlibrary', modifiedAt: '2026-05-01T10:00:00Z' },
    );

    const back = await readArchive(bytes);

    expect(back.manifest.name).toBe('saida.jwlibrary');
    expect(back.manifest.userDataBackup.lastModifiedDate).toBe('2026-05-01T10:00:00Z');
    expect(back.attachments.get('default_thumbnail.png')).toEqual(thumb);
    const db = await TestBed.inject(SqlJsService).open(back.database);
    expect(db.scalar<string>("SELECT Content FROM Note WHERE Guid = 'G'")).toBe('mundo');
    db.close();
  });

  it('stores the SHA-256 of the database file exactly as zipped', async () => {
    const bytes = await writeArchive(
      { manifest: MANIFEST, database: await sampleDb(), attachments: new Map() },
      { fileName: 'x.jwlibrary' },
    );
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as JwManifest;
    const db = new Uint8Array(await zip.file('userData.db')!.async('arraybuffer'));

    expect(manifest.userDataBackup.hash).toBe(await sha256Hex(db));
    expect([db[18], db[19]]).toEqual([2, 2]); // WAL flag restored, like JW Library writes it
  });

  it('drops leftover -wal/-shm/-journal entries and rejects non-backups', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(MANIFEST));
    zip.file('userData.db', await sampleDb());
    zip.file('userData.db-shm', new Uint8Array(8));
    zip.file('userData.db-journal', new Uint8Array(0));
    const back = await readArchive(await zip.generateAsync({ type: 'uint8array' }));

    expect([...back.attachments.keys()]).toEqual([]);
    await expect(readArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/não é um zip/);
  });

  it('opens WAL-mode databases and ignores an empty/zeroed WAL', async () => {
    const db = toWalMode(await sampleDb());
    const { bytes, appliedFrames } = applyWal(db, new Uint8Array(4096));

    expect(appliedFrames).toBe(0);
    expect([bytes[18], bytes[19]]).toEqual([1, 1]);
  });
});
