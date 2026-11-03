import { Component, computed, inject } from '@angular/core';
import { TagItem } from '../../../core/jwlibrary/models/userdata.models';
import { DocumentStore } from '../../../core/state/document.store';
import { DialogService } from '../../../core/ui/dialog.service';
import { NotificationService } from '../../../core/ui/notification.service';

@Component({
  selector: 'app-tags-page',
  template: `
    <div class="toolbar">
      <span class="muted">{{ tags().length }} etiqueta(s)</span>
      <button type="button" class="btn primary" (click)="create()"><span class="material-symbols-rounded">add</span> Nova etiqueta</button>
    </div>

    <div class="list card-panel">
      @for (t of tags(); track t.id) {
        <div class="row">
          <span class="material-symbols-rounded muted">sell</span>
          <strong class="name">{{ t.name }}</strong>
          <span class="muted count">{{ t.usage }} item(ns)</span>
          <span class="actions">
            <button type="button" class="icon-btn" aria-label="Renomear" title="Renomear" (click)="rename(t)">
              <span class="material-symbols-rounded">edit</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Juntar com outra etiqueta"
              title="Juntar com outra etiqueta"
              (click)="mergeInto(t)"
            >
              <span class="material-symbols-rounded">call_merge</span>
            </button>
            <button type="button" class="icon-btn" aria-label="Excluir" title="Excluir" (click)="remove(t)">
              <span class="material-symbols-rounded">delete</span>
            </button>
          </span>
        </div>
      } @empty {
        <p class="empty muted">Nenhuma etiqueta. Crie uma para organizar suas notas.</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .row {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
    }
    .row + .row {
      border-top: 1px solid var(--line);
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      font-size: 0.85rem;
    }
    .actions {
      display: flex;
    }
    .empty {
      padding: 32px;
      text-align: center;
    }
  `,
})
export class TagsPage {
  private readonly store = inject(DocumentStore);
  private readonly dialogs = inject(DialogService);
  private readonly notify = inject(NotificationService);

  protected readonly tags = computed(() => {
    this.store.revision();
    return this.store.userData()?.tags.list() ?? [];
  });

  protected async create(): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Nova etiqueta', label: 'Nome', confirmLabel: 'Criar' });
    if (name) this.store.mutate((d) => d.tags.create(name), 'Etiqueta criada');
  }

  protected async rename(t: TagItem): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Renomear etiqueta', label: 'Nome', value: t.name, confirmLabel: 'Salvar' });
    if (name && name !== t.name) this.store.mutate((d) => d.tags.rename(t.id, name), 'Etiqueta renomeada');
  }

  protected async mergeInto(t: TagItem): Promise<void> {
    const name = await this.dialogs.prompt({
      title: `Juntar "${t.name}" com…`,
      label: 'Nome da etiqueta que vai receber os itens',
      confirmLabel: 'Juntar',
    });
    if (!name) return;
    const target = this.tags().find((x) => x.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!target) {
      this.notify.error(`Etiqueta "${name}" não encontrada.`);
      return;
    }
    this.store.mutate((d) => d.tags.mergeInto(t.id, target.id), `"${t.name}" foi juntada com "${target.name}"`);
  }

  protected async remove(t: TagItem): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir etiqueta',
      message: `Excluir "${t.name}"? Os ${t.usage} item(ns) com esta etiqueta não serão apagados, apenas desvinculados.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok) this.store.mutate((d) => d.tags.delete(t.id), 'Etiqueta excluída');
  }
}
