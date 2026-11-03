import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '../platform/platform.service';
import type { SharedFile } from '../platform/android-plugins';
import { NotificationService } from '../ui/notification.service';
import { SyncFlow } from './sync-flow';
import { SyncService } from './sync.service';

/**
 * Android "one tap" backup: JW Library › Criar backup › Compartilhar › Editor de Notas. The file
 * arrives here and goes to the Drive inbox for the current round; once every device has sent
 * one, it is merged at once. The sync panel shows the progress.
 */
@Injectable({ providedIn: 'root' })
export class SharedBackupReceiver {
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly platform = inject(PlatformService);
  private readonly flow = inject(SyncFlow);

  async start(): Promise<void> {
    if (this.platform.platform !== 'android') return;
    const { SharedBackup } = await import('../platform/android-plugins');
    // Also delivers the share that launched the app: the plugin keeps it until this listener exists.
    await SharedBackup.addListener('received', (file) => void this.receive(file));
  }

  private async receive(file: SharedFile): Promise<void> {
    if (file.error || !file.data) {
      this.notify.error(file.error ?? 'O arquivo recebido está vazio.');
      return;
    }
    void this.router.navigate(['/']);
    const outcome = await this.sync.syncReceived(file.name ?? '', fromBase64(file.data));
    // This backup was the last one: hand the merge to JW Library at once. Safe without asking,
    // since the device's data was just backed up.
    if (outcome && this.sync.updateReady()) await this.flow.update(false);
    else if (outcome) this.notify.success('Sincronizado.');
    else if (!this.sync.error()) {
      const waiting = this.sync.waitingFor().map((d) => d.device.name);
      this.notify.info(waiting.length ? `Backup enviado. Aguardando: ${waiting.join(', ')}.` : 'Backup enviado.');
    }
  }
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
