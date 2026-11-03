import { Injectable, computed, inject, signal } from '@angular/core';
import { PlatformService } from '../platform/platform.service';
import { DialogService } from '../ui/dialog.service';
import { NotificationService } from '../ui/notification.service';
import { SyncService } from './sync.service';

/** A backup sent longer ago than this may miss notes made since: it is made again before an update. */
const FRESH_BACKUP_MS = 15 * 60_000;
/** Checks (every 500 ms) for a robot that is on but not connected yet, before calling it stopped. */
const ROBOT_START_CHECKS = 6;

/**
 * The one "Sincronizar" button: each press does the next step of the round for this device
 * (see SyncService.nextStep) and chains what can safely follow, so on a computer one press sends,
 * merges and updates JW Library. Steps that need no decision also run without a press (auto()).
 * `status` is the single line shown under the button.
 */
@Injectable({ providedIn: 'root' })
export class SyncFlow {
  private readonly sync = inject(SyncService);
  private readonly dialog = inject(DialogService);
  private readonly notify = inject(NotificationService);
  private readonly platform = inject(PlatformService).platform;
  /** Android: whether the robot that taps through JW Library runs (null until checked). */
  private readonly robot = signal<boolean | null>(null);
  /** Android: the robot is on in Settings but the system stopped it; only turning it off and on helps. */
  private readonly robotStopped = signal(false);
  /** The situation auto() last acted on (or the user did, with the button), so it is not repeated. */
  private lastAuto = '';
  private updating = false;

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
        if (this.robotStopped()) return 'O Android parou o robô. Toque para religá-lo.';
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

  /**
   * Does by itself every step that needs no decision: sending this device's backup when another
   * device asked for it (Android only with the robot on), merging new backups and putting a
   * finished merge on JW Library. Called whenever the state changes (app opened or back in front,
   * notification, background check); each situation is tried once, so a robot run that failed is
   * not repeated in a loop. Signing in for the first time and "Juntar sem esperar?" stay with the user.
   */
  async auto(): Promise<void> {
    const sync = this.sync;
    if (!sync.available || sync.busy() || this.updating || !sync.connected()) return;
    const step = sync.nextStep();
    if (step !== 'update' && step !== 'merge' && !(step === 'send' && sync.backupRequested())) return;
    if (this.situation() === this.lastAuto) return;
    if (step === 'send' && this.platform === 'android') {
      await this.checkRobot();
      if (!this.robot()) return;
    }
    await this.run();
  }

  async run(): Promise<void> {
    const sync = this.sync;
    if (sync.busy() || this.updating) return;
    this.lastAuto = this.situation();
    switch (sync.nextStep()) {
      case 'connect':
        await sync.connect();
        // Signed in: carry on with the real step in the same press.
        if (sync.connected() && sync.nextStep() !== 'connect') await this.run();
        return;
      case 'check':
        return sync.refresh();
      case 'update':
        return this.update();
      case 'send':
        if (this.platform === 'electron' && !sync.backupRequested() && (await sync.localUnchanged())) {
          this.notify.info('Tudo sincronizado: nada novo neste computador.');
          return;
        }
        if (this.platform === 'android' && !(await this.robotReady())) return;
        await sync.sendBackup();
        // Computer: when its backup was the last one, apply the merge right away.
        if (this.platform !== 'android' && sync.updateReady()) await this.update();
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
        if (sync.updateReady()) await this.update();
        return;
      }
      case 'merge':
        await sync.sync();
        return;
      case 'done':
        return sync.refresh();
    }
  }

  /** Re-reads whether the robot runs (it is turned on in system settings, outside the app). */
  async checkRobot(): Promise<void> {
    if (this.platform !== 'android') return;
    const { JwLibraryApp } = await import('../platform/android-plugins');
    const status = () => JwLibraryApp.robotStatus().catch(() => ({ enabled: false, running: false }));
    let s = await status();
    // Right after the app starts, Android may still be connecting it.
    for (let i = 0; s.enabled && !s.running && i < ROBOT_START_CHECKS; i++) {
      await new Promise((r) => setTimeout(r, 500));
      s = await status();
    }
    this.robot.set(s.running);
    this.robotStopped.set(s.enabled && !s.running);
  }

  /**
   * Android: the robot must be on for "Sincronizar" to do everything. Only the user can turn it
   * on, in Settings › Accessibility; if they would rather not, the backup is made by hand.
   * Returns false when the user went to turn it on (they tap Sincronizar again when back).
   */
  private async robotReady(): Promise<boolean> {
    await this.checkRobot();
    if (this.robot()) return true;
    const { JwLibraryApp } = await import('../platform/android-plugins');
    if (this.robotStopped()) {
      const again = await this.dialog.confirm({
        title: 'Religar o robô',
        message:
          'O Android parou o robô do Editor de Notas (acontece quando o app é atualizado). Em Acessibilidade › Apps instalados › "Editor de Notas: sincronizar sozinho", desative e ative de novo.',
        confirmLabel: 'Abrir Acessibilidade',
      });
      if (!again) return true;
      await JwLibraryApp.openRobotSettings();
      return false;
    }
    const ok = await this.dialog.confirm({
      title: 'Sincronizar sozinho',
      message:
        'Para o botão fazer tudo sozinho, ative o Editor de Notas em Acessibilidade: Apps instalados › "Editor de Notas: sincronizar sozinho" › Ativar. Ele só toca no JW Library durante a sincronização. Sem isso, você mesmo cria o backup e compartilha com o Editor de Notas.',
      confirmLabel: 'Ativar',
    });
    if (!ok) return true;
    await JwLibraryApp.openRobotSettings();
    return false;
  }

  /**
   * Puts the merged file on JW Library. On Android it goes through JW Library's restore, which
   * replaces the device's data: when this device's backup is old (notes made since would be
   * lost), the robot first makes a new one, merged at once, and the update follows when it
   * arrives (SharedBackupReceiver). Without the robot the user is warned instead.
   */
  async update(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    try {
      if (this.platform === 'android' && this.backupIsOld()) {
        await this.checkRobot();
        if (this.robot()) {
          await this.sync.sendBackup(true);
          return;
        }
        const ok = await this.dialog.confirm({
          title: 'Atualizar o JW Library',
          message:
            'O JW Library vai pedir para restaurar o backup sincronizado. O que você anotou depois de enviar o backup deste aparelho se perde.',
          confirmLabel: 'Continuar',
        });
        if (!ok) return;
      }
      if (await this.sync.applyUpdate()) {
        const manual = this.platform === 'android' && !this.robot();
        this.notify.success(manual ? 'Confirme a restauração no JW Library.' : 'JW Library atualizado.');
      }
    } finally {
      this.updating = false;
    }
  }

  /** Android: this device's backup is too old to restore over without losing what was noted since. */
  private backupIsOld(): boolean {
    const last = this.sync.lastUpload();
    return !last || Date.now() - Date.parse(last) > FRESH_BACKUP_MS;
  }

  /** What auto() acts on: the step plus the files and uploads that make it up. */
  private situation(): string {
    const ov = this.sync.overview();
    return [
      this.sync.nextStep(),
      ov?.current?.id,
      ov?.current?.modifiedAt,
      ov?.pending.map((f) => f.id).join(','),
      ov?.devices.map((d) => `${d.device.id}:${d.upload?.id ?? ''}`).join(','),
    ].join('|');
  }
}
