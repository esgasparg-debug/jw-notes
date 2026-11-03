import { signal } from '@angular/core';
import { DriveApi, DriveFile, DriveFileMeta, FOLDER_MIME } from '../app/core/storage/google-drive/drive-api';
import { Bytes } from '../app/core/storage/storage.models';

interface Item {
  file: DriveFile;
  content?: Bytes;
  created: number;
}

/** In-memory Google Drive for unit tests. "root" is "Meu Drive". */
export class FakeDriveApi extends DriveApi {
  readonly available = true;
  readonly unavailableReason = '';
  private readonly _signedIn = signal(true);
  readonly signedIn = this._signedIn.asReadonly();

  private readonly items = new Map<string, Item>();
  private seq = 0;
  private clock = Date.parse('2026-10-01T00:00:00Z');

  async signIn(): Promise<void> {
    this._signedIn.set(true);
  }
  async signOut(): Promise<void> {
    this._signedIn.set(false);
  }
  restoreSession(): boolean {
    return this._signedIn();
  }

  async listChildren(folderId: string): Promise<DriveFile[]> {
    return this.childrenOf(folderId)
      .sort(
        (a, b) =>
          Number(b.file.mimeType === FOLDER_MIME) - Number(a.file.mimeType === FOLDER_MIME) || a.file.name.localeCompare(b.file.name),
      )
      .map((i) => ({ ...i.file }));
  }

  async findChild(folderId: string, name: string, kind: 'file' | 'folder'): Promise<DriveFile | undefined> {
    const match = this.childrenOf(folderId)
      .filter((i) => i.file.name === name && (i.file.mimeType === FOLDER_MIME) === (kind === 'folder'))
      .sort((a, b) => a.created - b.created)[0];
    return match && { ...match.file };
  }

  async search(text: string): Promise<DriveFile[]> {
    return [...this.items.values()]
      .filter((i) => i.file.mimeType !== FOLDER_MIME && i.file.name.includes(text))
      .map((i) => ({ ...i.file }));
  }

  async download(fileId: string): Promise<Bytes> {
    const item = this.get(fileId);
    if (!item.content) throw new Error(`not a file: ${fileId}`);
    return item.content.slice();
  }

  async create(folderId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile> {
    return this.put(folderId, meta, new Uint8Array(await content.arrayBuffer()));
  }

  async update(fileId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile> {
    const item = this.get(fileId);
    item.content = new Uint8Array(await content.arrayBuffer());
    item.file = { ...item.file, ...meta, modifiedTime: this.tick(), size: String(item.content.byteLength) };
    return { ...item.file };
  }

  async createFolder(parentId: string, name: string): Promise<DriveFile> {
    return this.put(parentId, { name, mimeType: FOLDER_MIME });
  }

  async move(fileId: string, fromFolderId: string, toFolderId: string): Promise<DriveFile> {
    const item = this.get(fileId);
    item.file.parents = [...(item.file.parents ?? []).filter((p) => p !== fromFolderId), toFolderId];
    return { ...item.file };
  }

  async trash(fileId: string): Promise<void> {
    this.items.delete(this.get(fileId).file.id);
  }

  async accessToken(): Promise<string> {
    return 'fake-token';
  }

  /* ---------- helpers for specs ---------- */

  /** Simulates a phone uploading a backup into a folder. */
  addFile(folderId: string, name: string, content: Bytes): DriveFile {
    return this.put(folderId, { name, mimeType: 'application/octet-stream' }, content);
  }

  /** Resolves a folder id from names under "Meu Drive", e.g. folderId('jw-notes', 'sync'). */
  folderId(...names: string[]): string {
    let id = 'root';
    for (const name of names) {
      const next = this.childrenOf(id).find((i) => i.file.name === name && i.file.mimeType === FOLDER_MIME);
      if (!next) throw new Error(`folder not found: ${names.join('/')}`);
      id = next.file.id;
    }
    return id;
  }

  namesIn(...path: string[]): string[] {
    return this.childrenOf(this.folderId(...path))
      .map((i) => i.file.name)
      .sort();
  }

  filesIn(...path: string[]): DriveFile[] {
    return this.childrenOf(this.folderId(...path)).map((i) => ({ ...i.file }));
  }

  private put(parentId: string, meta: DriveFileMeta, content?: Bytes): DriveFile {
    const id = `id${++this.seq}`;
    const file: DriveFile = {
      id,
      ...meta,
      parents: [parentId],
      modifiedTime: this.tick(),
      size: content ? String(content.byteLength) : undefined,
    };
    this.items.set(id, { file, content, created: this.seq });
    return { ...file };
  }

  private childrenOf(folderId: string): Item[] {
    return [...this.items.values()].filter((i) => i.file.parents?.includes(folderId));
  }

  private get(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new Error(`file not found: ${id}`);
    return item;
  }

  private tick(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }
}
