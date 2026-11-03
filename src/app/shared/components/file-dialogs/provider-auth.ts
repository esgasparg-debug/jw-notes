import { Component, inject, input, signal } from '@angular/core';
import { StorageProvider } from '../../../core/storage/storage-provider';
import { NotificationService } from '../../../core/ui/notification.service';

/**
 * Shows the provider's content when it is configured and signed in; otherwise explains
 * what is missing or offers a sign-in button.
 */
@Component({
  selector: 'app-provider-auth',
  template: `
    @if (!provider().available) {
      <div class="notice">
        <span class="material-symbols-rounded">settings</span>
        <div>
          <strong>{{ provider().label }} ainda não está configurado.</strong>
          <p>{{ provider().unavailableReason }} Veja as instruções de configuração no README.</p>
        </div>
      </div>
    } @else if (!provider().signedIn()) {
      <div class="notice">
        <span class="material-symbols-rounded">login</span>
        <div>
          <p>Entre na sua conta para ver seus backups no {{ provider().label }}.</p>
          <button type="button" class="btn primary" [disabled]="busy()" (click)="signIn()">Entrar no {{ provider().label }}</button>
        </div>
      </div>
    } @else {
      <ng-content />
      <p class="account">
        <button type="button" class="link" (click)="provider().signOut()">Sair do {{ provider().label }}</button>
      </p>
    }
  `,
  styles: `
    .notice { display: flex; gap: 12px; align-items: flex-start; padding: 16px; border: 1px dashed var(--line); border-radius: var(--radius); }
    .notice p { margin: 4px 0 10px; color: var(--muted); }
    .account { margin: 8px 0 0; text-align: right; font-size: .85rem; }
  `,
})
export class ProviderAuth {
  readonly provider = input.required<StorageProvider>();
  private readonly notify = inject(NotificationService);
  protected readonly busy = signal(false);

  protected async signIn(): Promise<void> {
    this.busy.set(true);
    try {
      await this.provider().signIn();
    } catch (e) {
      this.notify.error(e, 'Não foi possível entrar');
    } finally {
      this.busy.set(false);
    }
  }
}
