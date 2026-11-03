import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LoadedFile } from '../storage/storage.models';
import { SyncService, syncFileName } from '../sync/sync.service';
import { DialogService } from '../ui/dialog.service';
import { FileDialogService } from '../ui/file-dialog.service';
import { DocumentStore } from './document.store';

/** User-level workflows (open, save, close) that combine dialogs, the store and navigation. */
@Injectable({ providedIn: 'root' })
export class DocumentActions {
  private readonly store = inject(DocumentStore);
  private readonly files = inject(FileDialogService);
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncService);

  async open(file?: LoadedFile): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const chosen = file ?? (await this.files.openFile());
    if (chosen && (await this.store.open(chosen))) await this.router.navigate(['/editor']);
  }

  async save(): Promise<boolean> {
    const source = this.store.document()?.source;
    if (source && this.sync.isSyncFile(source)) {
      // jw-notes/sync holds a single file: edits to it are written back in place, no questions asked.
      const saved = await this.store.save('google-drive', { name: syncFileName(new Date()), overwrite: source });
      if (saved) void this.sync.refresh();
      return saved;
    }
    const defaults = this.store.defaultSaveTarget();
    const choice = await this.files.saveFile(defaults);
    return !!choice && this.store.save(choice.providerId, choice.target);
  }

  async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.store.close();
    await this.router.navigate(['/']);
  }

  /** Resolves true when there is nothing unsaved or the user agrees to drop it. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.store.dirty()) return true;
    return this.dialogs.confirm({
      title: 'Alterações não salvas',
      message: 'O backup aberto tem alterações que ainda não foram salvas. Descartá-las?',
      confirmLabel: 'Descartar',
      danger: true,
    });
  }
}
