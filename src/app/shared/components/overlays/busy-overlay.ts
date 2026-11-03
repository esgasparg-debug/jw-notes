import { Component, inject } from '@angular/core';
import { DocumentStore } from '../../../core/state/document.store';

@Component({
  selector: 'app-busy-overlay',
  template: `
    @if (store.busy(); as label) {
      <div class="overlay" role="alert" aria-busy="true">
        <div class="box"><span class="spinner"></span>{{ label }}</div>
      </div>
    }
  `,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; background: rgb(0 0 0 / .3); }
    .box { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
    .spinner { width: 20px; height: 20px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class BusyOverlay {
  protected readonly store = inject(DocumentStore);
}
