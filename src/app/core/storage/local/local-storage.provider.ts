import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from '../../platform/platform.service';
import { StorageProvider, JWLIBRARY_EXT } from '../storage-provider';
import { BrowserEntry, Bytes, FileRef, FolderRef, LoadedFile, SaveTarget } from '../storage.models';
import { saveWithShareSheet } from './native-file-saver';

/* Minimal typings for the File System Access API (Chromium, Edge, Electron). */
interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource | Blob): Promise<void>; close(): Promise<void> }>;
}
interface FsPickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
  startIn?: FsFileHandle | 'documents' | 'downloads';
  excludeAcceptAllOption?: boolean;
}
interface FsWindow {
  showOpenFilePicker?(o?: FsPickerOptions): Promise<FsFileHandle[]>;
  showSaveFilePicker?(o?: FsPickerOptions): Promise<FsFileHandle>;
}

const PICKER_TYPES = [{ description: 'Backup do JW Library', accept: { 'application/octet-stream': [JWLIBRARY_EXT] } }];

/**
 * Files on this device. Uses the File System Access API when the runtime supports it
 * (desktop Chrome/Edge and Electron), which lets the save dialog open in the same folder
 * as the original file. Elsewhere it falls back to an <input type=file> and a download.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local' as const;
  readonly label = 'Arquivos do dispositivo';
  readonly icon = 'folder_open';
  readonly available = true;
  readonly browsable = false;
  readonly signedIn = signal(true).asReadonly();

  private readonly platform = inject(PlatformService);
  private readonly fs = window as unknown as FsWindow;
  private readonly handles = new Map<string, FsFileHandle>();
  private seq = 0;

  get supportsFsAccess(): boolean {
    return typeof this.fs.showOpenFilePicker === 'function';
  }

  async signIn(): Promise<void> {}
  async signOut(): Promise<void> {}

  root(): FolderRef {
    return { id: '', name: 'Dispositivo' };
  }
  async list(): Promise<BrowserEntry[]> {
    return [];
  }
  async search(): Promise<FileRef[]> {
    return [];
  }

  async pick(): Promise<LoadedFile | null> {
    if (this.supportsFsAccess) {
      try {
        const [handle] = await this.fs.showOpenFilePicker!({ types: PICKER_TYPES });
        const file = await handle.getFile();
        return { ref: this.remember(handle, file), bytes: new Uint8Array(await file.arrayBuffer()) };
      } catch (e) {
        if (isAbort(e)) return null;
        throw e;
      }
    }
    const file = await pickWithInput();
    if (!file) return null;
    return {
      ref: { providerId: this.id, id: `input-${++this.seq}`, name: file.name, size: file.size, modifiedAt: iso(file.lastModified) },
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  /** Accepts a File from drag-and-drop so it flows through the same pipeline as pick(). */
  async fromFile(file: File): Promise<LoadedFile> {
    return {
      ref: { providerId: this.id, id: `drop-${++this.seq}`, name: file.name, size: file.size, modifiedAt: iso(file.lastModified) },
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  async read(ref: FileRef): Promise<LoadedFile> {
    const handle = this.handles.get(ref.id);
    if (!handle) throw new Error('Este arquivo local não pode ser reaberto automaticamente. Abra-o novamente.');
    const file = await handle.getFile();
    return { ref, bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  async save(bytes: Bytes, target: SaveTarget): Promise<FileRef> {
    const overwriteHandle = target.overwrite && this.handles.get(target.overwrite.id);
    if (this.supportsFsAccess) {
      const startIn = overwriteHandle ?? this.lastHandle();
      const handle =
        overwriteHandle ??
        (await this.fs.showSaveFilePicker!({ suggestedName: target.name, types: PICKER_TYPES, ...(startIn ? { startIn } : {}) }));
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      return this.remember(handle, await handle.getFile());
    }
    if (this.platform.platform === 'android' || this.platform.platform === 'ios') {
      await saveWithShareSheet(bytes, target.name);
    } else {
      download(bytes, target.name);
    }
    return { providerId: this.id, id: `download-${++this.seq}`, name: target.name, size: bytes.byteLength };
  }

  private remember(handle: FsFileHandle, file: File): FileRef {
    const id = `fs-${++this.seq}`;
    this.handles.set(id, handle);
    return { providerId: this.id, id, name: file.name, size: file.size, modifiedAt: iso(file.lastModified) };
  }

  private lastHandle(): FsFileHandle | undefined {
    return [...this.handles.values()].pop();
  }
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${JWLIBRARY_EXT},.zip`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function download(bytes: Bytes, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
