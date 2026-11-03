import { Injectable, Injector, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '../platform/platform.service';
import { SyncFlow } from './sync-flow';
import { SyncService } from './sync.service';

const POLL_MS = 60_000;

/**
 * Keeps every device told about the sync rounds:
 * - Android: Firebase push notifications (sent by the relay in functions/), even with the app closed;
 * - computer and browser: a check of the Drive every minute while the app is open, plus a
 *   system notification on desktop.
 * Tapping a notification opens the app, which then sends its backup or updates by itself (SyncFlow.auto).
 */
@Injectable({ providedIn: 'root' })
export class SyncAlerts {
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService).platform;
  private readonly injector = inject(Injector);
  private readonly flow = inject(SyncFlow);
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    // Whatever needs no decision (send when asked, merge, update) happens as soon as the state allows.
    effect(
      () => {
        this.sync.overview();
        this.sync.busy();
        this.sync.connected();
        untracked(() => void this.flow.auto());
      },
      { injector: this.injector },
    );
    if (this.platform === 'android') {
      void this.startPush();
      void this.flow.checkRobot();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        void this.flow.checkRobot();
        void this.sync.refresh(true);
      });
    } else this.startPolling();
  }

  private async startPush(): Promise<void> {
    // Without the relay there is no Firebase project either, and registering would fail.
    if (!this.sync.notificationsEnabled) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('registration', (t) => void this.sync.setPushToken(t.value));
    await PushNotifications.addListener('registrationError', (e) => console.warn('Push não registrado', e));
    // In the foreground no system notification shows; the panel just updates.
    await PushNotifications.addListener('pushNotificationReceived', () => void this.sync.refresh(true));
    await PushNotifications.addListener('pushNotificationActionPerformed', () => this.openPanel());
    const { receive } = await PushNotifications.requestPermissions();
    if (receive === 'granted') await PushNotifications.register();
  }

  private startPolling(): void {
    setInterval(() => void this.sync.refresh(true), POLL_MS);
    if (this.platform !== 'electron' || typeof Notification === 'undefined') return;

    // Notify on the transition only, not on every check while the state lasts.
    let asked = this.sync.backupRequested();
    let ready = this.sync.updateReady();
    effect(
      () => {
        const nowAsked = this.sync.backupRequested();
        const nowReady = this.sync.updateReady();
        untracked(() => {
          if (nowAsked && !asked) {
            const from = this.sync.devices().find((d) => !d.me && d.upload)?.device.name;
            this.show(
              'Sincronizar JW Library',
              from
                ? `${from} enviou um backup. Clique para enviar o deste computador.`
                : 'Há dados novos. Clique para enviar o backup deste computador.',
            );
          }
          if (nowReady && !ready)
            this.show('Atualização pronta', 'Os backups foram mesclados. Clique para atualizar o JW Library deste computador.');
        });
        asked = nowAsked;
        ready = nowReady;
      },
      { injector: this.injector },
    );
  }

  private show(title: string, body: string): void {
    const n = new Notification(title, { body });
    n.onclick = () => {
      (window as unknown as { jwNotesDesktop?: { focus?: () => void } }).jwNotesDesktop?.focus?.();
      this.openPanel();
    };
  }

  private openPanel(): void {
    void this.router.navigate(['/']);
    void this.sync.refresh();
  }
}
