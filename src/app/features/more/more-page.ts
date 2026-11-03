import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DocumentActions } from '../../core/state/document-actions.service';
import { DocumentStore } from '../../core/state/document.store';
import { LocalStorageProvider } from '../../core/storage/local/local-storage.provider';
import { FileDrop } from '../../shared/directives/file-drop';
import { SyncPanel } from '../sync/sync-panel';

/** Everything besides the Sincronizar button: sync details and devices, the editor and manual merge. */
@Component({
  selector: 'app-more-page',
  imports: [RouterLink, FileDrop, SyncPanel],
  templateUrl: './more-page.html',
  styleUrl: './more-page.scss',
})
export class MorePage {
  protected readonly store = inject(DocumentStore);
  protected readonly actions = inject(DocumentActions);
  private readonly local = inject(LocalStorageProvider);

  protected async dropped(file: File): Promise<void> {
    await this.actions.open(await this.local.fromFile(file));
  }
}
