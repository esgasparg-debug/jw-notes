import { MergeReport } from '../jwlibrary/merge/merge.models';
import { DeviceStatus } from './devices';
import { FileRef, FolderRef } from '../storage/storage.models';

/** Folder names of the app's area in "Meu Drive". */
export const SYNC_FOLDER_NAMES = {
  root: 'jw-notes',
  backups: 'backups',
  pending: 'pendente',
  done: 'sincronizados',
  sync: 'sync',
  config: 'config',
  devices: 'aparelhos',
} as const;

export const SETTINGS_FILE = 'settings.json';

export interface SyncFolders {
  /** "Meu Drive" itself. */
  drive: FolderRef;
  root: FolderRef;
  backups: FolderRef;
  pending: FolderRef;
  done: FolderRef;
  sync: FolderRef;
  config: FolderRef;
  /** config/aparelhos: one JSON file per device taking part in sync rounds. */
  devices: FolderRef;
}

/** A folder plus the chain of folders leading to it from "Meu Drive" (for breadcrumbs). */
export interface FolderPath {
  folder: FolderRef;
  path: FolderRef[];
}

/** Shared by every device: stored in jw-notes/config/settings.json and loaded when the app opens. */
export interface SyncSettings {
  version: 1;
  /** Where the phones save their backups; null means jw-notes/backups/pendente. */
  inbox: FolderPath | null;
  updatedAt: string;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { version: 1, inbox: null, updatedAt: '' };

/** Current state of the user's sync area. */
export interface SyncOverview {
  folders: SyncFolders;
  settings: SyncSettings;
  inbox: FolderPath;
  /** Backups waiting to be merged, oldest first. */
  pending: FileRef[];
  /** The merged file in jw-notes/sync, if a sync already happened. */
  current: FileRef | null;
  /**
   * Registered devices and whether each already sent its backup in the current round. A round
   * is open while the inbox has backups; it closes with the merge.
   */
  devices: DeviceStatus[];
}

export interface SyncOutcome {
  file: FileRef;
  processed: FileRef[];
  skipped: { ref: FileRef; error: string }[];
  report: MergeReport;
  finishedAt: string;
}

export type SyncPhase = 'idle' | 'connecting' | 'loading' | 'syncing' | 'applying' | 'error';
