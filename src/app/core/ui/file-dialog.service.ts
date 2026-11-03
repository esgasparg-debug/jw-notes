import { Injectable, signal } from '@angular/core';
import { FileRef, LoadedFile, SaveTarget, StorageProviderId } from '../storage/storage.models';

export interface OpenRequest {
  title: string;
  resolve(file: LoadedFile | null): void;
}

export interface SaveRequest {
  title: string;
  providerId: StorageProviderId;
  /** File the content came from; its folder is pre-selected so the copy lands next to it. */
  source: FileRef | null;
  name: string;
  resolve(choice: SaveChoice | null): void;
}

export interface SaveChoice {
  providerId: StorageProviderId;
  target: SaveTarget;
}

/** Opens the app's open/save dialogs and resolves with the user's choice (null when cancelled). */
@Injectable({ providedIn: 'root' })
export class FileDialogService {
  private readonly _open = signal<OpenRequest | null>(null);
  private readonly _save = signal<SaveRequest | null>(null);
  readonly openRequest = this._open.asReadonly();
  readonly saveRequest = this._save.asReadonly();

  openFile(title = 'Abrir backup do JW Library'): Promise<LoadedFile | null> {
    this._open()?.resolve(null);
    return new Promise((resolve) => this._open.set({ title, resolve }));
  }

  saveFile(req: Omit<SaveRequest, 'resolve' | 'title'> & { title?: string }): Promise<SaveChoice | null> {
    this._save()?.resolve(null);
    return new Promise((resolve) => this._save.set({ title: 'Salvar backup', ...req, resolve }));
  }

  completeOpen(file: LoadedFile | null): void {
    const r = this._open();
    this._open.set(null);
    r?.resolve(file);
  }

  completeSave(choice: SaveChoice | null): void {
    const r = this._save();
    this._save.set(null);
    r?.resolve(choice);
  }
}
