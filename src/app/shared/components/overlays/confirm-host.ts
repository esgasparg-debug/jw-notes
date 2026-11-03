import { Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { DialogService } from '../../../core/ui/dialog.service';
import { Modal } from '../modal/modal';

@Component({
  selector: 'app-confirm-host',
  imports: [Modal],
  template: `
    @let a = dialog.active();
    <app-modal [heading]="a?.title ?? ''" [open]="!!a" (closed)="dialog.cancel()">
      @if (a?.kind === 'confirm') {
        <p class="msg">{{ $any(a).message }}</p>
      } @else if (a?.kind === 'prompt') {
        <form (submit)="$event.preventDefault(); accept()">
          <label class="field">
            <span class="label">{{ $any(a).label }}</span>
            <input #field type="text" [value]="$any(a).value ?? ''" autofocus />
          </label>
        </form>
      }
      <ng-container modal-actions>
        <button type="button" class="btn" (click)="dialog.cancel()">Cancelar</button>
        <button type="button" class="btn" [class.danger-solid]="danger()" [class.primary]="!danger()" (click)="accept()">
          {{ a?.confirmLabel ?? 'Confirmar' }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .msg { margin: 0; white-space: pre-line; }
    .field { display: grid; gap: 4px; }
  `,
})
export class ConfirmHost {
  protected readonly dialog = inject(DialogService);
  protected readonly danger = computed(() => {
    const a = this.dialog.active();
    return a?.kind === 'confirm' && !!a.danger;
  });

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected accept(): void {
    this.dialog.accept(this.field()?.nativeElement.value);
  }
}
