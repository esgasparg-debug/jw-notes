import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeDriveApi } from '../../../testing/fake-drive-api';
import { FakeSyncNotifier } from '../../../testing/fake-sync-notifier';
import { createUserDataDb, seed } from '../../../testing/userdata-schema';
import { writeArchive } from '../jwlibrary/archive/jwlibrary-archive';
import { SqlJsService } from '../jwlibrary/database/sql-js.service';
import { JwLibraryService } from '../jwlibrary/jwlibrary.service';
import { LiveDatabase, LocalJwLibrary } from '../jwlibrary/live/local-jwlibrary';
import { RuntimePlatform } from '../platform/platform.service';
import { DriveApi } from '../storage/google-drive/drive-api';
import { Bytes } from '../storage/storage.models';
import { DeviceIdentity } from './devices';
import { DriveWorkspace } from './drive-workspace';
import { SyncNotifier } from './sync-notifier';
import { SyncService } from './sync.service';

/** JW Library for Windows on a computer: readable, and writable while "closed". */
class FakeComputerLibrary extends LocalJwLibrary {
  applied?: Uint8Array;
  constructor(public database: Uint8Array) {
    super();
  }
  async locate(): Promise<string | null> {
    return 'C:\\JW\\userData.db';
  }
  async read(): Promise<LiveDatabase> {
    return { database: this.database, deviceName: 'PC-SALA' };
  }
  async apply(database: Uint8Array): Promise<void> {
    this.applied = database;
    this.database = database;
  }
  async openBackup(): Promise<void> {
    throw new Error('not expected: backup without media');
  }
}

const noLibrary = new (class extends LocalJwLibrary {
  locate = async () => null;
  read = async (): Promise<LiveDatabase> => {
    throw new Error('no library');
  };
  apply = async () => undefined;
  openBackup = async () => undefined;
})();

interface Device {
  id: string;
  sync: SyncService;
  prefs: Record<string, string>;
}

describe('sync rounds between devices', () => {
  let drive: FakeDriveApi;
  let notifier: FakeSyncNotifier;
  let active: Device | null;
  let sql: SqlJsService;

  beforeEach(() => {
    drive = new FakeDriveApi();
    notifier = new FakeSyncNotifier();
    active = null;
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: drive },
        { provide: SyncNotifier, useValue: notifier },
      ],
    });
    sql = TestBed.inject(SqlJsService);
  });

  /** Each device keeps its own preferences, as it would in its own app storage. */
  function use(d: Device): SyncService {
    if (active !== d) {
      if (active) active.prefs = { ...localStorage };
      localStorage.clear();
      for (const [k, v] of Object.entries(d.prefs)) localStorage.setItem(k, v);
      active = d;
    }
    return d.sync;
  }

  function device(id: string, name: string, platform: RuntimePlatform, library: LocalJwLibrary = noLibrary): Device {
    const identity = { id, platform, pushToken: signal(null), setPushToken: () => undefined, deviceName: async () => name };
    const injector = createEnvironmentInjector(
      [SyncService, DriveWorkspace, { provide: DeviceIdentity, useValue: identity }, { provide: LocalJwLibrary, useValue: library }],
      TestBed.inject(EnvironmentInjector),
    );
    const d = { id, sync: injector.get(SyncService), prefs: {} };
    use(d);
    return d;
  }

  async function database(lastModified: string, ...titles: string[]): Promise<Uint8Array> {
    const db = await createUserDataDb(sql, lastModified);
    titles.forEach((t, i) => seed(db).note(`${t}-${i}`, t, '', lastModified));
    const bytes = db.export();
    db.close();
    return bytes;
  }

  /** What JW Library on the phone hands over through the share sheet. */
  async function phoneBackup(device: string, lastModified: string, ...titles: string[]): Promise<Bytes> {
    return writeArchive(
      {
        manifest: {
          name: `${device}.jwlibrary`,
          creationDate: lastModified.slice(0, 10),
          version: 1,
          type: 0,
          userDataBackup: { lastModifiedDate: lastModified, deviceName: device, databaseName: 'userData.db', hash: '', schemaVersion: 16 },
        },
        database: await database(lastModified, ...titles),
        attachments: new Map(),
      },
      { fileName: `${device}.jwlibrary`, modifiedAt: lastModified },
    );
  }

  async function syncedTitles(): Promise<string[]> {
    const [file] = drive.filesIn('jw-notes', 'sync');
    const doc = await TestBed.inject(JwLibraryService).open({
      ref: { providerId: 'google-drive', id: file.id, name: file.name },
      bytes: await drive.download(file.id),
    });
    const titles = doc.userData.notes
      .list()
      .map((n) => n.title ?? '')
      .sort();
    doc.close();
    return titles;
  }

  async function titlesIn(db: Uint8Array): Promise<string[]> {
    const open = await sql.open(db.slice());
    const titles = open
      .all<{ Title: string }>('SELECT Title FROM Note')
      .map((r) => r.Title)
      .sort();
    open.close();
    return titles;
  }

  /** Phone and computer registered; the phone opens the app first. */
  async function phoneAndComputer() {
    const pcLibrary = new FakeComputerLibrary(await database('2026-11-02T20:00:00Z', 'do PC'));
    const phone = device('xiaomi', 'Xiaomi_2412DPC0AG', 'android');
    await phone.sync.refresh();
    const pc = device('pc', 'PC-SALA', 'electron', pcLibrary);
    await pc.sync.restore();
    return { phone, pc, pcLibrary };
  }

  it('registers the devices that have a JW Library', async () => {
    await phoneAndComputer();
    const browser = device('browser', 'Navegador', 'web');
    await browser.sync.refresh();

    expect(drive.namesIn('jw-notes', 'config', 'aparelhos')).toEqual(['pc.json', 'xiaomi.json']);
    expect(browser.sync.devices().map((d) => d.device.name)).toEqual(['PC-SALA', 'Xiaomi_2412DPC0AG']);
  });

  it('waits for every device, asking the missing ones, then merges and tells everyone to update', async () => {
    const { phone, pc, pcLibrary } = await phoneAndComputer();

    // 1. The phone shares its backup: nothing is merged yet, the computer is asked for its own.
    use(phone);
    expect(
      await phone.sync.syncReceived(
        'UserdataBackup_2026-11-03_Xiaomi.jwlibrary',
        await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'),
      ),
    ).toBeNull();
    expect(drive.namesIn('jw-notes', 'sync')).toEqual([]);
    expect(phone.sync.waitingFor().map((d) => d.device.id)).toEqual(['pc']);
    expect(notifier.sent).toEqual([
      { event: 'backup-requested', from: 'xiaomi', targets: ['pc'], devicesFolderId: drive.folderId('jw-notes', 'config', 'aparelhos') },
    ]);

    // 2. The computer sees the request and sends its backup; it was the last one, so it merges.
    use(pc);
    await pc.sync.refresh();
    expect(pc.sync.backupRequested()).toBe(true);
    expect(await pc.sync.sendBackup()).not.toBeNull();
    expect(await syncedTitles()).toEqual(['do PC', 'do celular']);
    expect(drive.namesIn('jw-notes', 'backups', 'pendente')).toEqual([]);
    expect(notifier.sent.at(-1)).toEqual(expect.objectContaining({ event: 'sync-ready', from: 'pc', targets: ['xiaomi'] }));

    // 3. Both are offered the update; the computer writes it straight into JW Library.
    expect(pc.sync.updateReady()).toBe(true);
    expect(await pc.sync.applyUpdate()).toBe(true);
    expect(await titlesIn(pcLibrary.applied!)).toEqual(['do PC', 'do celular']);
    expect([pcLibrary.applied![18], pcLibrary.applied![19]]).toEqual([2, 2]);
    expect(pc.sync.updateReady()).toBe(false);

    use(phone);
    await phone.sync.refresh();
    expect(phone.sync.updateReady()).toBe(true);
    expect(phone.sync.backupRequested()).toBe(false);
  });

  it('"Mesclar agora" does not wait, and the device left out must send before updating', async () => {
    const { phone, pc } = await phoneAndComputer();
    use(phone);
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'));

    expect(await phone.sync.sync()).not.toBeNull();
    expect(await syncedTitles()).toEqual(['do celular']);

    // Restoring that file would erase the computer's notes, so it is asked for a backup instead.
    use(pc);
    await pc.sync.refresh();
    expect(pc.sync.updateReady()).toBe(false);
    expect(pc.sync.backupRequested()).toBe(true);
  });

  it('refuses to overwrite a computer whose JW Library changed after it sent its backup', async () => {
    const { phone, pc, pcLibrary } = await phoneAndComputer();
    use(phone);
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'));
    use(pc);
    await pc.sync.sendBackup();

    pcLibrary.database = await database('2026-11-03T09:00:00Z', 'do PC', 'escrita depois');
    expect(await pc.sync.applyUpdate()).toBe(false);
    expect(pc.sync.error()).toMatch(/alterações feitas depois do último envio/);
    expect(pcLibrary.applied).toBeUndefined();
  });

  it('offers the update to an unchanged computer left out of a round, without asking it for a backup', async () => {
    const { phone, pc } = await phoneAndComputer();
    // Round 1: everyone sends, the computer applies.
    use(phone);
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'));
    use(pc);
    await pc.sync.sendBackup();
    await pc.sync.applyUpdate();

    // Round 2: only the phone, merged right away.
    use(phone);
    await phone.sync.refresh();
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T10:00:00Z', 'do celular', 'mais uma'));
    await phone.sync.sync();

    use(pc);
    await pc.sync.refresh();
    expect(pc.sync.backupRequested()).toBe(false);
    expect(pc.sync.updateReady()).toBe(true);
  });

  it('refreshing an old backup before an update merges it at once, without opening a round', async () => {
    const { phone, pc, pcLibrary } = await phoneAndComputer();
    use(phone);
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'));
    use(pc);
    await pc.sync.sendBackup();

    // Notes written since the computer's backup go in first, then the update can follow.
    pcLibrary.database = await database('2026-11-03T09:00:00Z', 'do PC', 'escrita depois');
    expect(await pc.sync.sendBackup(true)).not.toBeNull();
    expect(await syncedTitles()).toEqual(['do PC', 'do celular', 'escrita depois']);
    expect(pc.sync.waitingFor()).toEqual([]);
    expect(notifier.sent.at(-1)).toEqual(expect.objectContaining({ event: 'sync-ready', from: 'pc' }));
    expect(pc.sync.updateReady()).toBe(true);
  });

  it('walks the single Sincronizar button through the round on each device', async () => {
    const { phone, pc } = await phoneAndComputer();
    const browser = device('browser', 'Navegador', 'web');
    await browser.sync.refresh();
    expect(browser.sync.nextStep()).toBe('done');

    use(phone);
    expect(phone.sync.nextStep()).toBe('send');
    await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular'));
    expect(phone.sync.nextStep()).toBe('wait');

    use(browser);
    await browser.sync.refresh();
    expect(browser.sync.nextStep()).toBe('wait');

    use(pc);
    await pc.sync.refresh();
    expect(pc.sync.nextStep()).toBe('send');
    await pc.sync.sendBackup();
    expect(pc.sync.nextStep()).toBe('update');
    await pc.sync.applyUpdate();
    expect(pc.sync.nextStep()).toBe('send'); // nothing pending: the computer can always offer its data
    expect(await pc.sync.localUnchanged()).toBe(true); // …and the button knows there is nothing new

    use(phone);
    await phone.sync.refresh();
    expect(phone.sync.nextStep()).toBe('update');
  });

  it('stops waiting for a removed device', async () => {
    const { phone } = await phoneAndComputer();
    use(phone);
    await phone.sync.removeDevice('pc');

    expect(
      await phone.sync.syncReceived('xiaomi.jwlibrary', await phoneBackup('Xiaomi', '2026-11-03T08:00:00Z', 'do celular')),
    ).not.toBeNull();
    expect(drive.namesIn('jw-notes', 'config', 'aparelhos')).toEqual(['xiaomi.json']);
  });
});
