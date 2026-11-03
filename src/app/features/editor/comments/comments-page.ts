import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputFieldItem } from '../../../core/jwlibrary/models/userdata.models';
import { DocumentStore } from '../../../core/state/document.store';
import { DialogService } from '../../../core/ui/dialog.service';
import { CommentCard } from './comment-card';

interface CommentGroup {
  id: number;
  label: string;
  publication: string;
  items: InputFieldItem[];
}

/** Text typed into publication fields (study answers, meeting-workbook comments, …). */
@Component({
  selector: 'app-comments-page',
  imports: [FormsModule, CommentCard],
  template: `
    <div class="toolbar">
      <input type="search" placeholder="Buscar nos comentários…" [ngModel]="text()" (ngModelChange)="text.set($event)" />
      <span class="muted">{{ total() }} comentário(s)</span>
    </div>
    <p class="hint muted">Textos que você digitou nos campos das publicações, como respostas de estudo e comentários da apostila.</p>

    @for (g of groups(); track g.id) {
      <section class="group card-panel">
        <header>
          <h3>{{ g.label }}</h3>
          <span class="muted">{{ g.publication }}</span>
        </header>
        @for (f of g.items; track f.textTag) {
          <app-comment-card [item]="f" (saved)="save(f, $event)" (deleted)="remove(f)" />
        }
      </section>
    } @empty {
      <p class="empty muted">Nenhum comentário encontrado.</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar input {
      flex: 1;
    }
    .hint {
      margin: 0;
      font-size: 0.85rem;
    }
    .group {
      display: grid;
      gap: 12px;
      padding: 12px 16px;
    }
    .group header {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }
    .group h3 {
      margin: 0;
      font-size: 1rem;
    }
    .empty {
      padding: 32px;
      text-align: center;
    }
  `,
})
export class CommentsPage {
  private readonly store = inject(DocumentStore);
  private readonly dialogs = inject(DialogService);

  protected readonly text = signal('');

  protected readonly groups = computed<CommentGroup[]>(() => {
    this.store.revision();
    const items = this.store.userData()?.inputFields.list(this.text()) ?? [];
    const groups = new Map<number, CommentGroup>();
    for (const f of items) {
      let g = groups.get(f.locationId);
      if (!g) groups.set(f.locationId, (g = { id: f.locationId, label: f.location.label, publication: f.location.publication, items: [] }));
      g.items.push(f);
    }
    return [...groups.values()];
  });

  protected readonly total = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));

  protected save(f: InputFieldItem, value: string): void {
    this.store.mutate((d) => d.inputFields.update(f.locationId, f.textTag, value), 'Comentário salvo');
  }

  protected async remove(f: InputFieldItem): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir comentário',
      message: 'O texto deste campo será removido do backup.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok) this.store.mutate((d) => d.inputFields.delete(f.locationId, f.textTag), 'Comentário excluído');
  }
}
