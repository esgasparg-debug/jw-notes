export type StorageProviderId = 'local' | 'google-drive' | 'onedrive';

/** File contents. Backed by a plain ArrayBuffer, as Blob/crypto/file-system APIs require. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Reference to a file stored by a provider. Enough information to read it again and to save next to it. */
export interface FileRef {
  providerId: StorageProviderId;
  /** Provider-specific id (Drive file id, Graph item id, or a local handle key). */
  id: string;
  name: string;
  /** Folder that contains the file — used to save new files "in the same place". */
  parentId?: string;
  parentName?: string;
  modifiedAt?: string;
  size?: number;
}

export interface FolderRef {
  id: string;
  name: string;
}

export interface BrowserEntry {
  kind: 'file' | 'folder';
  ref: FileRef | FolderRef;
}

export interface LoadedFile {
  ref: FileRef;
  bytes: Bytes;
}

export interface SaveTarget {
  name: string;
  /** Folder to save into. When omitted, the provider asks the user or uses its root. */
  folder?: FolderRef;
  /** When set, overwrite this existing file instead of creating a new one. */
  overwrite?: FileRef;
}
