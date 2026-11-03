import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { JwLibraryService } from '../../core/jwlibrary/jwlibrary.service';
import {
  DEFAULT_MERGE_REQUEST,
  MERGE_ENTITY_LABELS,
  MergeEntity,
  MergePreference,
  MergeReport,
} from '../../core/jwlibrary/merge/merge.models';
import { DocumentActions } from '../../core/state/document-actions.service';
import { DocumentStore } from '../../core/state/document.store';
import { LoadedFile } from '../../core/storage/storage.models';
import { FileDialogService } from '../../core/ui/file-dialog.service';
import { NotificationService } from '../../core/ui/notification.service';
import { FileSlot } from './file-slot';
import { MergeSummary } from './merge-summary';

@Component({
  selector: 'app-merge-page',
  imports: [FormsModule, FileSlot, MergeSummary],
  templateUrl: './merge-page.html',
  styleUrl: './merge-page.scss',
})
export class MergePage {
  private readonly jw = inject(JwLibraryService);
  private readonly store = inject(DocumentStore);
  private readonly actions = inject(DocumentActions);
  private readonly files = inject(FileDialogService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly a = signal<LoadedFile | null>(null);
  protected readonly b = signal<LoadedFile | null>(null);
  protected readonly prefer = signal<MergePreference>(DEFAULT_MERGE_REQUEST.prefer);
  protected readonly include = signal({ ...DEFAULT_MERGE_REQUEST.include });
  protected readonly report = signal<MergeReport | null>(null);

  protected readonly entities = Object.entries(MERGE_ENTITY_LABELS) as [MergeEntity, string][];

  protected async choose(slot: 'a' | 'b'): Promise<void> {
    const file = await this.files.openFile(`Escolher backup ${slot.toUpperCase()}`);
    if (!file) return;
    (slot === 'a' ? this.a : this.b).set(file);
    this.report.set(null);
  }

  protected swap(): void {
    const a = this.a();
    this.a.set(this.b());
    this.b.set(a);
    this.report.set(null);
  }

  protected toggle(entity: MergeEntity, on: boolean): void {
    this.include.update((inc) => ({ ...inc, [entity]: on }));
  }

  protected async merge(): Promise<void> {
    const a = this.a();
    const b = this.b();
    if (!a || !b) return;
    if (a.ref.providerId === b.ref.providerId && a.ref.id === b.ref.id) {
      this.notify.error('Escolha dois arquivos diferentes.');
      return;
    }
    if (!(await this.actions.confirmDiscard())) return;

    await this.store.withBusy('Mesclando backups…', async () => {
      const result = await this.jw.merge(a, b, { prefer: this.prefer(), include: this.include() });
      this.store.adopt(result.document, result.report);
      this.report.set(result.report);
    });
  }

  protected save(): Promise<boolean> {
    return this.actions.save();
  }

  protected review(): void {
    this.router.navigate(['/editor']);
  }
}
