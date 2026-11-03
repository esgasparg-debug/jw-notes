import { NotifyRequest } from '../app/core/sync/sync-notifier';

/** Records what would be pushed to the other devices. */
export class FakeSyncNotifier {
  readonly enabled = true;
  readonly sent: NotifyRequest[] = [];

  async notify(request: NotifyRequest): Promise<void> {
    if (request.targets.length) this.sent.push(request);
  }
}
