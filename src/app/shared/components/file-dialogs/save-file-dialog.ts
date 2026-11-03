import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocalStorageProvider } from '../../../core/storage/local/local-storage.provider';
import { JWLIBRARY_EXT } from '../../../core/storage/storage-provider';
import { StorageService } from '../../../core/storage/storage.service';
import { FolderRef, StorageProviderId } from '../../../core/storage/storage.models';
import { CloudBrowser } from '../cloud-browser/cloud-browser';
import { Modal } from '../modal/modal';
import { FileDialogService } from '../../../core/ui/file-dialog.service';
import { ProviderAuth } from './provider-auth';
import { ProviderTabs } from './provider-tabs';

@Component({
  selector: 'app-save-file-dialog',
  imports: [FormsModule, Modal, ProviderTabs, ProviderAuth, CloudBrowser],
  templateUrl: './save-file-dialog.html',
  styles: `
    .field { display: grid; gap: 4px; margin-bottom: 14px; }
    .check { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .dest { margin: 10px 0 0; font-size: .9rem; }
  `,
})
export class SaveFileDialog {
  protected readonly storage = inject(StorageService);
  private readonly dialogs = inject(FileDialogService);
  private readonly local = inject(LocalStorageProvider);

  protected readonly request = this.dialogs.saveRequest;
  protected readonly providerId = signal<StorageProviderId>('local');
  protected readonly provider = computed(() => this.storage.get(this.providerId()));
  protected readonly folder = signal<FolderRef | null>(null);
  protected readonly name = signal('');
  protected readonly overwrite = signal(false);

  /** Same provider as the source file → start browsing in the source file's folder. */
  protected readonly startPath = computed<FolderRef[] | null>(() => {
    const req = this.request();
    const p = this.provider();
    const src = req?.source;
    if (!src || src.providerId !== p.id || !src.parentId) return null;
    const root = p.root();
    return src.parentId === root.id ? [root] : [root, { id: src.parentId, name: src.parentName ?? 'Pasta do arquivo original' }];
  });

  protected readonly canOverwrite = computed(() => {
    const src = this.request()?.source;
    return !!src && src.providerId === this.providerId() && (this.provider().browsable || this.local.supportsFsAccess);
  });

  protected readonly localHint = computed(() =>
    this.local.supportsFsAccess
      ? 'A janela de salvar do sistema abrirá na pasta do último arquivo aberto.'
      : 'O arquivo será baixado para a pasta de downloads do dispositivo.',
  );

  constructor() {
    effect(() => {
      const req = this.request();
      if (!req) return;
      untracked(() => {
        this.providerId.set(req.providerId);
        this.name.set(req.name);
        this.overwrite.set(false);
        this.folder.set(null);
      });
    });
  }

  protected confirm(): void {
    const req = this.request();
    if (!req) return;
    let name = this.name().trim() || req.name;
    if (!name.toLowerCase().endsWith(JWLIBRARY_EXT)) name += JWLIBRARY_EXT;
    const overwrite = this.overwrite() && this.canOverwrite() ? (req.source ?? undefined) : undefined;
    this.dialogs.completeSave({
      providerId: this.providerId(),
      target: { name: overwrite?.name ?? name, folder: this.folder() ?? undefined, overwrite },
    });
  }

  protected cancel(): void {
    this.dialogs.completeSave(null);
  }
}
