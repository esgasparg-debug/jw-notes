import { Directive, output, signal } from '@angular/core';

/** Emits the first file dropped on the host element and toggles a `.drag-over` class while dragging. */
@Directive({
  selector: '[appFileDrop]',
  host: {
    '[class.drag-over]': 'over()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'over.set(false)',
    '(drop)': 'onDrop($event)',
  },
})
export class FileDrop {
  readonly fileDropped = output<File>();
  protected readonly over = signal(false);

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.over.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.fileDropped.emit(file);
  }
}
