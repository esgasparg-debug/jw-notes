import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { DriveApi } from './core/storage/google-drive/drive-api';
import { GoogleDriveApi } from './core/storage/google-drive/google-drive-api';
import { GoogleDriveProvider } from './core/storage/google-drive/google-drive.provider';
import { LocalStorageProvider } from './core/storage/local/local-storage.provider';
import { STORAGE_PROVIDERS } from './core/storage/storage-provider';
import { SharedBackupReceiver } from './core/sync/shared-backup-receiver';
import { SyncAlerts } from './core/sync/sync-alerts';
import { SyncService } from './core/sync/sync.service';

// Zoneless (Angular's default since v21): change detection is driven by signals and events.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    { provide: DriveApi, useExisting: GoogleDriveApi },
    // Order here is the order shown in the open/save dialogs.
    // OneDriveProvider is temporarily hidden; add inject(OneDriveProvider) back here to re-enable it.
    {
      provide: STORAGE_PROVIDERS,
      useFactory: () => [inject(LocalStorageProvider), inject(GoogleDriveProvider)],
    },
    // Load the shared settings in the background when a Google session is still valid; never blocks startup.
    // On Android, also listen for backups shared from JW Library; everywhere, watch the sync rounds.
    provideAppInitializer(() => {
      void inject(SyncService).restore();
      void inject(SharedBackupReceiver).start();
      inject(SyncAlerts).start();
    }),
  ],
};
