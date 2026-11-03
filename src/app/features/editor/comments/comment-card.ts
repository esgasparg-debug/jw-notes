import { Component, effect, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { InputFieldItem } from '../../../core/jwlibrary/models/userdata.models';

@Component({
  selector: 'app-comment-card',
  imports: [ReactiveFormsModule],
  template: `
    <textarea [formControl]="value" rows="3" [attr.aria-label]="'Comentário em ' + item().location.label"></textarea>
    <div class="actions">
      <span class="muted tag">{{ item().textTag }}</span>
      <button type="button" class="icon-btn" aria-label="Excluir comentário" (click)="deleted.emit()">
        <span class="material-symbols-rounded">delete</span>
      </button>
      <button type="button" class="btn primary" [disabled]="value.pristine" (click)="save()">Aplicar</button>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 6px;
    }
    textarea {
      resize: vertical;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tag {
      flex: 1;
      font-size: 0.75rem;
    }
  `,
})
export class CommentCard {
  readonly item = input.required<InputFieldItem>();
  readonly saved = output<string>();
  readonly deleted = output<void>();

  protected readonly value = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const v = this.item().value;
      if (!this.value.dirty) this.value.reset(v);
    });
  }

  protected save(): void {
    this.saved.emit(this.value.value);
    this.value.markAsPristine();
  }
}
