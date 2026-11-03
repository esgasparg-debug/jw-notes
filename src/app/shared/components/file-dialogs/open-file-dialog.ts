import { Component, computed, inject, signal } from '@angular/core';
import { LocalStorageProvider } from '../../../core/storage/local/local-storage.provider';
import { StorageService } from '../../../core/storage/storage.service';
import { SyncService } from '../../../core/sync/sync.service';
import { FileRef, LoadedFile, StorageProviderId } from '../../../core/storage/storage.models';
import { NotificationService } from '../../../core/ui/notification.service';
import { FileDrop } from '../../directives/file-drop';
import { readPreference, writePreference } from '../../utils/preferences';
import { CloudBrowser } from '../cloud-browser/cloud-browser';
import { Modal } from '../modal/modal';
import { FileDialogService } from '../../../core/ui/file-dialog.service';
import { ProviderAuth } from './provider-auth';
import { ProviderTabs } from './provider-tabs';

const LAST_PROVIDER_KEY = 'open.lastProvider';

@Component({
  selector: 'app-open-file-dialog',
  imports: [Modal, ProviderTabs, ProviderAuth, CloudBrowser, FileDrop],
  template: `
    <app-modal [heading]="request()?.title ?? ''" [open]="!!request()" [wide]="true" (closed)="cancel()">
      <app-provider-tabs [providers]="storage.providers" [(selected)]="providerId" />

      @if (provider().browsable) {
        <app-provider-auth [provider]="provider()">
          <app-cloud-browser [provider]="provider()" [startPath]="startPath()" [selectedFileId]="loadingId()" (fileChosen)="read($event)" />
        </app-provider-auth>
      } @else {
        <div class="drop" appFileDrop (fileDropped)="dropped($event)">
          <span class="material-symbols-rounded big">upload_file</span>
          <p>Arraste um arquivo <strong>.jwlibrary</strong> para cá</p>
          <button type="button" class="btn primary" (click)="pickLocal()">Escolher arquivo no dispositivo</button>
        </div>
      }

      @if (loadingId()) {
        <p class="muted">Baixando arquivo…</p>
      }
    </app-modal>
  `,
  styles: `
    .drop {
      display: grid; place-items: center; gap: 6px; padding: 40px 16px; text-align: center;
      border: 2px dashed var(--line); border-radius: var(--radius-lg); color: var(--muted);
    }
    .drop.drag-over { border-color: var(--accent); background: var(--accent-soft); }
    .big { font-size: 48px; }
  `,
})
export class OpenFileDialog {
  protected readonly storage = inject(StorageService);
  private readonly dialogs = inject(FileDialogService);
  private readonly local = inject(LocalStorageProvider);
  private readonly notify = inject(NotificationService);
  private readonly sync = inject(SyncService);

  protected readonly request = this.dialogs.openRequest;
  // The remembered provider may no longer be offered (e.g. a hidden one), so fall back to local files.
  private readonly lastProvider = readPreference<StorageProviderId>(LAST_PROVIDER_KEY);
  protected readonly providerId = signal<StorageProviderId>(this.storage.has(this.lastProvider) ? this.lastProvider : 'local');
  protected readonly provider = computed(() => this.storage.get(this.providerId()));
  protected readonly loadingId = signal<string | null>(null);
  /** Google Drive always opens in the backups inbox chosen in the shared settings. */
  protected readonly startPath = computed(() => (this.providerId() === 'google-drive' ? this.sync.inboxPath() : null));

  protected async pickLocal(): Promise<void> {
    try {
      const file = await this.local.pick();
      if (file) this.done(file);
    } catch (e) {
      this.notify.error(e);
    }
  }

  protected async dropped(file: File): Promise<void> {
    this.done(await this.local.fromFile(file));
  }

  protected async read(ref: FileRef): Promise<void> {
    this.loadingId.set(ref.id);
    try {
      this.done(await this.provider().read(ref));
    } catch (e) {
      this.notify.error(e, 'Não foi possível baixar o arquivo');
    } finally {
      this.loadingId.set(null);
    }
  }

  protected cancel(): void {
    this.dialogs.completeOpen(null);
  }

  private done(file: LoadedFile): void {
    writePreference(LAST_PROVIDER_KEY, this.providerId());
    this.dialogs.completeOpen(file);
  }
}
