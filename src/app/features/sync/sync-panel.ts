import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MERGE_ENTITY_LABELS, MergeEntity, MergeReport } from '../../core/jwlibrary/merge/merge.models';
import { PlatformService } from '../../core/platform/platform.service';
import { DocumentActions } from '../../core/state/document-actions.service';
import { DeviceStatus } from '../../core/sync/devices';
import { SyncService } from '../../core/sync/sync.service';
import { DialogService } from '../../core/ui/dialog.service';
import { NotificationService } from '../../core/ui/notification.service';
import { FolderPathPipe } from '../../shared/pipes/folder-path-pipe';
import { ShortDatePipe } from '../../shared/pipes/short-date-pipe';
import { MergeSummary } from '../merge/merge-summary';

/** The app's main action: merge the phones' backups through Google Drive with one click. */
@Component({
  selector: 'app-sync-panel',
  imports: [RouterLink, FolderPathPipe, ShortDatePipe, MergeSummary],
  templateUrl: './sync-panel.html',
  styleUrl: './sync-panel.scss',
})
export class SyncPanel {
  protected readonly sync = inject(SyncService);
  private readonly actions = inject(DocumentActions);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly isAndroid = inject(PlatformService).platform === 'android';
  protected readonly pendingCount = computed(() => this.sync.overview()?.pending.length ?? 0);
  /** With JW Library on this computer there is always something to check: its own database. */
  protected readonly canSync = computed(() => !this.sync.overview() || this.pendingCount() > 0 || !!this.sync.localLibrary());

  /** Backups in the inbox that no registered device claims (e.g. saved by hand from the Drive app). */
  protected readonly otherPending = computed(() => {
    const claimed = new Set(this.sync.devices().map((d) => d.upload?.id));
    return (this.sync.overview()?.pending ?? []).filter((p) => !claimed.has(p.id));
  });
  /** The device that opened the round, for "Samsung enviou um backup". */
  protected readonly firstSender = computed(() => this.sync.devices().find((d) => !d.me && d.upload)?.device.name ?? null);

  protected readonly buttonLabel = computed(() => {
    if (this.sync.phase() === 'syncing') return 'Sincronizando…';
    if (!this.sync.overview()) return 'Sincronizar agora';
    const waiting = this.sync.waitingFor().length;
    if (waiting) return `Mesclar agora, sem esperar ${waiting} aparelho${waiting > 1 ? 's' : ''}`;
    const n = this.pendingCount();
    if (n) return `Sincronizar agora (${n} backup${n > 1 ? 's' : ''})`;
    return this.sync.localLibrary() ? 'Sincronizar agora' : 'Nada novo para sincronizar';
  });

  protected deviceIcon(d: DeviceStatus): string {
    return d.device.platform === 'android' || d.device.platform === 'ios' ? 'smartphone' : 'computer';
  }

  protected async applyUpdate(): Promise<void> {
    if (this.isAndroid) {
      const ok = await this.dialog.confirm({
        title: 'Atualizar o JW Library',
        message:
          'O JW Library vai pedir para restaurar o backup sincronizado. Isso substitui os dados deste aparelho pelos de todos os aparelhos juntos. O que você anotou depois de enviar o backup deste aparelho se perde.',
        confirmLabel: 'Continuar',
      });
      if (!ok) return;
    }
    if (await this.sync.applyUpdate()) {
      this.notify.success(this.isAndroid ? 'Confirme a restauração no JW Library.' : 'JW Library atualizado. Pode abri-lo.');
    }
  }

  protected async remove(d: DeviceStatus): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Remover ${d.device.name}?`,
      message: 'A sincronização deixa de esperar por este aparelho. Se ele enviar um backup de novo, volta para a lista.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (ok) await this.sync.removeDevice(d.device.id);
  }

  /** "+7 notas", "+149 marcações"… for the result card. */
  protected changes(report: MergeReport): { label: string; count: number }[] {
    return (Object.keys(MERGE_ENTITY_LABELS) as MergeEntity[])
      .map((k) => ({ label: MERGE_ENTITY_LABELS[k].toLowerCase(), count: report.counters[k].added + report.counters[k].updated }))
      .filter((c) => c.count > 0);
  }

  protected async openInEditor(): Promise<void> {
    try {
      const file = await this.sync.loadCurrent();
      if (file) await this.actions.open(file);
    } catch (e) {
      this.notify.error(e, 'Não foi possível abrir o arquivo sincronizado');
    }
  }
}
