import { Injectable, computed, inject, signal } from '@angular/core';
import { JwDocument, deriveFileName } from '../jwlibrary/jw-document';
import { JwLibraryService } from '../jwlibrary/jwlibrary.service';
import { MergeReport } from '../jwlibrary/merge/merge.models';
import { UserData } from '../jwlibrary/repositories/user-data';
import { StorageService } from '../storage/storage.service';
import { FileRef, LoadedFile, SaveTarget, StorageProviderId } from '../storage/storage.models';
import { NotificationService } from '../ui/notification.service';

/**
 * Single source of truth for the backup being edited. Components read signals from here and
 * change data only through `mutate()`, which bumps `revision` so every computed view refreshes.
 */
@Injectable({ providedIn: 'root' })
export class DocumentStore {
  private readonly jw = inject(JwLibraryService);
  private readonly storage = inject(StorageService);
  private readonly notify = inject(NotificationService);

  private readonly _document = signal<JwDocument | null>(null);
  private readonly _revision = signal(0);
  private readonly _dirty = signal(false);
  private readonly _busy = signal<string | null>(null);
  private readonly _mergeReport = signal<MergeReport | null>(null);

  readonly document = this._document.asReadonly();
  readonly revision = this._revision.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly busy = this._busy.asReadonly();
  /** Report of the merge that produced the current document, if any. */
  readonly mergeReport = this._mergeReport.asReadonly();

  readonly hasDocument = computed(() => this._document() !== null);
  readonly userData = computed<UserData | null>(() => this._document()?.userData ?? null);
  readonly stats = computed(() => {
    this._revision();
    return this._document()?.userData.stats() ?? null;
  });

  async open(file: LoadedFile): Promise<boolean> {
    return this.withBusy('Abrindo backup…', async () => {
      const doc = await this.jw.open(file);
      this.replace(doc, false, null);
      this.notify.success(`Aberto: ${file.ref.name}`);
    });
  }

  /** Takes ownership of an already-built document (e.g. a merge result) as an unsaved file. */
  adopt(doc: JwDocument, report: MergeReport | null): void {
    this.replace(doc, true, report);
  }

  /** Runs a data change against the open backup and refreshes all views. Returns false on error. */
  mutate(change: (data: UserData) => void, successMessage?: string): boolean {
    const data = this.userData();
    if (!data) return false;
    try {
      change(data);
      this._dirty.set(true);
      this._revision.update((r) => r + 1);
      if (successMessage) this.notify.success(successMessage);
      return true;
    } catch (e) {
      this.notify.error(e);
      return false;
    }
  }

  /** Suggested save location: same provider and folder as the opened file. */
  defaultSaveTarget(suffix: 'editado' | 'mesclado' = this._mergeReport() ? 'mesclado' : 'editado'): {
    providerId: StorageProviderId;
    source: FileRef | null;
    name: string;
  } {
    const doc = this._document();
    const source = doc?.source ?? null;
    return {
      providerId: source?.providerId ?? 'local',
      source,
      name: deriveFileName(doc?.name ?? 'UserdataBackup.jwlibrary', suffix),
    };
  }

  async save(providerId: StorageProviderId, target: SaveTarget): Promise<boolean> {
    const doc = this._document();
    if (!doc) return false;
    return this.withBusy('Salvando…', async () => {
      const bytes = await doc.toBytes(target.name);
      const ref = await this.storage.get(providerId).save(bytes, target);
      doc.source = ref;
      this._dirty.set(false);
      this._mergeReport.set(null);
      this._revision.update((r) => r + 1);
      this.notify.success(`Salvo: ${ref.name}`);
    });
  }

  close(): void {
    this.replace(null, false, null);
  }

  /** Shows a global progress indicator while `task` runs and reports failures. */
  async withBusy(label: string, task: () => Promise<void>): Promise<boolean> {
    this._busy.set(label);
    try {
      await task();
      return true;
    } catch (e) {
      this.notify.error(e);
      return false;
    } finally {
      this._busy.set(null);
    }
  }

  private replace(doc: JwDocument | null, dirty: boolean, report: MergeReport | null): void {
    this._document()?.close();
    this._document.set(doc);
    this._dirty.set(dirty);
    this._mergeReport.set(report);
    this._revision.update((r) => r + 1);
  }
}
