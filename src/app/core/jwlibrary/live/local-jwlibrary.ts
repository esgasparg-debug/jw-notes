import { Injectable } from '@angular/core';

/** JW Library's own database files, read straight from where the app keeps them. */
export interface LiveDatabase {
  /** userData.db as it is on disk (may still be in WAL mode). */
  database: Uint8Array;
  /** userData.db-wal, when JW Library has changes not yet checkpointed into the main file. */
  wal?: Uint8Array;
  /** Name written to the backup's manifest, e.g. the computer's name. */
  deviceName: string;
}

/**
 * Access to the JW Library installed on this device, to back it up and update it without its
 * "Criar backup" / "Restaurar backup" buttons. Only the desktop shell can do it: on Windows the
 * database sits in the user's AppData. On Android and iOS it lives in JW Library's private
 * storage, which no other app can read, so there this reports nothing installed.
 */
@Injectable({ providedIn: 'root', useFactory: () => desktopBridge() ?? new UnavailableJwLibrary() })
export abstract class LocalJwLibrary {
  /** Path of the database, or null when JW Library cannot be reached from here. */
  abstract locate(): Promise<string | null>;
  abstract read(): Promise<LiveDatabase>;
  /** Replaces JW Library's database (WAL flag set). Fails while JW Library is open. */
  abstract apply(database: Uint8Array): Promise<void>;
  /** Opens a .jwlibrary with JW Library, whose own restore also brings the media files. */
  abstract openBackup(bytes: Uint8Array, name: string): Promise<void>;
}

class UnavailableJwLibrary extends LocalJwLibrary {
  async locate(): Promise<string | null> {
    return null;
  }
  async read(): Promise<LiveDatabase> {
    throw new Error('O JW Library deste aparelho não pode ser lido por outro app.');
  }
  async apply(): Promise<void> {
    throw new Error('O JW Library deste aparelho não pode ser alterado por outro app.');
  }
  async openBackup(): Promise<void> {
    throw new Error('O JW Library deste aparelho não pode ser alterado por outro app.');
  }
}

/** Exposed by desktop/preload.cjs. */
interface DesktopJwLibraryBridge {
  locate(): Promise<string | null>;
  read(): Promise<LiveDatabase>;
  apply(database: Uint8Array): Promise<unknown>;
  openBackup(bytes: Uint8Array, name: string): Promise<void>;
}

class DesktopJwLibrary extends LocalJwLibrary {
  constructor(private readonly bridge: DesktopJwLibraryBridge) {
    super();
  }
  locate(): Promise<string | null> {
    return this.bridge.locate();
  }
  read(): Promise<LiveDatabase> {
    return this.bridge.read();
  }
  async apply(database: Uint8Array): Promise<void> {
    await this.bridge.apply(database);
  }
  openBackup(bytes: Uint8Array, name: string): Promise<void> {
    return this.bridge.openBackup(bytes, name);
  }
}

function desktopBridge(): LocalJwLibrary | null {
  const bridge = (window as unknown as { jwNotesDesktop?: { jwLibrary?: DesktopJwLibraryBridge } }).jwNotesDesktop?.jwLibrary;
  return bridge ? new DesktopJwLibrary(bridge) : null;
}

/** JW Library's naming: "UserdataBackup_2026-10-29_Samsung_SM-X216B.jwlibrary" (local date). */
export function backupFileName(date: Date, deviceName: string): string {
  return `UserdataBackup_${localDate(date)}_${safeDeviceName(deviceName)}.jwlibrary`;
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Spaces and characters that are not allowed in file names become "_", as JW Library does with "Samsung SM-X216B". */
export function safeDeviceName(name: string): string {
  return name.trim().replace(/[\s\\/:*?"<>|]+/g, '_') || 'Computador';
}
