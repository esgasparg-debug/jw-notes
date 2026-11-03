import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { readPreference, writePreference } from '../../shared/utils/preferences';
import { DEFAULT_THUMBNAIL_NAME } from '../jwlibrary/archive/default-thumbnail';
import { isoNow, readArchive } from '../jwlibrary/archive/jwlibrary-archive';
import { toWalMode } from '../jwlibrary/archive/sqlite-wal';
import { JwLibraryService } from '../jwlibrary/jwlibrary.service';
import { LocalJwLibrary, backupFileName } from '../jwlibrary/live/local-jwlibrary';
import { DriveApi } from '../storage/google-drive/drive-api';
import { toFileRef } from '../storage/google-drive/google-drive.provider';
import { writeToCache } from '../storage/local/native-file-saver';
import { JWLIBRARY_MIME, isJwLibraryName } from '../storage/storage-provider';
import { Bytes, FileRef, FolderRef, LoadedFile } from '../storage/storage.models';
import { errorMessage } from '../ui/notification.service';
import { DEVICE_PROPERTY, DeviceIdentity, DeviceInfo, DeviceStatus } from './devices';
import { DriveWorkspace } from './drive-workspace';
import { SyncEvent, SyncNotifier } from './sync-notifier';
import { FolderPath, SyncFolders, SyncOutcome, SyncOverview, SyncPhase, SyncSettings } from './sync.models';

/** LastModified of the last backup uploaded from this computer's JW Library. */
const LAST_LOCAL_BACKUP_KEY = 'sync.lastLocalBackup';
/** Drive time of this device's last upload to the inbox. */
const LAST_UPLOAD_KEY = 'sync.lastUpload';
/** Drive time of the sync file this device last applied to its JW Library. */
const APPLIED_KEY = 'sync.applied';

/** When a device's upload should trigger the merge. */
type MergeWhen = 'always' | 'everyone-sent';

/**
 * What the single "Sincronizar" button does next on this device:
 * connect → (send this device's backup → wait for the others) → update its JW Library.
 * `merge` is for devices without JW Library that see backups nobody claims; `done` means nothing to do.
 */
export type SyncStep = 'connect' | 'check' | 'update' | 'send' | 'wait' | 'merge' | 'done';

/**
 * Sync between devices through Google Drive, in rounds.
 *
 * Devices with JW Library (Android, or a computer with JW Library for Windows) register in
 * jw-notes/config/aparelhos. When one of them sends its backup to the inbox
 * (jw-notes/backups/pendente), the others get a push notification asking for theirs. Once every
 * registered device has sent one, or someone presses "Mesclar agora", the current file in
 * jw-notes/sync and all pending backups are merged into that same file (so there is only ever
 * one), the backups move to jw-notes/backups/sincronizados and every device is told to update
 * its JW Library: computers get their database replaced, Android hands the file to JW Library's
 * restore (its database is private to it).
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(DriveApi);
  private readonly workspace = inject(DriveWorkspace);
  private readonly jw = inject(JwLibraryService);
  private readonly local = inject(LocalJwLibrary);
  private readonly identity = inject(DeviceIdentity);
  private readonly notifier = inject(SyncNotifier);

  readonly available = this.api.available;
  readonly unavailableReason = this.api.unavailableReason;
  readonly connected = this.api.signedIn;
  readonly notificationsEnabled = this.notifier.enabled;

  private readonly _phase = signal<SyncPhase>('idle');
  private readonly _message = signal('');
  private readonly _error = signal<string | null>(null);
  private readonly _overview = signal<SyncOverview | null>(null);
  private readonly _outcome = signal<SyncOutcome | null>(null);
  private readonly _localLibrary = signal<string | null>(null);
  private readonly _lastUpload = signal(readPreference<string>(LAST_UPLOAD_KEY));
  private readonly _applied = signal(readPreference<string>(APPLIED_KEY));
  /** When this device last sent its backup (Drive time of the upload). */
  readonly lastUpload = this._lastUpload.asReadonly();
  /** Android: the backup the robot is making merges at once instead of waiting for the others. */
  private mergeOnReceive = false;
  /** The task `run()` is executing, so callers that cannot be dropped (shared files) can wait for it. */
  private running: Promise<unknown> = Promise.resolve();

  readonly phase = this._phase.asReadonly();
  readonly message = this._message.asReadonly();
  readonly error = this._error.asReadonly();
  readonly overview = this._overview.asReadonly();
  readonly outcome = this._outcome.asReadonly();

  readonly busy = computed(() => ['connecting', 'loading', 'syncing', 'applying'].includes(this._phase()));
  readonly settings = computed(() => this._overview()?.settings ?? null);
  /** Breadcrumb to the inbox, so the "open" dialog starts there. */
  readonly inboxPath = computed(() => this._overview()?.inbox.path ?? null);

  /** Path of JW Library's database on this computer. When set, every sync backs it up first. */
  readonly localLibrary = this._localLibrary.asReadonly();
  /** This device has a JW Library whose data the app can send and update. */
  readonly takesPart = computed(() => this.identity.platform === 'android' || !!this._localLibrary());

  readonly devices = computed(() => this._overview()?.devices ?? []);
  private readonly me = computed(() => this.devices().find((d) => d.me) ?? null);
  /** Registered devices that still have to send their backup in the open round. */
  readonly waitingFor = computed(() => (this._overview()?.pending.length ? this.devices().filter((d) => !d.upload) : []));

  /** The newest sync file was merged with this device's latest backup and is not on its JW Library yet. */
  readonly updateReady = computed(() => {
    const current = this._overview()?.current?.modifiedAt;
    const uploaded = this._lastUpload();
    const applied = this._applied();
    if (!current || !this.takesPart() || this.me()?.upload || !uploaded) return false;
    // "uploaded >= applied": this device's data was sent (or known unchanged) since its last update.
    return uploaded <= current && (!applied || (uploaded >= applied && applied < current));
  });

  /**
   * This device should send its backup: someone else opened a round, or a newer sync file exists
   * without this device's latest data (restoring it would lose that data).
   */
  readonly backupRequested = computed(() => {
    if (!this.takesPart() || this.me()?.upload || this.updateReady()) return false;
    const ov = this._overview();
    if (!ov) return false;
    const othersSent = ov.devices.some((d) => !d.me && d.upload);
    const applied = this._applied();
    return othersSent || (!!ov.current?.modifiedAt && (!applied || applied < ov.current.modifiedAt));
  });

  readonly nextStep = computed<SyncStep>(() => {
    const ov = this._overview();
    if (!this.connected()) return 'connect';
    if (!ov) return 'check';
    if (this.updateReady()) return 'update';
    // Devices with JW Library always have something to offer: their own data (desktop checks if it changed).
    if (this.takesPart() && !this.me()?.upload) return 'send';
    if (this.waitingFor().length) return 'wait';
    return ov.pending.length ? 'merge' : 'done';
  });

  /** On app start: reuse a session from an earlier visit (no popup) and load the shared settings. */
  async restore(): Promise<void> {
    this._localLibrary.set(await this.local.locate().catch(() => null));
    if (this.api.restoreSession()) await this.refresh();
  }

  /** Signs in to Google (popup) and prepares the jw-notes folders. Call from a click. */
  async connect(): Promise<void> {
    await this.run('connecting', 'Conectando ao Google Drive…', () => this.api.signIn());
    if (this.connected()) await this.refresh();
  }

  async disconnect(): Promise<void> {
    await this.api.signOut();
    this.workspace.reset();
    this._overview.set(null);
    this._outcome.set(null);
    this._phase.set('idle');
  }

  /**
   * Reloads settings, devices, the pending list and the current sync file. `quiet` (background
   * checks) skips the progress indicator and ignores errors.
   */
  async refresh(quiet = false): Promise<void> {
    const load = async () => {
      const folders = await this.workspace.ensureFolders();
      await this.show(await this.describe(folders, await this.workspace.readSettings(folders)));
    };
    if (!quiet) return void (await this.run('loading', 'Verificando o Google Drive…', load));
    if (this.busy() || !this.connected()) return;
    await load().catch(() => undefined);
  }

  /**
   * "Mesclar agora": merges every pending backup into the sync file without waiting for the
   * devices that did not answer. On a computer with JW Library, its database goes in first.
   * Returns null when there was nothing to do.
   */
  async sync(): Promise<SyncOutcome | null> {
    if (this.busy()) return null;
    return this.syncWith('always', async (overview) => {
      if (this._localLibrary()) await this.uploadLocalBackup(overview, false);
    });
  }

  /**
   * Sends this device's backup for the current round. Desktop reads JW Library itself. Android
   * cannot: the robot (JwLibraryRobot) taps Fazer backup › Sincronizar backup in JW Library, or,
   * when it is off, JW Library just opens for the user to do it. Either way the file comes back
   * through syncReceived(). `mergeNow` merges it right away instead of waiting for the other
   * devices: used to refresh an old backup just before updating JW Library.
   */
  async sendBackup(mergeNow = false): Promise<SyncOutcome | null> {
    if (this.busy()) return null;
    if (this.identity.platform === 'android') {
      this.mergeOnReceive = mergeNow;
      await this.run('loading', 'Fazendo o backup no JW Library…', async () => {
        const { JwLibraryApp } = await import('../platform/android-plugins');
        if ((await JwLibraryApp.robotStatus()).running) await JwLibraryApp.backupAutomatically();
        else await JwLibraryApp.open();
      });
      return null;
    }
    return this.syncWith(mergeNow ? 'always' : 'everyone-sent', (overview) => this.uploadLocalBackup(overview, true));
  }

  /** A backup handed over by JW Library (Android "Compartilhar"): sent to the inbox for this round. */
  async syncReceived(name: string, bytes: Bytes): Promise<SyncOutcome | null> {
    await this.running.catch(() => undefined);
    const fileName = isJwLibraryName(name) ? name : backupFileName(new Date(), await this.identity.deviceName());
    const when: MergeWhen = this.mergeOnReceive ? 'always' : 'everyone-sent';
    this.mergeOnReceive = false;
    return this.syncWith(when, async (overview) => {
      // Anything shared to the app lands here; only real backups may reach the inbox.
      await readArchive(bytes);
      this._message.set(`Enviando ${fileName}…`);
      await this.uploadToInbox(overview.inbox.folder, fileName, bytes);
    });
  }

  /**
   * Puts the sync file on this device's JW Library. Computer: replaces its database (JW Library
   * must be closed). Android: hands the file to JW Library, which asks to restore it.
   */
  async applyUpdate(): Promise<boolean> {
    if (this.busy()) return false;
    const done = await this.run('applying', 'Baixando a atualização…', async () => {
      const current = this._overview()?.current;
      if (!current) throw new Error('Ainda não há arquivo sincronizado.');
      const bytes = await this.api.download(current.id);
      if (this.identity.platform === 'android') {
        const { JwLibraryApp } = await import('../platform/android-plugins');
        await JwLibraryApp.restore({ uri: await writeToCache(bytes, current.name) });
      } else {
        await this.applyOnThisComputer(bytes, current.name);
      }
      this.remember(APPLIED_KEY, this._applied, current.modifiedAt ?? isoNow());
      return true;
    });
    return !!done;
  }

  /**
   * Computer: JW Library has not changed since its data last went to (or came from) the sync file,
   * so there is nothing of its own to send.
   */
  async localUnchanged(): Promise<boolean> {
    if (!this._localLibrary() || !this._overview()?.current) return false;
    const live = await this.jw.createBackup(await this.local.read()).catch(() => null);
    return !!live && live.lastModified === readPreference<string>(LAST_LOCAL_BACKUP_KEY);
  }

  /** Called when Firebase hands this device a (new) push token. */
  async setPushToken(token: string): Promise<void> {
    if (token === this.identity.pushToken()) return;
    this.identity.setPushToken(token);
    await this.refresh(true);
  }

  /** Stops waiting for a device (sold, reset, uninstalled…). It registers again if it syncs later. */
  async removeDevice(id: string): Promise<void> {
    await this.run('loading', 'Removendo o aparelho…', async () => {
      const folders = await this.workspace.ensureFolders();
      await this.workspace.removeDevice(folders, id);
      this._overview.set(await this.describe(folders, await this.workspace.readSettings(folders)));
    });
  }

  /** Changes where the phones drop their backups (null = default folder). Shared with all devices. */
  async setInbox(inbox: FolderPath | null): Promise<void> {
    await this.run('loading', 'Salvando configurações…', async () => {
      const folders = await this.workspace.ensureFolders();
      const current = await this.workspace.readSettings(folders);
      const settings: SyncSettings = { ...current, inbox, updatedAt: isoNow() };
      await this.workspace.writeSettings(folders, settings);
      this._overview.set(await this.describe(folders, settings));
    });
  }

  /** Downloads the current sync file, e.g. to review it in the editor. */
  async loadCurrent(): Promise<LoadedFile | null> {
    const current = this._overview()?.current;
    return current ? { ref: current, bytes: await this.api.download(current.id) } : null;
  }

  isSyncFile(ref: FileRef | null | undefined): boolean {
    return !!ref && ref.providerId === 'google-drive' && ref.id === this._overview()?.current?.id;
  }

  /**
   * Runs `before` (usually an upload), then merges: always, or only once every registered
   * device has sent its backup. While some are missing, they are notified instead.
   */
  private async syncWith(when: MergeWhen, before: (overview: SyncOverview) => Promise<void>): Promise<SyncOutcome | null> {
    if (!this.connected()) {
      await this.connect();
      if (!this.connected()) return null;
    }
    this._outcome.set(null);
    return (
      (await this.run('syncing', 'Procurando backups novos…', async () => {
        const folders = await this.workspace.ensureFolders();
        const settings = await this.workspace.readSettings(folders);
        const uploadsBefore = this._lastUpload();
        await before(await this.describe(folders, settings));
        const overview = await this.describe(folders, settings);
        this._overview.set(overview);
        if (!overview.pending.length) return null;

        const waiting = overview.devices.filter((d) => !d.upload);
        if (when === 'everyone-sent' && waiting.length) {
          if (this._lastUpload() !== uploadsBefore) await this.notify('backup-requested', overview, waiting);
          return null;
        }

        const outcome = await this.mergeAndSave(folders, overview);
        this._outcome.set(outcome);
        const after = await this.describe(folders, settings);
        await this.show(after);
        await this.notify('sync-ready', after, after.devices);
        return outcome;
      })) ?? null
    );
  }

  private async notify(event: SyncEvent, overview: SyncOverview, targets: DeviceStatus[]): Promise<void> {
    await this.notifier.notify({
      event,
      from: this.identity.id,
      targets: targets.filter((t) => !t.me).map((t) => t.device.id),
      devicesFolderId: overview.folders.devices.id,
    });
  }

  /**
   * Backs up this computer's JW Library into the inbox, the same file its "Criar backup" makes.
   * Unless `force`, skipped when the database has not changed since an upload that was already merged.
   */
  private async uploadLocalBackup(overview: SyncOverview, force: boolean): Promise<void> {
    this._message.set('Lendo o JW Library deste computador…');
    const backup = await this.jw.createBackup(await this.local.read());
    if (!force && overview.current && readPreference<string>(LAST_LOCAL_BACKUP_KEY) === backup.lastModified) {
      this.markIncluded(overview);
      return;
    }
    this._message.set('Enviando o backup deste computador…');
    await this.uploadToInbox(overview.inbox.folder, backup.name, backup.bytes);
    writePreference(LAST_LOCAL_BACKUP_KEY, backup.lastModified);
  }

  /** Uploads a backup tagged with this device; a newer one replaces the one still waiting. */
  private async uploadToInbox(inbox: FolderRef, name: string, bytes: Bytes): Promise<void> {
    const content = new Blob([bytes], { type: JWLIBRARY_MIME });
    const meta = { name, mimeType: JWLIBRARY_MIME, appProperties: { [DEVICE_PROPERTY]: this.identity.id } };
    const pending = await this.workspace.listBackups(inbox.id);
    const mine = pending.find((f) => f.appProperties?.[DEVICE_PROPERTY] === this.identity.id) ?? pending.find((f) => f.name === name);
    const saved = mine ? await this.api.update(mine.id, meta, content) : await this.api.create(inbox.id, meta, content);
    this.remember(LAST_UPLOAD_KEY, this._lastUpload, saved.modifiedTime ?? isoNow());
  }

  /**
   * Sets the overview. On a computer, also settles the case where a newer sync file arrived
   * outside a round while JW Library did not change: its data is already in that file, so the
   * update can be offered without asking for another backup (which would wake every phone).
   */
  private async show(overview: SyncOverview): Promise<void> {
    this._overview.set(overview);
    const roundOpen = overview.devices.some((d) => !d.me && d.upload);
    if (!this._localLibrary() || roundOpen || !this.backupRequested()) return;
    const live = await this.jw.createBackup(await this.local.read()).catch(() => null);
    if (live && live.lastModified === readPreference<string>(LAST_LOCAL_BACKUP_KEY)) this.markIncluded(overview);
  }

  /** This computer's data is already in the current sync file (it did not change since it was sent or applied). */
  private markIncluded(overview: SyncOverview): void {
    const current = overview.current?.modifiedAt;
    const last = this._lastUpload();
    if (current && (!last || last < current)) this.remember(LAST_UPLOAD_KEY, this._lastUpload, current);
  }

  private async applyOnThisComputer(bytes: Bytes, name: string): Promise<void> {
    this._message.set('Conferindo o JW Library deste computador…');
    const live = await this.jw.createBackup(await this.local.read());
    if (live.lastModified !== readPreference<string>(LAST_LOCAL_BACKUP_KEY)) {
      throw new Error(
        'O JW Library deste computador tem alterações feitas depois do último envio. Envie o backup deste aparelho antes de atualizar, para não perdê-las.',
      );
    }
    const archive = await readArchive(bytes);
    const hasMedia = [...archive.attachments.keys()].some((path) => path !== DEFAULT_THUMBNAIL_NAME);
    this._message.set('Atualizando o JW Library deste computador…');
    // Playlist media must be copied by JW Library itself, so those backups go through its restore.
    if (hasMedia) await this.local.openBackup(bytes, name);
    else await this.local.apply(toWalMode(archive.database));
    writePreference(LAST_LOCAL_BACKUP_KEY, archive.manifest.userDataBackup.lastModifiedDate);
  }

  private async mergeAndSave(folders: SyncFolders, overview: SyncOverview): Promise<SyncOutcome> {
    const inputs = [...(overview.current ? [overview.current] : []), ...overview.pending];
    this._message.set(`Baixando ${inputs.length} arquivo(s)…`);
    const files = await Promise.all(inputs.map(async (ref) => ({ ref, bytes: await this.api.download(ref.id) })));

    this._message.set('Mesclando…');
    const result = await this.jw.mergeAll(files);
    try {
      const skipped = result.skipped.map((s) => ({ ref: s.file.ref, error: s.error }));
      const skippedIds = new Set(skipped.map((s) => s.ref.id));
      const processed = overview.pending.filter((p) => !skippedIds.has(p.id));
      if (!processed.length) {
        throw new Error(`Nenhum backup pendente pôde ser lido: ${skipped.map((s) => s.ref.name).join(', ')}`);
      }

      this._message.set('Salvando o arquivo sincronizado…');
      const name = syncFileName(new Date());
      const content = new Blob([await result.document.toBytes(name)], { type: JWLIBRARY_MIME });
      const meta = { name, mimeType: JWLIBRARY_MIME };
      // Update in place: jw-notes/sync always holds exactly one file, and Drive keeps the previous revision.
      const saved =
        overview.current && !skippedIds.has(overview.current.id)
          ? await this.api.update(overview.current.id, meta, content)
          : await this.api.create(folders.sync.id, meta, content);

      this._message.set('Organizando as pastas…');
      for (const p of processed) await this.api.move(p.id, overview.inbox.folder.id, folders.done.id);
      for (const extra of await this.workspace.listBackups(folders.sync.id)) {
        if (extra.id !== saved.id) await this.api.move(extra.id, folders.sync.id, folders.done.id);
      }

      return { file: toFileRef(saved, folders.sync), processed, skipped, report: result.report, finishedAt: isoNow() };
    } finally {
      result.document.close();
    }
  }

  private async describe(folders: SyncFolders, settings: SyncSettings): Promise<SyncOverview> {
    const inbox: FolderPath = settings.inbox ?? {
      folder: folders.pending,
      path: [folders.drive, folders.root, folders.backups, folders.pending],
    };
    const [pending, synced, registered] = await Promise.all([
      this.workspace.listBackups(inbox.folder.id),
      this.workspace.listBackups(folders.sync.id),
      this.workspace.listDevices(folders),
    ]);
    const devices = await this.register(folders, registered);
    const current = synced.at(-1);
    return {
      folders,
      settings,
      inbox,
      pending: pending.map((f) => toFileRef(f, inbox.folder)),
      current: current ? toFileRef(current, folders.sync) : null,
      devices: devices.map((device) => {
        const upload = pending.find((f) => f.appProperties?.[DEVICE_PROPERTY] === device.id);
        return { device, upload: upload ? toFileRef(upload, inbox.folder) : null, me: device.id === this.identity.id };
      }),
    };
  }

  /** Adds (or refreshes the name and push token of) this device in jw-notes/config/aparelhos. */
  private async register(folders: SyncFolders, devices: DeviceInfo[]): Promise<DeviceInfo[]> {
    if (!this.takesPart()) return devices;
    const name = await this.identity.deviceName();
    const pushToken = this.identity.pushToken() ?? undefined;
    const existing = devices.find((d) => d.id === this.identity.id);
    if (existing && existing.name === name && existing.pushToken === pushToken) return devices;
    const me: DeviceInfo = {
      version: 1,
      id: this.identity.id,
      name,
      platform: this.identity.platform,
      ...(pushToken ? { pushToken } : {}),
      updatedAt: isoNow(),
    };
    await this.workspace.saveDevice(folders, me);
    return [...devices.filter((d) => d.id !== me.id), me].sort((a, b) => a.name.localeCompare(b.name));
  }

  private remember(key: string, target: WritableSignal<string | null>, value: string): void {
    writePreference(key, value);
    target.set(value);
  }

  private async run<T>(phase: SyncPhase, message: string, task: () => Promise<T>): Promise<T | undefined> {
    this._phase.set(phase);
    this._message.set(message);
    this._error.set(null);
    try {
      const pending = task();
      this.running = pending;
      const result = await pending;
      this._phase.set('idle');
      return result;
    } catch (e) {
      this._phase.set('error');
      this._error.set(errorMessage(e));
      return undefined;
    } finally {
      this._message.set('');
    }
  }
}

/** e.g. "JW-Notes_Sync_2026-10-30_1420.jwlibrary" — the date tells at a glance how fresh it is. */
export function syncFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `JW-Notes_Sync_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.jwlibrary`;
}
