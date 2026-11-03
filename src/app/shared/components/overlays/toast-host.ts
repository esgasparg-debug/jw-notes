import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/ui/notification.service';

@Component({
  selector: 'app-toast-host',
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of notify.toasts(); track t.id) {
        <div class="toast" [class]="t.kind" role="status">
          <span class="material-symbols-rounded">{{ t.kind === 'error' ? 'error' : t.kind === 'success' ? 'check_circle' : 'info' }}</span>
          <span class="msg">{{ t.message }}</span>
          <button type="button" class="icon-btn" aria-label="Fechar aviso" (click)="notify.dismiss(t.id)">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed; z-index: 1000; left: 50%; bottom: max(16px, env(safe-area-inset-bottom));
      transform: translateX(-50%); display: grid; gap: 8px; width: min(480px, calc(100vw - 32px));
    }
    .toast {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius);
      background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg);
    }
    .toast.error { background: var(--danger); color: #fff; }
    .msg { flex: 1; }
    .icon-btn { color: inherit; }
  `,
})
export class ToastHost {
  protected readonly notify = inject(NotificationService);
}
