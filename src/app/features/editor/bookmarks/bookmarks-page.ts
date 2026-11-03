import { Component, computed, inject } from '@angular/core';
import { BookmarkItem } from '../../../core/jwlibrary/models/userdata.models';
import { DocumentStore } from '../../../core/state/document.store';
import { DialogService } from '../../../core/ui/dialog.service';

@Component({
  selector: 'app-bookmarks-page',
  template: `
    <div class="list card-panel">
      @for (b of bookmarks(); track b.id) {
        <div class="row">
          <span class="slot" title="Posição do marcador">{{ b.slot + 1 }}</span>
          <div class="info">
            <strong>{{ b.title }}</strong>
            <span class="muted">{{ b.location.label }} · {{ b.publication.publication }}</span>
            @if (b.snippet) {
              <span class="snippet">{{ b.snippet }}</span>
            }
          </div>
          <button type="button" class="icon-btn" aria-label="Renomear marcador" (click)="rename(b)">
            <span class="material-symbols-rounded">edit</span>
          </button>
          <button type="button" class="icon-btn" aria-label="Excluir marcador" (click)="remove(b)">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      } @empty {
        <p class="empty muted">Nenhum marcador neste backup.</p>
      }
    </div>
  `,
  styles: `
    .row {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
    }
    .row + .row {
      border-top: 1px solid var(--line);
    }
    .slot {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 600;
      font-size: 0.85rem;
    }
    .info {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .info .muted {
      font-size: 0.85rem;
    }
    .snippet {
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 32px;
      text-align: center;
    }
  `,
})
export class BookmarksPage {
  private readonly store = inject(DocumentStore);
  private readonly dialogs = inject(DialogService);

  protected readonly bookmarks = computed(() => {
    this.store.revision();
    return this.store.userData()?.bookmarks.list() ?? [];
  });

  protected async rename(b: BookmarkItem): Promise<void> {
    const title = await this.dialogs.prompt({ title: 'Renomear marcador', label: 'Título', value: b.title, confirmLabel: 'Salvar' });
    if (title && title !== b.title) this.store.mutate((d) => d.bookmarks.update(b.id, title, b.snippet), 'Marcador renomeado');
  }

  protected async remove(b: BookmarkItem): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir marcador',
      message: `Excluir o marcador "${b.title}"?`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok) this.store.mutate((d) => d.bookmarks.delete(b.id), 'Marcador excluído');
  }
}
