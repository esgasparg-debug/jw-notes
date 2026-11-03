import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/** Accessible modal built on the native <dialog> element (focus trap, Esc to close, backdrop). */
@Component({
  selector: 'app-modal',
  template: `
    <dialog #dlg class="modal" [class.wide]="wide()" (cancel)="$event.preventDefault(); closed.emit()" (click)="onBackdrop($event)">
      <header class="modal-head">
        <h2>{{ heading() }}</h2>
        <button type="button" class="icon-btn" aria-label="Fechar" (click)="closed.emit()">
          <span class="material-symbols-rounded">close</span>
        </button>
      </header>
      <div class="modal-body"><ng-content /></div>
      <footer class="modal-foot"><ng-content select="[modal-actions]" /></footer>
    </dialog>
  `,
  styleUrl: './modal.scss',
})
export class Modal {
  readonly heading = input.required<string>();
  readonly open = input(false);
  readonly wide = input(false);
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.open() && !el.open) el.showModal();
      else if (!this.open() && el.open) el.close();
    });
  }

  onBackdrop(e: MouseEvent): void {
    if (e.target === this.dialog().nativeElement) this.closed.emit();
  }
}
