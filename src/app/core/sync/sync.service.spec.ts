import { TestBed } from '@angular/core/testing';
import { FakeDriveApi } from '../../../testing/fake-drive-api';
import { createUserDataDb, seed } from '../../../testing/userdata-schema';
import { JwManifest, writeArchive } from '../jwlibrary/archive/jwlibrary-archive';
import { SqlJsService } from '../jwlibrary/database/sql-js.service';
import { JwLibraryService } from '../jwlibrary/jwlibrary.service';
import { LocalJwLibrary } from '../jwlibrary/live/local-jwlibrary';
import { DriveApi } from '../storage/google-drive/drive-api';
import { Bytes } from '../storage/storage.models';
import { FakeSyncNotifier } from '../../../testing/fake-sync-notifier';
import { SyncNotifier } from './sync-notifier';
import { SyncService } from './sync.service';

const PENDING = ['jw-notes', 'backups', 'pendente'];
const DONE = ['jw-notes', 'backups', 'sincronizados'];
const SYNC = ['jw-notes', 'sync'];

function manifest(device: string): JwManifest {
  return {
    name: `UserdataBackup_${device}.jwlibrary`,
    creationDate: '2026-10-29',
    version: 1,
    type: 0,
    userDataBackup: { lastModifiedDate: '', deviceName: device, databaseName: 'userData.db', hash: '', schemaVersion: 16 },
  };
}

describe('SyncService', () => {
  let drive: FakeDriveApi;
  let sync: SyncService;

  /** Builds a .jwlibrary backup the way a phone would upload it. */
  async function backup(device: string, lastModified: string, fill: (s: ReturnType<typeof seed>) => void): Promise<Bytes> {
    const db = await createUserDataDb(TestBed.inject(SqlJsService), lastModified);
    fill(seed(db));
    const database = db.export();
    db.close();
    return writeArchive(
      { manifest: manifest(device), database, attachments: new Map() },
      { fileName: `${device}.jwlibrary`, modifiedAt: lastModified },
    );
  }

  async function notesInSyncFile(): Promise<string[]> {
    const [file] = drive.filesIn(...SYNC);
    const doc = await TestBed.inject(JwLibraryService).open({
      ref: { providerId: 'google-drive', id: file.id, name: file.name },
      bytes: await drive.download(file.id),
    });
    const titles = doc.userData.notes
      .list()
      .map((n) => n.title)
      .sort();
    doc.close();
    return titles;
  }

  beforeEach(() => {
    drive = new FakeDriveApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: drive },
        { provide: SyncNotifier, useValue: new FakeSyncNotifier() },
      ],
    });
    sync = TestBed.inject(SyncService);
  });

  it('creates the jw-notes folder tree on first use', async () => {
    await sync.refresh();

    expect(drive.namesIn('jw-notes')).toEqual(['backups', 'config', 'sync']);
    expect(drive.namesIn('jw-notes', 'backups')).toEqual(['pendente', 'sincronizados']);
    expect(sync.overview()?.pending).toEqual([]);
    expect(sync.overview()?.current).toBeNull();
  });

  it('merges every pending backup into a single sync file and archives the originals', async () => {
    await sync.refresh();
    const inbox = drive.folderId(...PENDING);
    drive.addFile(
      inbox,
      'samsung.jwlibrary',
      await backup('Samsung', '2026-10-02T00:00:00Z', (s) => s.note('S1', 'do Samsung', 'a', '2026-10-02T00:00:00Z')),
    );
    drive.addFile(
      inbox,
      'xiaomi.jwlibrary',
      await backup('Xiaomi', '2026-10-29T00:00:00Z', (s) => s.note('X1', 'do Xiaomi', 'b', '2026-10-29T00:00:00Z')),
    );

    const outcome = await sync.sync();

    expect(sync.error()).toBeNull();
    expect(outcome?.processed.length).toBe(2);
    expect(drive.namesIn(...PENDING)).toEqual([]);
    expect(drive.namesIn(...DONE)).toEqual(['samsung.jwlibrary', 'xiaomi.jwlibrary']);
    expect(drive.filesIn(...SYNC).length).toBe(1);
    expect(drive.filesIn(...SYNC)[0].name).toMatch(/^JW-Notes_Sync_\d{4}-\d{2}-\d{2}_\d{4}\.jwlibrary$/);
    expect(await notesInSyncFile()).toEqual(['do Samsung', 'do Xiaomi']);
  });

  it('updates the same sync file on later syncs, keeping exactly one file there', async () => {
    await sync.refresh();
    const inbox = drive.folderId(...PENDING);
    drive.addFile(
      inbox,
      'a.jwlibrary',
      await backup('Samsung', '2026-10-02T00:00:00Z', (s) => s.note('S1', 'primeira', '', '2026-10-02T00:00:00Z')),
    );
    await sync.sync();
    const firstId = drive.filesIn(...SYNC)[0].id;

    drive.addFile(
      inbox,
      'b.jwlibrary',
      await backup('Xiaomi', '2026-10-30T00:00:00Z', (s) => s.note('X2', 'segunda', '', '2026-10-30T00:00:00Z')),
    );
    await sync.sync();

    expect(drive.filesIn(...SYNC).map((f) => f.id)).toEqual([firstId]);
    expect(await notesInSyncFile()).toEqual(['primeira', 'segunda']);
  });

  it('does nothing when there are no pending backups', async () => {
    await sync.refresh();

    expect(await sync.sync()).toBeNull();
    expect(drive.namesIn(...SYNC)).toEqual([]);
  });

  it('leaves unreadable files in the inbox and reports them', async () => {
    await sync.refresh();
    const inbox = drive.folderId(...PENDING);
    drive.addFile(inbox, 'quebrado.jwlibrary', new Uint8Array([1, 2, 3]));
    drive.addFile(
      inbox,
      'ok.jwlibrary',
      await backup('Samsung', '2026-10-02T00:00:00Z', (s) => s.note('S1', 'ok', '', '2026-10-02T00:00:00Z')),
    );

    const outcome = await sync.sync();

    expect(outcome?.skipped.map((s) => s.ref.name)).toEqual(['quebrado.jwlibrary']);
    expect(drive.namesIn(...PENDING)).toEqual(['quebrado.jwlibrary']);
    expect(drive.namesIn(...DONE)).toEqual(['ok.jwlibrary']);
  });

  it('stores a custom inbox in jw-notes/config/settings.json and syncs from it', async () => {
    await sync.refresh();
    const custom = await drive.createFolder('root', 'Backups do celular');
    await sync.setInbox({
      folder: { id: custom.id, name: custom.name },
      path: [
        { id: 'root', name: 'Meu Drive' },
        { id: custom.id, name: custom.name },
      ],
    });
    drive.addFile(
      custom.id,
      'c.jwlibrary',
      await backup('Samsung', '2026-10-02T00:00:00Z', (s) => s.note('S1', 'da pasta própria', '', '2026-10-02T00:00:00Z')),
    );

    // A second device opening the app picks up the shared setting.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: drive },
        { provide: SyncNotifier, useValue: new FakeSyncNotifier() },
      ],
    });
    const otherDevice = TestBed.inject(SyncService);
    await otherDevice.refresh();
    await otherDevice.sync();

    expect(drive.namesIn('jw-notes', 'config')).toEqual(['aparelhos', 'settings.json']);
    expect(otherDevice.inboxPath()?.at(-1)?.name).toBe('Backups do celular');
    expect(drive.namesIn(...DONE)).toEqual(['c.jwlibrary']);
    expect(await notesInSyncFile()).toEqual(['da pasta própria']);
  });

  describe('with JW Library installed on this computer', () => {
    let local: { database: Uint8Array; lastModified: string };

    async function setLocal(lastModified: string, ...titles: string[]): Promise<void> {
      const db = await createUserDataDb(TestBed.inject(SqlJsService), lastModified);
      const s = seed(db);
      titles.forEach((t, i) => s.note(`L${i}`, t, '', lastModified));
      local = { database: db.export(), lastModified };
      db.close();
    }

    beforeEach(async () => {
      localStorage.clear();
      await setLocal('2026-11-02T21:15:00Z', 'do computador');
      const fake: LocalJwLibrary = {
        locate: async () => 'C:\\JW\\userData.db',
        read: async () => ({ database: local.database, deviceName: 'PC-SALA' }),
        apply: async () => undefined,
        openBackup: async () => undefined,
      };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: DriveApi, useValue: drive },
          { provide: LocalJwLibrary, useValue: fake },
          { provide: SyncNotifier, useValue: new FakeSyncNotifier() },
        ],
      });
      sync = TestBed.inject(SyncService);
      await sync.restore();
    });

    it('backs it up and merges it without a manual backup', async () => {
      const inbox = drive.folderId(...PENDING);
      drive.addFile(
        inbox,
        'xiaomi.jwlibrary',
        await backup('Xiaomi', '2026-10-29T00:00:00Z', (s) => s.note('X1', 'do Xiaomi', '', '2026-10-29T00:00:00Z')),
      );

      const outcome = await sync.sync();

      expect(sync.error()).toBeNull();
      expect(sync.localLibrary()).toBe('C:\\JW\\userData.db');
      expect(outcome?.processed.map((p) => p.name).sort()).toEqual([
        expect.stringMatching(/^UserdataBackup_\d{4}-\d{2}-\d{2}_PC-SALA\.jwlibrary$/),
        'xiaomi.jwlibrary',
      ]);
      expect(drive.namesIn(...PENDING)).toEqual([]);
      expect(await notesInSyncFile()).toEqual(['do Xiaomi', 'do computador']);
    });

    it('does not upload again until JW Library changes', async () => {
      await sync.sync();
      expect(await sync.sync()).toBeNull();
      expect(drive.namesIn(...DONE).length).toBe(1);

      await setLocal('2026-11-03T10:00:00Z', 'do computador', 'nova');
      expect(await sync.sync()).not.toBeNull();
      expect(await notesInSyncFile()).toEqual(['do computador', 'nova']);
    });
  });

  it('syncs a backup shared from JW Library right away', async () => {
    const bytes = await backup('Xiaomi', '2026-11-03T08:00:00Z', (s) => s.note('X1', 'compartilhada', '', '2026-11-03T08:00:00Z'));

    const outcome = await sync.syncReceived('UserdataBackup_2026-11-03_Xiaomi_2412DPC0AG.jwlibrary', bytes);

    expect(outcome?.processed.map((p) => p.name)).toEqual(['UserdataBackup_2026-11-03_Xiaomi_2412DPC0AG.jwlibrary']);
    expect(await notesInSyncFile()).toEqual(['compartilhada']);
  });

  it('keeps files that are not backups out of the inbox', async () => {
    await sync.refresh();

    expect(await sync.syncReceived('foto.jpg', new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sync.error()).toMatch(/não é um backup/);
    expect(drive.namesIn(...PENDING)).toEqual([]);
  });
});
