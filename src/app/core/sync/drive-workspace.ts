import { Injectable, inject } from '@angular/core';
import { DriveApi, DriveFile, FOLDER_MIME } from '../storage/google-drive/drive-api';
import { DeviceInfo } from './devices';
import { isJwLibraryName } from '../storage/storage-provider';
import { FolderRef } from '../storage/storage.models';
import { DEFAULT_SYNC_SETTINGS, SETTINGS_FILE, SYNC_FOLDER_NAMES as NAMES, SyncFolders, SyncSettings } from './sync.models';

const SETTINGS_MIME = 'application/json';

/**
 * The app's area in the user's Google Drive:
 *
 *   Meu Drive/jw-notes/
 *     backups/pendente/       ← phones save their backups here
 *     backups/sincronizados/  ← backups already merged
 *     sync/                   ← the single merged file to restore on every phone
 *     config/settings.json    ← settings shared by all devices
 *     config/aparelhos/       ← one <id>.json per device taking part in sync rounds
 *
 * Folders are created on first use, so the user never has to set anything up.
 */
@Injectable({ providedIn: 'root' })
export class DriveWorkspace {
  private readonly api = inject(DriveApi);
  private folders?: Promise<SyncFolders>;

  /** Finds (or creates) the folder tree. Cached for the session. */
  ensureFolders(): Promise<SyncFolders> {
    this.folders ??= this.resolveTree().catch((e) => {
      this.folders = undefined;
      throw e;
    });
    return this.folders;
  }

  /** Forgets cached folder ids (e.g. after switching Google accounts). */
  reset(): void {
    this.folders = undefined;
  }

  async readSettings(folders: SyncFolders): Promise<SyncSettings> {
    const file = await this.api.findChild(folders.config.id, SETTINGS_FILE, 'file');
    if (!file) return DEFAULT_SYNC_SETTINGS;
    try {
      const saved = JSON.parse(new TextDecoder().decode(await this.api.download(file.id))) as Partial<SyncSettings>;
      return { ...DEFAULT_SYNC_SETTINGS, ...saved, version: 1 };
    } catch {
      // A hand-edited or corrupted file must not block syncing; it is rewritten on the next save.
      return DEFAULT_SYNC_SETTINGS;
    }
  }

  async writeSettings(folders: SyncFolders, settings: SyncSettings): Promise<void> {
    const content = new Blob([JSON.stringify(settings, null, 2)], { type: SETTINGS_MIME });
    const meta = { name: SETTINGS_FILE, mimeType: SETTINGS_MIME };
    const existing = await this.api.findChild(folders.config.id, SETTINGS_FILE, 'file');
    if (existing) await this.api.update(existing.id, meta, content);
    else await this.api.create(folders.config.id, meta, content);
  }

  /** Devices taking part in sync rounds. Unreadable entries are skipped. */
  async listDevices(folders: SyncFolders): Promise<DeviceInfo[]> {
    const files = (await this.api.listChildren(folders.devices.id)).filter((f) => f.name.endsWith('.json'));
    const devices = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(new TextDecoder().decode(await this.api.download(f.id))) as DeviceInfo;
        } catch {
          return null;
        }
      }),
    );
    return devices.filter((d): d is DeviceInfo => !!d?.id).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveDevice(folders: SyncFolders, device: DeviceInfo): Promise<void> {
    const content = new Blob([JSON.stringify(device, null, 2)], { type: SETTINGS_MIME });
    const meta = { name: deviceFileName(device.id), mimeType: SETTINGS_MIME };
    const existing = await this.api.findChild(folders.devices.id, meta.name, 'file');
    if (existing) await this.api.update(existing.id, meta, content);
    else await this.api.create(folders.devices.id, meta, content);
  }

  async removeDevice(folders: SyncFolders, id: string): Promise<void> {
    const existing = await this.api.findChild(folders.devices.id, deviceFileName(id), 'file');
    if (existing) await this.api.trash(existing.id);
  }

  /** `.jwlibrary` files directly inside a folder, oldest first. */
  async listBackups(folderId: string): Promise<DriveFile[]> {
    const items = await this.api.listChildren(folderId);
    return items
      .filter((f) => f.mimeType !== FOLDER_MIME && isJwLibraryName(f.name))
      .sort((a, b) => (a.modifiedTime ?? '').localeCompare(b.modifiedTime ?? ''));
  }

  private async resolveTree(): Promise<SyncFolders> {
    const drive: FolderRef = { id: 'root', name: 'Meu Drive' };
    const root = await this.folder(drive.id, NAMES.root);
    const [backups, sync, config] = await Promise.all([
      this.folder(root.id, NAMES.backups),
      this.folder(root.id, NAMES.sync),
      this.folder(root.id, NAMES.config),
    ]);
    const [pending, done, devices] = await Promise.all([
      this.folder(backups.id, NAMES.pending),
      this.folder(backups.id, NAMES.done),
      this.folder(config.id, NAMES.devices),
    ]);
    return { drive, root, backups, pending, done, sync, config, devices };
  }

  private async folder(parentId: string, name: string): Promise<FolderRef> {
    const f = (await this.api.findChild(parentId, name, 'folder')) ?? (await this.api.createFolder(parentId, name));
    return { id: f.id, name: f.name };
  }
}

function deviceFileName(id: string): string {
  return `${id}.json`;
}
