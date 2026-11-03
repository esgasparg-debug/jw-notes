import { Component, computed, input } from '@angular/core';
import { MERGE_ENTITY_LABELS, MergeEntity, MergeReport } from '../../core/jwlibrary/merge/merge.models';

const RESOLUTION_LABELS = {
  'kept-target': 'mantida a versão do arquivo base',
  'took-source': 'usada a versão do outro arquivo',
  'kept-both': 'mantidas as duas',
} as const;

@Component({
  selector: 'app-merge-summary',
  templateUrl: './merge-summary.html',
  styleUrl: './merge-summary.scss',
})
export class MergeSummary {
  readonly report = input.required<MergeReport>();

  protected readonly resolutionLabels = RESOLUTION_LABELS;

  protected readonly rows = computed(() =>
    (Object.keys(MERGE_ENTITY_LABELS) as MergeEntity[]).map((key) => ({
      key,
      label: MERGE_ENTITY_LABELS[key],
      ...this.report().counters[key],
    })),
  );

  protected readonly totalAdded = computed(() => this.rows().reduce((n, r) => n + r.added, 0));

  protected label(entity: MergeEntity): string {
    return MERGE_ENTITY_LABELS[entity];
  }
}
