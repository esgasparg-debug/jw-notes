import { Bytes, FileRef } from '../storage/storage.models';
import { JwArchive, isoNow, writeArchive } from './archive/jwlibrary-archive';
import { UserData } from './repositories/user-data';

/** An open `.jwlibrary` backup: the zip contents, a live database and where it came from. */
export class JwDocument {
  readonly userData: UserData;

  constructor(
    private readonly archive: JwArchive,
    userData: UserData,
    public source: FileRef | null,
  ) {
    this.userData = userData;
  }

  get manifest() {
    return this.archive.manifest;
  }

  get name(): string {
    return this.source?.name ?? this.archive.manifest.name;
  }

  get deviceName(): string {
    return this.archive.manifest.userDataBackup?.deviceName ?? '';
  }

  attachment(path: string): Uint8Array | undefined {
    return this.archive.attachments.get(path);
  }

  /** Adds media files (e.g. merged playlist items) that must travel inside the backup. */
  addAttachments(files: Map<string, Uint8Array>): void {
    for (const [path, data] of files) if (!this.archive.attachments.has(path)) this.archive.attachments.set(path, data);
  }

  /** Serialises the current database state into a new `.jwlibrary` file. */
  async toBytes(fileName: string): Promise<Bytes> {
    const ts = isoNow();
    this.userData.touch(ts);
    return writeArchive({ ...this.archive, database: this.userData.db.export() }, { fileName, modifiedAt: ts });
  }

  close(): void {
    this.userData.db.close();
  }
}

/** "Backup_X.jwlibrary" → "Backup_X_<suffix>.jwlibrary", without stacking suffixes on repeated saves. */
export function deriveFileName(name: string, suffix: string): string {
  const base = name.replace(/\.jwlibrary$/i, '').replace(/_(editado|mesclado)(_\d+)?$/i, '');
  return `${base}_${suffix}.jwlibrary`;
}
