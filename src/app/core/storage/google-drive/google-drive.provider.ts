import { Injectable, inject } from '@angular/core';
import { JWLIBRARY_MIME, StorageProvider, isJwLibraryName } from '../storage-provider';
import { BrowserEntry, Bytes, FileRef, FolderRef, LoadedFile, SaveTarget } from '../storage.models';
import { DriveApi, DriveFile, FOLDER_MIME } from './drive-api';

/** Google Drive as an open/save location for the file dialogs. */
@Injectable({ providedIn: 'root' })
export class GoogleDriveProvider implements StorageProvider {
  readonly id = 'google-drive' as const;
  readonly label = 'Google Drive';
  readonly icon = 'add_to_drive';
  readonly browsable = true;

  private readonly api = inject(DriveApi);
  readonly available = this.api.available;
  readonly unavailableReason = this.api.unavailableReason;
  readonly signedIn = this.api.signedIn;

  signIn(): Promise<void> {
    return this.api.signIn();
  }

  signOut(): Promise<void> {
    return this.api.signOut();
  }

  root(): FolderRef {
    return { id: 'root', name: 'Meu Drive' };
  }

  async list(folder: FolderRef): Promise<BrowserEntry[]> {
    const files = await this.api.listChildren(folder.id);
    return files
      .filter((f) => f.mimeType === FOLDER_MIME || isJwLibraryName(f.name))
      .map((f) =>
        f.mimeType === FOLDER_MIME
          ? { kind: 'folder' as const, ref: { id: f.id, name: f.name } }
          : { kind: 'file' as const, ref: toFileRef(f, folder) },
      );
  }

  async search(query: string): Promise<FileRef[]> {
    const files = await this.api.search(query || 'jwlibrary');
    return files.filter((f) => isJwLibraryName(f.name)).map((f) => toFileRef(f));
  }

  async read(ref: FileRef): Promise<LoadedFile> {
    return { ref, bytes: await this.api.download(ref.id) };
  }

  async save(bytes: Bytes, target: SaveTarget): Promise<FileRef> {
    const meta = { name: target.name, mimeType: JWLIBRARY_MIME };
    const content = new Blob([bytes], { type: JWLIBRARY_MIME });
    const file = target.overwrite
      ? await this.api.update(target.overwrite.id, meta, content)
      : await this.api.create((target.folder ?? this.root()).id, meta, content);
    return toFileRef(file, target.folder);
  }
}

export function toFileRef(f: DriveFile, folder?: FolderRef): FileRef {
  return {
    providerId: 'google-drive',
    id: f.id,
    name: f.name,
    parentId: folder?.id ?? f.parents?.[0],
    parentName: folder?.name,
    modifiedAt: f.modifiedTime,
    size: f.size ? Number(f.size) : undefined,
  };
}
