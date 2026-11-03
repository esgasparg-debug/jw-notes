import { Signal } from '@angular/core';
import { Bytes } from '../storage.models';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  /** Private key/value tags only this app sees (e.g. which device uploaded a backup). */
  appProperties?: Record<string, string>;
}

export interface DriveFileMeta {
  name: string;
  mimeType: string;
  appProperties?: Record<string, string>;
}

/**
 * The slice of Google Drive v3 the app uses. Kept abstract so the file browser and the sync
 * feature share one authenticated client, and so tests can swap in an in-memory drive.
 */
export abstract class DriveApi {
  abstract readonly available: boolean;
  abstract readonly unavailableReason: string;
  abstract readonly signedIn: Signal<boolean>;

  /** Interactive sign-in (opens Google's popup); must run from a user gesture. */
  abstract signIn(): Promise<void>;
  abstract signOut(): Promise<void>;
  /** Reuses a still-valid session from an earlier visit, without any UI. Returns whether it worked. */
  abstract restoreSession(): boolean;

  /** Non-trashed items directly inside a folder, folders first. */
  abstract listChildren(folderId: string): Promise<DriveFile[]>;
  /** First non-trashed child with exactly this name (oldest wins if there are duplicates). */
  abstract findChild(folderId: string, name: string, kind: 'file' | 'folder'): Promise<DriveFile | undefined>;
  /** Files anywhere in the drive whose name contains `text`, newest first. */
  abstract search(text: string): Promise<DriveFile[]>;

  abstract download(fileId: string): Promise<Bytes>;
  abstract create(folderId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile>;
  /** Replaces content and name in place, keeping the file id (Drive keeps the old revision). */
  abstract update(fileId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile>;
  abstract createFolder(parentId: string, name: string): Promise<DriveFile>;
  abstract move(fileId: string, fromFolderId: string, toFolderId: string): Promise<DriveFile>;
  /** Moves a file to the trash (recoverable from Drive for 30 days). */
  abstract trash(fileId: string): Promise<void>;
  /** Short-lived OAuth token, for the notification relay that reads the device list on the user's behalf. */
  abstract accessToken(): Promise<string>;
}
