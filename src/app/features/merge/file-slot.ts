import { Component, computed, inject, input, output } from '@angular/core';
import { StorageService } from '../../core/storage/storage.service';
import { LoadedFile } from '../../core/storage/storage.models';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';
import { ShortDatePipe } from '../../shared/pipes/short-date-pipe';

/** One of the two inputs of a merge: shows the chosen backup or a button to pick one. */
@Component({
  selector: 'app-file-slot',
  imports: [FileSizePipe, ShortDatePipe],
  template: `
    <span class="badge">{{ letter() }}</span>
    @if (file(); as f) {
      <div class="info">
        <strong class="name">{{ f.ref.name }}</strong>
        <span class="muted">
          <span class="material-symbols-rounded">{{ provider()?.icon }}</span>
          {{ provider()?.label }}
          @if (f.ref.parentName) {
            › {{ f.ref.parentName }}
          }
        </span>
        <span class="muted small">{{ f.ref.modifiedAt | shortDate }} · {{ f.bytes.byteLength | fileSize }}</span>
      </div>
      <button type="button" class="btn" (click)="choose.emit()">Trocar</button>
    } @else {
      <div class="info">
        <strong>{{ title() }}</strong>
        <span class="muted">Do dispositivo ou do Google Drive</span>
      </div>
      <button type="button" class="btn primary" (click)="choose.emit()">Escolher</button>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 600;
      font-size: 1.1rem;
    }
    .info {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .small {
      font-size: 0.8rem;
    }
    .material-symbols-rounded {
      font-size: 16px;
    }
  `,
})
export class FileSlot {
  readonly letter = input.required<string>();
  readonly title = input.required<string>();
  readonly file = input<LoadedFile | null>(null);
  readonly choose = output<void>();

  private readonly storage = inject(StorageService);
  protected readonly provider = computed(() => {
    const f = this.file();
    return f ? this.storage.get(f.ref.providerId) : null;
  });
}
