import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DocumentStore } from '../../core/state/document.store';
import { MergeSummary } from '../merge/merge-summary';

@Component({
  selector: 'app-editor-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MergeSummary],
  template: `
    <nav class="tabs" aria-label="Seções do backup">
      @for (t of tabs(); track t.path) {
        <a [routerLink]="t.path" routerLinkActive="on" class="tab">
          <span class="material-symbols-rounded">{{ t.icon }}</span>
          <span class="label">{{ t.label }}</span>
          <span class="count">{{ t.count }}</span>
        </a>
      }
    </nav>

    @if (store.mergeReport(); as report) {
      <details class="merge-summary">
        <summary>
          <span class="material-symbols-rounded">merge</span>
          Este backup é o resultado de uma mesclagem e ainda não foi salvo. Ver resumo.
        </summary>
        <app-merge-summary [report]="report" />
      </details>
    }

    <router-outlet />
  `,
  styleUrl: './editor-shell.scss',
})
export class EditorShell {
  protected readonly store = inject(DocumentStore);

  protected readonly tabs = computed(() => {
    const s = this.store.stats();
    return [
      { path: 'notes', icon: 'sticky_note_2', label: 'Notas', count: s?.notes ?? 0 },
      { path: 'highlights', icon: 'format_ink_highlighter', label: 'Marcações', count: s?.highlights ?? 0 },
      { path: 'comments', icon: 'edit_square', label: 'Comentários', count: s?.inputFields ?? 0 },
      { path: 'bookmarks', icon: 'bookmark', label: 'Marcadores', count: s?.bookmarks ?? 0 },
      { path: 'tags', icon: 'sell', label: 'Etiquetas', count: s?.tags ?? 0 },
    ];
  });
}
