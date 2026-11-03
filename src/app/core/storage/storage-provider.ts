import { InjectionToken, Signal } from '@angular/core';
import { BrowserEntry, Bytes, FileRef, FolderRef, LoadedFile, SaveTarget, StorageProviderId } from './storage.models';

/**
 * Contract every storage backend implements. The UI only talks to this interface,
 * so adding a new backend (Dropbox, native file system, …) means adding one class
 * and registering it in `STORAGE_PROVIDERS`.
 */
export interface StorageProvider {
  readonly id: StorageProviderId;
  readonly label: string;
  /** Material Symbols icon name. */
  readonly icon: string;

  /** False when the provider is missing configuration (e.g. no OAuth client id). */
  readonly available: boolean;
  readonly unavailableReason?: string;

  /**
   * Cloud providers expose a folder browser; the local provider delegates to the
   * operating system's own file dialogs instead.
   */
  readonly browsable: boolean;

  readonly signedIn: Signal<boolean>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;

  /** Root folder of the provider's tree (only for browsable providers). */
  root(): FolderRef;
  list(folder: FolderRef): Promise<BrowserEntry[]>;
  /** Searches the whole storage for `.jwlibrary` files whose name contains `query`. */
  search(query: string): Promise<FileRef[]>;

  /** Non-browsable providers open their own picker here and may return null when cancelled. */
  pick?(): Promise<LoadedFile | null>;

  read(ref: FileRef): Promise<LoadedFile>;
  save(bytes: Bytes, target: SaveTarget): Promise<FileRef>;
}

export const STORAGE_PROVIDERS = new InjectionToken<StorageProvider[]>('STORAGE_PROVIDERS');

export const JWLIBRARY_MIME = 'application/octet-stream';
export const JWLIBRARY_EXT = '.jwlibrary';

export function isJwLibraryName(name: string): boolean {
  return name.toLowerCase().endsWith(JWLIBRARY_EXT);
}
