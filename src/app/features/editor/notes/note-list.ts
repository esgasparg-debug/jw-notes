import { Component, input, output } from '@angular/core';
import { highlightCss } from '../../../core/jwlibrary/models/location-format';
import { NoteItem } from '../../../core/jwlibrary/models/userdata.models';
import { ShortDatePipe } from '../../../shared/pipes/short-date-pipe';

@Component({
  selector: 'app-note-list',
  imports: [ShortDatePipe],
  template: `
    <ul class="list">
      @for (n of notes(); track n.id) {
        <li>
          <button type="button" class="item" [class.selected]="n.id === selectedId()" (click)="selected.emit(n.id)">
            <span class="title">
              @if (n.highlightColor) {
                <span class="dot" [style.background]="color(n.highlightColor)"></span>
              }
              {{ n.title || '(sem título)' }}
            </span>
            <span class="excerpt">{{ n.content }}</span>
            <span class="meta">{{ n.location?.label ?? 'Nota avulsa' }} · {{ n.lastModified | shortDate }}</span>
            @if (n.tags.length) {
              <span class="tags">
                @for (t of n.tags; track t.id) {
                  <span class="chip">{{ t.name }}</span>
                }
              </span>
            }
          </button>
        </li>
      } @empty {
        <li class="empty muted">Nenhuma nota encontrada.</li>
      }
    </ul>
  `,
  styleUrl: './note-list.scss',
})
export class NoteList {
  readonly notes = input.required<NoteItem[]>();
  readonly selectedId = input<number | null>(null);
  readonly selected = output<number>();

  protected readonly color = highlightCss;
}
