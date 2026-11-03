import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GoogleDriveProvider } from '../../core/storage/google-drive/google-drive.provider';
import { FolderRef } from '../../core/storage/storage.models';
import { SyncService } from '../../core/sync/sync.service';
import { DialogService } from '../../core/ui/dialog.service';
import { CloudBrowser } from '../../shared/components/cloud-browser/cloud-browser';
import { FolderPathPipe } from '../../shared/pipes/folder-path-pipe';

/** Settings shared by every device (stored in jw-notes/config on Google Drive). */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, CloudBrowser, FolderPathPipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly sync = inject(SyncService);
  protected readonly drive = inject(GoogleDriveProvider);
  private readonly dialogs = inject(DialogService);

  protected readonly choosing = signal(false);
  protected readonly browsedPath = signal<FolderRef[]>([]);

  protected async useBrowsedFolder(): Promise<void> {
    const path = this.browsedPath();
    const folder = path.at(-1);
    if (!folder || folder.id === 'root') return;
    await this.sync.setInbox({ folder, path });
    this.choosing.set(false);
  }

  protected async useDefault(): Promise<void> {
    await this.sync.setInbox(null);
    this.choosing.set(false);
  }

  protected async disconnect(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Desconectar do Google Drive',
      message: 'Seus arquivos no Drive não serão apagados. Você poderá conectar de novo a qualquer momento.',
      confirmLabel: 'Desconectar',
    });
    if (ok) await this.sync.disconnect();
  }
}
