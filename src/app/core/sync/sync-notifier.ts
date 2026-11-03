import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DriveApi } from '../storage/google-drive/drive-api';

/**
 * - backup-requested: a device sent its backup; the others are asked to send theirs.
 * - sync-ready: everything was merged; each device should update its JW Library.
 */
export type SyncEvent = 'backup-requested' | 'sync-ready';

export interface NotifyRequest {
  event: SyncEvent;
  /** Device id of the sender. */
  from: string;
  /** Device ids to notify. */
  targets: string[];
  /** jw-notes/config/aparelhos: the relay reads the push tokens from there with the user's own token. */
  devicesFolderId: string;
}

/**
 * Asks the notification relay (functions/, a Firebase Cloud Function) to push a message to the
 * user's other devices. The relay never sees backups: it only reads the device list in the
 * user's Drive, with the user's token, and forwards the message through Firebase Cloud Messaging.
 */
@Injectable({ providedIn: 'root' })
export class SyncNotifier {
  private readonly http = inject(HttpClient);
  private readonly api = inject(DriveApi);
  readonly enabled = !!environment.notifyUrl;

  /** Best effort: a notification that fails to go out must never fail the sync itself. */
  async notify(request: NotifyRequest): Promise<void> {
    if (!this.enabled || !request.targets.length) return;
    try {
      const headers = new HttpHeaders({ Authorization: `Bearer ${await this.api.accessToken()}` });
      await firstValueFrom(this.http.post(environment.notifyUrl, request, { headers }));
    } catch (e) {
      console.warn('Aviso aos outros aparelhos não enviado', e);
    }
  }
}
