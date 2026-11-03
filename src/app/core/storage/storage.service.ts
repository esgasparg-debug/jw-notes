import { Injectable, inject } from '@angular/core';
import { STORAGE_PROVIDERS, StorageProvider } from './storage-provider';
import { FileRef, StorageProviderId } from './storage.models';

/** Registry/facade over every configured storage provider. */
@Injectable({ providedIn: 'root' })
export class StorageService {
  readonly providers = inject(STORAGE_PROVIDERS);

  has(id: StorageProviderId | null | undefined): id is StorageProviderId {
    return this.providers.some((x) => x.id === id);
  }

  get(id: StorageProviderId): StorageProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new Error(`Provedor de armazenamento desconhecido: ${id}`);
    return p;
  }

  providerOf(ref: FileRef): StorageProvider {
    return this.get(ref.providerId);
  }
}
