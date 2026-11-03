import { Injectable, computed, inject, signal } from '@angular/core';
import { PlatformService } from '../platform/platform.service';
import { DialogService } from '../ui/dialog.service';
import { NotificationService } from '../ui/notification.service';
import { SyncService } from './sync.service';

/**
 * The one "Sincronizar" button: each press does the next step of the round for this device
 * (see SyncService.nextStep) and chains what can safely follow, so on a computer one press sends,
 * merges and updates JW Library. `status` is the single line shown under the button.
 */
@Injectable({ providedIn: 'root' })
export class SyncFlow {
  private readonly sync = inject(SyncService);
  private readonly dialog = inject(DialogService);
  private readonly notify = inject(NotificationService);
  private readonly platform = inject(PlatformService).platform;
  /** Android: whether the robot that taps through JW Library is on (null until checked). */
  private readonly robot = signal<boolean | null>(null);

  readonly status = computed(() => {
    const sync = this.sync;
    if (!sync.available) return sync.unavailableReason;
    if (sync.busy()) return sync.message() || 'Sincronizando…';
    if (sync.error()) return sync.error()!;
    const from = sync.devices().find((d) => !d.me && d.upload)?.device.name;
    switch (sync.nextStep()) {
      case 'connect':
        return 'Toque para conectar sua conta do Google.';
      case 'check':
        return '';
      case 'update':
        return 'Os aparelhos foram sincronizados. Toque para atualizar o JW Library.';
      case 'send':
        if (from) return `${from} enviou um backup. Toque para enviar o deste aparelho.`;
        return this.platform === 'android' && this.robot() === false
          ? 'Toque, crie o backup no JW Library e compartilhe com o Editor de Notas.'
          : 'Toque para sincronizar este aparelho.';
      case 'wait':
        return `Aguardando: ${sync
          .waitingFor()
          .map((d) => d.device.name)
          .join(', ')}.`;
      case 'merge':
        return 'Há backups novos. Toque para juntar.';
      case 'done':
        return 'Tudo sincronizado.';
    }
  });

  async run(): Promise<void> {
    const sync = this.sync;
    if (sync.busy()) return;
    switch (sync.nextStep()) {
      case 'connect':
        await sync.connect();
        // Signed in: carry on with the real step in the same press.
        if (sync.connected() && sync.nextStep() !== 'connect') await this.run();
        return;
      case 'check':
        return sync.refresh();
      case 'update':
        return this.update(true);
      case 'send':
        if (this.platform === 'electron' && !sync.backupRequested() && (await sync.localUnchanged())) {
          this.notify.info('Tudo sincronizado: nada novo neste computador.');
          return;
        }
        if (this.platform === 'android' && !(await this.robotReady())) return;
        await sync.sendBackup();
        // Computer: when its backup was the last one, apply the merge right away.
        if (this.platform !== 'android' && sync.updateReady()) await this.update(false);
        return;
      case 'wait': {
        const names = sync
          .waitingFor()
          .map((d) => d.device.name)
          .join(', ');
        const ok = await this.dialog.confirm({
          title: 'Juntar sem esperar?',
          message: `Ainda faltam: ${names}. Juntar agora o que já chegou? Quem faltou entra na próxima sincronização.`,
          confirmLabel: 'Juntar agora',
        });
        if (!ok || !(await sync.sync())) return;
        // This device's backup may be hours old: Android asks before restoring.
        if (sync.updateReady()) await this.update(true);
        return;
      }
      case 'merge':
        await sync.sync();
        return;
      case 'done':
        return sync.refresh();
    }
  }

  /** Re-reads whether the robot is on (it is turned on in system settings, outside the app). */
  async checkRobot(): Promise<void> {
    if (this.platform !== 'android') return;
    const { JwLibraryApp } = await import('../platform/android-plugins');
    this.robot.set((await JwLibraryApp.robotStatus().catch(() => ({ enabled: false }))).enabled);
  }

  /**
   * Android: the robot must be on for "Sincronizar" to do everything. Only the user can turn it
   * on, in Settings › Accessibility; if they would rather not, the backup is made by hand.
   * Returns false when the user went to turn it on (they tap Sincronizar again when back).
   */
  private async robotReady(): Promise<boolean> {
    await this.checkRobot();
    if (this.robot()) return true;
    const ok = await this.dialog.confirm({
      title: 'Sincronizar sozinho',
      message:
        'Para o botão fazer tudo sozinho, ative o Editor de Notas em Acessibilidade: Apps instalados › "Editor de Notas: sincronizar sozinho" › Ativar. Ele só toca no JW Library durante a sincronização. Sem isso, você mesmo cria o backup e compartilha com o Editor de Notas.',
      confirmLabel: 'Ativar',
    });
    if (!ok) return true;
    const { JwLibraryApp } = await import('../platform/android-plugins');
    await JwLibraryApp.openRobotSettings();
    return false;
  }

  /**
   * Puts the merged file on JW Library. On Android it goes through JW Library's restore, which
   * replaces the device's data, so the user is warned first unless the backup was just sent.
   */
  async update(confirmFirst: boolean): Promise<void> {
    if (confirmFirst && this.platform === 'android') {
      const ok = await this.dialog.confirm({
        title: 'Atualizar o JW Library',
        message:
          'O JW Library vai pedir para restaurar o backup sincronizado. O que você anotou depois de enviar o backup deste aparelho se perde.',
        confirmLabel: 'Continuar',
      });
      if (!ok) return;
    }
    if (await this.sync.applyUpdate()) {
      this.notify.success(this.platform === 'android' ? 'Confirme a restauração no JW Library.' : 'JW Library atualizado.');
    }
  }
}
