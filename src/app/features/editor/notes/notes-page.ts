import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { publicationName } from '../../../core/jwlibrary/models/location-format';
import { NoteDraft, NoteFilter } from '../../../core/jwlibrary/models/userdata.models';
import { DocumentStore } from '../../../core/state/document.store';
import { DialogService } from '../../../core/ui/dialog.service';
import { NoteEditor } from './note-editor';
import { NoteList } from './note-list';

@Component({
  selector: 'app-notes-page',
  imports: [FormsModule, NoteList, NoteEditor],
  templateUrl: './notes-page.html',
  styleUrl: './notes-page.scss',
})
export class NotesPage {
  private readonly store = inject(DocumentStore);
  private readonly dialogs = inject(DialogService);

  protected readonly text = signal('');
  protected readonly tag = signal<NoteFilter['tag']>(null);
  protected readonly publication = signal<string | null>(null);
  protected readonly selectedId = signal<number | null>(null);

  private readonly data = computed(() => {
    this.store.revision();
    return this.store.userData();
  });

  protected readonly notes = computed(
    () => this.data()?.notes.list({ text: this.text(), tag: this.tag(), publication: this.publication() }) ?? [],
  );
  protected readonly allTags = computed(() => this.data()?.tags.list() ?? []);
  protected readonly publications = computed(() =>
    (this.data()?.notes.publications() ?? []).map((k) => ({ key: k, name: publicationName(k) })),
  );
  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id == null ? null : (this.notes().find((n) => n.id === id) ?? this.data()?.notes.get(id) ?? null);
  });

  protected create(): void {
    let id = 0;
    if (this.store.mutate((d) => (id = d.notes.create({ title: 'Nova nota', content: '' })))) {
      this.text.set('');
      this.tag.set(null);
      this.publication.set(null);
      this.selectedId.set(id);
    }
  }

  protected save(id: number, draft: NoteDraft): void {
    this.store.mutate((d) => d.notes.update(id, draft), 'Nota salva');
  }

  protected async remove(id: number): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir nota',
      message: 'A nota será removida deste backup. Esta ação só é definitiva quando você salvar o arquivo.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok && this.store.mutate((d) => d.notes.delete(id), 'Nota excluída')) this.selectedId.set(null);
  }

  protected addTag(noteId: number, tagId: number): void {
    this.store.mutate((d) => d.notes.addTag(noteId, tagId));
  }

  protected async createTag(noteId: number): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Nova etiqueta', label: 'Nome da etiqueta', confirmLabel: 'Criar' });
    if (name) this.store.mutate((d) => d.notes.addTag(noteId, d.tags.create(name)), `Etiqueta "${name}" criada`);
  }

  protected removeTag(noteId: number, tagId: number): void {
    this.store.mutate((d) => d.notes.removeTag(noteId, tagId));
  }

  protected tagValue(v: string): NoteFilter['tag'] {
    return v === '' ? null : v === 'none' ? 'none' : Number(v);
  }
}
