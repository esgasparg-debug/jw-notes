import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { DocumentActions } from './core/state/document-actions.service';
import { DocumentStore } from './core/state/document.store';
import { SyncFlow } from './core/sync/sync-flow';
import { SyncService } from './core/sync/sync.service';
import { OpenFileDialog } from './shared/components/file-dialogs/open-file-dialog';
import { SaveFileDialog } from './shared/components/file-dialogs/save-file-dialog';
import { BusyOverlay } from './shared/components/overlays/busy-overlay';
import { ConfirmHost } from './shared/components/overlays/confirm-host';
import { ToastHost } from './shared/components/overlays/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OpenFileDialog, SaveFileDialog, ConfirmHost, ToastHost, BusyOverlay],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class App {
  protected readonly store = inject(DocumentStore);
  protected readonly actions = inject(DocumentActions);
  protected readonly sync = inject(SyncService);
  private readonly flow = inject(SyncFlow);
  private readonly router = inject(Router);

  /** The first screen is just the Sincronizar button: the header there shows only the way to "Mais opções". */
  protected readonly isHome = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0] === '/'),
    ),
    { initialValue: true },
  );

  /** Goes back to the first screen (status lives there) and runs the next sync step right away. */
  protected syncNow(): void {
    // Start before navigating: Google's sign-in popup is only allowed while the click is still "fresh".
    void this.flow.run();
    void this.router.navigate(['/']);
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.store.dirty()) e.preventDefault();
  }
}
