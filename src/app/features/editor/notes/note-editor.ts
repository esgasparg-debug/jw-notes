import { Component, computed, effect, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { highlightCss } from '../../../core/jwlibrary/models/location-format';
import { NoteDraft, NoteItem, TagItem } from '../../../core/jwlibrary/models/userdata.models';
import { ShortDatePipe } from '../../../shared/pipes/short-date-pipe';

@Component({
  selector: 'app-note-editor',
  imports: [ReactiveFormsModule, ShortDatePipe],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
})
export class NoteEditor {
  readonly note = input.required<NoteItem>();
  readonly allTags = input.required<TagItem[]>();

  readonly back = output<void>();
  readonly saved = output<NoteDraft>();
  readonly deleted = output<void>();
  readonly tagAdded = output<number>();
  readonly tagCreateRequested = output<void>();
  readonly tagRemoved = output<number>();

  protected readonly form = inject(NonNullableFormBuilder).group({ title: '', content: '' });

  protected readonly availableTags = computed(() => {
    const used = new Set(this.note().tags.map((t) => t.id));
    return this.allTags().filter((t) => !used.has(t.id));
  });
  protected readonly color = computed(() => highlightCss(this.note().highlightColor));

  constructor() {
    // Reset the form when a different note is selected (not on every refresh of the same note).
    let currentId: number | null = null;
    effect(() => {
      const n = this.note();
      if (n.id === currentId && this.form.dirty) return;
      currentId = n.id;
      this.form.reset({ title: n.title, content: n.content });
    });
  }

  protected submit(): void {
    if (this.form.pristine) return;
    this.saved.emit(this.form.getRawValue());
    this.form.markAsPristine();
  }

  protected onTagPicked(select: HTMLSelectElement): void {
    const v = select.value;
    select.value = '';
    if (v === '__new__') {
      this.tagCreateRequested.emit();
    } else if (v) {
      this.tagAdded.emit(Number(v));
    }
  }
}
