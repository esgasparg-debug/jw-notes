import { Component, inject } from '@angular/core';
import { SyncFlow } from '../../core/sync/sync-flow';
import { SyncService } from '../../core/sync/sync.service';

/** The first screen: one button and one line saying what it will do. Everything else lives in "Mais opções". */
@Component({
  selector: 'app-sync-home',
  template: `
    <button type="button" class="sync-button" [disabled]="sync.busy() || !sync.available" (click)="flow.run()">
      <span class="material-symbols-rounded" [class.spin]="sync.busy()" aria-hidden="true">sync</span>
      <span>{{ sync.busy() ? 'Sincronizando…' : 'Sincronizar' }}</span>
    </button>
    <p class="status" [class.error]="!!sync.error()" role="status">{{ flow.status() }}</p>
  `,
  styles: `
    :host {
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 24px;
      // Fills the screen under the header (and its 1px border), so the button sits in the middle.
      min-height: calc(100dvh - var(--header-h) - 1px - env(safe-area-inset-top));
      padding: 32px 16px;
    }
    .sync-button {
      display: grid;
      place-items: center;
      align-content: center;
      gap: 6px;
      width: min(220px, 60vw);
      aspect-ratio: 1;
      border: 0;
      border-radius: 50%;
      background: var(--brand);
      color: var(--brand-ink);
      font: inherit;
      font-size: 1.25rem;
      font-weight: 600;
      box-shadow: var(--shadow-lg);
      cursor: pointer;
      transition:
        transform 0.15s,
        background 0.15s;

      .material-symbols-rounded {
        font-size: 64px;
      }
      &:hover:not(:disabled) {
        background: var(--brand-strong);
        transform: scale(1.03);
      }
      &:disabled {
        cursor: default;
        opacity: 0.85;
      }
    }
    .status {
      max-width: 340px;
      min-height: 3em;
      margin: 0;
      color: var(--muted);
      text-align: center;

      &.error {
        color: var(--danger);
      }
    }
    .spin {
      animation: spin 1.2s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class SyncHome {
  protected readonly sync = inject(SyncService);
  protected readonly flow = inject(SyncFlow);
}
