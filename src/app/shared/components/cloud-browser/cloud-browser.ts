import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StorageProvider } from '../../../core/storage/storage-provider';
import { BrowserEntry, FileRef, FolderRef } from '../../../core/storage/storage.models';
import { errorMessage } from '../../../core/ui/notification.service';
import { FileSizePipe } from '../../pipes/file-size-pipe';
import { ShortDatePipe } from '../../pipes/short-date-pipe';

/** Folder browser + search for a cloud provider. Used both to pick a file and to pick a destination folder. */
@Component({
  selector: 'app-cloud-browser',
  imports: [FormsModule, FileSizePipe, ShortDatePipe],
  templateUrl: './cloud-browser.html',
  styleUrl: './cloud-browser.scss',
})
export class CloudBrowser {
  readonly provider = input.required<StorageProvider>();
  /** Folders to start in, root first (e.g. the folder of the file being edited). */
  readonly startPath = input<FolderRef[] | null>(null);
  readonly selectedFileId = input<string | null>(null);

  readonly fileChosen = output<FileRef>();
  readonly folderChange = output<FolderRef>();
  /** The whole breadcrumb to the current folder, root first. */
  readonly pathChange = output<FolderRef[]>();

  protected readonly path = signal<FolderRef[]>([]);
  protected readonly entries = signal<BrowserEntry[]>([]);
  protected readonly searchResults = signal<FileRef[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');

  protected readonly current = computed(() => this.path().at(-1));
  protected readonly folders = computed(() => this.entries().filter((e) => e.kind === 'folder').map((e) => e.ref as FolderRef));
  protected readonly files = computed(() => this.entries().filter((e) => e.kind === 'file').map((e) => e.ref as FileRef));

  constructor() {
    effect(() => {
      const provider = this.provider();
      const start = this.startPath();
      if (!provider.signedIn()) return;
      untracked(() => this.navigate(start?.length ? start : [provider.root()]));
    });
  }

  protected async navigate(path: FolderRef[]): Promise<void> {
    this.path.set(path);
    this.searchResults.set(null);
    this.folderChange.emit(path.at(-1)!);
    this.pathChange.emit(path);
    await this.load(() => this.provider().list(path.at(-1)!), (entries) => this.entries.set(entries));
  }

  protected open(folder: FolderRef): void {
    this.navigate([...this.path(), folder]);
  }

  protected up(index: number): void {
    this.navigate(this.path().slice(0, index + 1));
  }

  protected async search(): Promise<void> {
    await this.load(() => this.provider().search(this.query().trim()), (files) => this.searchResults.set(files));
  }

  protected clearSearch(): void {
    this.query.set('');
    this.searchResults.set(null);
  }

  private async load<T>(fetch: () => Promise<T>, apply: (v: T) => void): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      apply(await fetch());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
