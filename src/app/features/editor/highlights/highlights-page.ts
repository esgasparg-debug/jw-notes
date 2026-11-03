import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HIGHLIGHT_COLORS, highlightCss, publicationName } from '../../../core/jwlibrary/models/location-format';
import { HighlightItem } from '../../../core/jwlibrary/models/userdata.models';
import { DocumentStore } from '../../../core/state/document.store';
import { DialogService } from '../../../core/ui/dialog.service';

interface HighlightGroup {
  id: number;
  label: string;
  publication: string;
  items: HighlightItem[];
}

@Component({
  selector: 'app-highlights-page',
  imports: [FormsModule],
  templateUrl: './highlights-page.html',
  styleUrl: './highlights-page.scss',
})
export class HighlightsPage {
  private readonly store = inject(DocumentStore);
  private readonly dialogs = inject(DialogService);

  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly css = highlightCss;
  protected readonly color = signal<number | null>(null);
  protected readonly publication = signal<string | null>(null);

  private readonly data = computed(() => {
    this.store.revision();
    return this.store.userData();
  });

  protected readonly publications = computed(() =>
    (this.data()?.highlights.publications() ?? []).map((k) => ({ key: k, name: publicationName(k) })),
  );

  protected readonly groups = computed<HighlightGroup[]>(() => {
    const items = this.data()?.highlights.list({ color: this.color(), publication: this.publication() }) ?? [];
    const groups = new Map<number, HighlightGroup>();
    for (const h of items) {
      let g = groups.get(h.location.id);
      if (!g)
        groups.set(h.location.id, (g = { id: h.location.id, label: h.location.label, publication: h.location.publication, items: [] }));
      g.items.push(h);
    }
    return [...groups.values()];
  });

  protected readonly total = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));

  protected setColor(h: HighlightItem, colorIndex: number): void {
    if (h.colorIndex !== colorIndex) this.store.mutate((d) => d.highlights.setColor(h.id, colorIndex));
  }

  protected async remove(h: HighlightItem): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir marcação',
      message: h.noteCount
        ? `Esta marcação tem ${h.noteCount} nota(s). As notas serão mantidas, apenas desvinculadas da marcação.`
        : 'A marcação será removida deste backup.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok) this.store.mutate((d) => d.highlights.delete(h.id), 'Marcação excluída');
  }

  protected rangeLabel(h: HighlightItem): string {
    const paragraphs = new Set(h.ranges.map((r) => r.identifier));
    const kind = h.ranges[0]?.blockType === 2 ? 'versículo' : 'parágrafo';
    return paragraphs.size ? `${kind}${paragraphs.size > 1 ? 's' : ''} ${[...paragraphs].join(', ')}` : '';
  }
}
