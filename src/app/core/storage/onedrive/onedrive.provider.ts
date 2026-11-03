import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { JWLIBRARY_MIME, StorageProvider, isJwLibraryName } from '../storage-provider';
import { BrowserEntry, Bytes, FileRef, FolderRef, LoadedFile, SaveTarget } from '../storage.models';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const SCOPES = ['Files.ReadWrite', 'User.Read'];
const SELECT = 'id,name,size,lastModifiedDateTime,folder,file,parentReference';
/** Graph's simple upload accepts up to 4 MB; larger files go through an upload session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload session chunks must be multiples of 320 KiB. */
const CHUNK = 320 * 1024 * 10;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: unknown;
  parentReference?: { id?: string; path?: string };
  '@microsoft.graph.downloadUrl'?: string;
}
interface Page<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

@Injectable({ providedIn: 'root' })
export class OneDriveProvider implements StorageProvider {
  readonly id = 'onedrive' as const;
  readonly label = 'OneDrive';
  readonly icon = 'cloud';
  readonly browsable = true;
  readonly available = !!environment.oneDrive.clientId;
  readonly unavailableReason = 'Configure oneDrive.clientId em src/environments.';

  private readonly http = inject(HttpClient);
  private readonly _signedIn = signal(false);
  readonly signedIn = this._signedIn.asReadonly();

  private msal?: Promise<PublicClientApplication>;
  private account?: AccountInfo;

  async signIn(): Promise<void> {
    const app = await this.app();
    const res = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
    this.account = res.account;
    this._signedIn.set(true);
  }

  async signOut(): Promise<void> {
    const app = await this.app();
    if (this.account) await app.logoutPopup({ account: this.account });
    this.account = undefined;
    this._signedIn.set(false);
  }

  root(): FolderRef {
    return { id: 'root', name: 'OneDrive' };
  }

  async list(folder: FolderRef): Promise<BrowserEntry[]> {
    const path = folder.id === 'root' ? '/root/children' : `/items/${folder.id}/children`;
    const items = await this.pages(`${GRAPH}${path}?$select=${SELECT}&$top=200&$orderby=name`);
    return items
      .filter((i) => i.folder || isJwLibraryName(i.name))
      .map((i) =>
        i.folder ? { kind: 'folder' as const, ref: { id: i.id, name: i.name } } : { kind: 'file' as const, ref: this.toRef(i, folder) },
      );
  }

  async search(query: string): Promise<FileRef[]> {
    const q = encodeURIComponent((query || 'jwlibrary').replace(/'/g, "''"));
    const items = await this.pages(`${GRAPH}/root/search(q='${q}')?$select=${SELECT}&$top=200`);
    return items.filter((i) => i.file && isJwLibraryName(i.name)).map((i) => this.toRef(i));
  }

  async read(ref: FileRef): Promise<LoadedFile> {
    const headers = await this.auth();
    // The pre-authenticated download URL avoids sending our token across the redirect.
    const item = await firstValueFrom(
      this.http.get<DriveItem>(`${GRAPH}/items/${ref.id}?$select=id,@microsoft.graph.downloadUrl`, { headers }),
    );
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('O OneDrive não retornou um link de download para este arquivo.');
    const buf = await firstValueFrom(this.http.get(url, { responseType: 'arraybuffer' }));
    return { ref, bytes: new Uint8Array(buf) };
  }

  async save(bytes: Bytes, target: SaveTarget): Promise<FileRef> {
    const folder = target.folder ?? this.root();
    const name = encodeURIComponent(target.name);
    const base = target.overwrite
      ? `${GRAPH}/items/${target.overwrite.id}`
      : folder.id === 'root'
        ? `${GRAPH}/root:/${name}:`
        : `${GRAPH}/items/${folder.id}:/${name}:`;

    const item =
      bytes.byteLength <= SIMPLE_UPLOAD_LIMIT
        ? await firstValueFrom(
            this.http.put<DriveItem>(`${base}/content?@microsoft.graph.conflictBehavior=rename`, new Blob([bytes]), {
              headers: (await this.auth()).set('Content-Type', JWLIBRARY_MIME),
            }),
          )
        : await this.uploadSession(base, bytes);
    return this.toRef(item, folder);
  }

  private async uploadSession(base: string, bytes: Bytes): Promise<DriveItem> {
    const headers = await this.auth();
    const { uploadUrl } = await firstValueFrom(
      this.http.post<{ uploadUrl: string }>(
        `${base}/createUploadSession`,
        { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
        { headers },
      ),
    );
    let last: DriveItem | undefined;
    for (let start = 0; start < bytes.byteLength; start += CHUNK) {
      const end = Math.min(start + CHUNK, bytes.byteLength);
      // The upload URL is pre-authenticated; Graph rejects an Authorization header here.
      last = await firstValueFrom(
        this.http.put<DriveItem>(uploadUrl, new Blob([bytes.subarray(start, end)]), {
          headers: new HttpHeaders({ 'Content-Range': `bytes ${start}-${end - 1}/${bytes.byteLength}` }),
        }),
      );
    }
    if (!last?.id) throw new Error('Upload para o OneDrive não foi concluído.');
    return last;
  }

  private async pages(url: string): Promise<DriveItem[]> {
    const headers = await this.auth();
    const out: DriveItem[] = [];
    let next: string | undefined = url;
    while (next) {
      const page: Page<DriveItem> = await firstValueFrom(this.http.get<Page<DriveItem>>(next, { headers }));
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  private toRef(i: DriveItem, folder?: FolderRef): FileRef {
    return {
      providerId: this.id,
      id: i.id,
      name: i.name,
      parentId: folder?.id ?? i.parentReference?.id,
      parentName: folder?.name ?? i.parentReference?.path?.split('/').pop(),
      modifiedAt: i.lastModifiedDateTime,
      size: i.size,
    };
  }

  private async auth(): Promise<HttpHeaders> {
    const app = await this.app();
    this.account ??= app.getAllAccounts()[0];
    if (!this.account) await this.signIn();
    let token: string;
    try {
      token = (await app.acquireTokenSilent({ scopes: SCOPES, account: this.account! })).accessToken;
    } catch {
      token = (await app.acquireTokenPopup({ scopes: SCOPES, account: this.account })).accessToken;
    }
    this._signedIn.set(true);
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  /** MSAL is loaded lazily so users who never touch OneDrive don't download it. */
  private app(): Promise<PublicClientApplication> {
    if (!this.available) return Promise.reject(new Error(this.unavailableReason));
    this.msal ??= import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
      const app = new PublicClientApplication({
        auth: {
          clientId: environment.oneDrive.clientId,
          authority: environment.oneDrive.authority,
          // Blank page so the popup doesn't boot the whole app (register this exact URI in Azure).
          redirectUri: `${window.location.origin}/auth-redirect.html`,
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      return app;
    });
    return this.msal;
  }
}
