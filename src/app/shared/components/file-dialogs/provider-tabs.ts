import { Component, input, model } from '@angular/core';
import { StorageProvider } from '../../../core/storage/storage-provider';
import { StorageProviderId } from '../../../core/storage/storage.models';

/** Segmented control to choose where to open from / save to. */
@Component({
  selector: 'app-provider-tabs',
  template: `
    <div class="tabs" role="tablist">
      @for (p of providers(); track p.id) {
        <button type="button" role="tab" class="tab" [class.on]="p.id === selected()" [attr.aria-selected]="p.id === selected()" (click)="selected.set(p.id)">
          <span class="material-symbols-rounded">{{ p.icon }}</span>
          <span>{{ p.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
    .tab {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text);
      font: inherit; cursor: pointer;
    }
    .tab:hover { border-color: var(--accent); }
    .tab.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  `,
})
export class ProviderTabs {
  readonly providers = input.required<StorageProvider[]>();
  readonly selected = model.required<StorageProviderId>();
}
