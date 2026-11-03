import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { readPreference, writePreference } from '../../../shared/utils/preferences';
import { loadScript } from '../../../shared/utils/load-script';
import { PlatformService } from '../../platform/platform.service';
import { Bytes } from '../storage.models';
import { DriveApi, DriveFile, DriveFileMeta, FOLDER_MIME } from './drive-api';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/**
 * Full Drive access: sync must read and move backups that the phones' Drive app uploaded,
 * which narrower scopes (drive.file) cannot see. It is a "restricted" scope: fine for up to
 * 100 test users in Testing mode; publishing to everyone requires Google's verification.
 */
const SCOPES = 'https://www.googleapis.com/auth/drive';
const FIELDS = 'id,name,mimeType,modifiedTime,size,parents,appProperties';
const SESSION_KEY = 'google.session';
const NATIVE_TOKEN_TTL_MS = 55 * 60_000;
/** A cached Android token with less than this left is replaced right away. */
const MIN_NATIVE_TOKEN_MS = 10 * 60_000;
const TOKEN_INFO = 'https://oauth2.googleapis.com/tokeninfo';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string }): void;
  callback: (r: TokenResponse) => void;
}
interface GoogleOAuth2 {
  initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void }): TokenClient;
  revoke(token: string, done: () => void): void;
}
declare const google: { accounts: { oauth2: GoogleOAuth2 } };

/** Google Drive REST v3 client with Google Identity Services sign-in. */
@Injectable({ providedIn: 'root' })
export class GoogleDriveApi extends DriveApi {
  readonly available = !!environment.googleDrive.clientId;
  readonly unavailableReason = 'Configure googleDrive.clientId em src/environments.';

  private readonly http = inject(HttpClient);
  /** Android signs in through Google Play Services (see GoogleDriveAuthPlugin.java). */
  private readonly native = inject(PlatformService).platform === 'android';
  private readonly _signedIn = signal(false);
  readonly signedIn = this._signedIn.asReadonly();

  private token?: string;
  private tokenExpiresAt = 0;
  private client?: TokenClient;

  async signIn(): Promise<void> {
    await this.ensureToken();
  }

  async signOut(): Promise<void> {
    if (this.native && this.token) {
      const { GoogleDriveAuth } = await import('../../platform/android-plugins');
      await GoogleDriveAuth.clearToken({ accessToken: this.token }).catch(() => undefined);
    } else if (this.token && typeof google !== 'undefined') google.accounts.oauth2.revoke(this.token, () => undefined);
    this.setSession(undefined, 0);
  }

  restoreSession(): boolean {
    // Preload Google's sign-in script so a later click can open the popup immediately
    // (browsers block popups that open too long after the click).
    if (this.available && !this.native) loadScript(GIS_SRC).catch(() => undefined);
    const saved = readPreference<{ token: string; expiresAt: number }>(SESSION_KEY);
    if (!this.available || !saved || Date.now() > saved.expiresAt - 60_000) return false;
    this.setSession(saved.token, saved.expiresAt);
    return true;
  }

  listChildren(folderId: string): Promise<DriveFile[]> {
    return this.query(`'${escapeQ(folderId)}' in parents and trashed = false`, 'folder,name');
  }

  async findChild(folderId: string, name: string, kind: 'file' | 'folder'): Promise<DriveFile | undefined> {
    const type = kind === 'folder' ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`;
    const q = `'${escapeQ(folderId)}' in parents and name = '${escapeQ(name)}' and ${type} and trashed = false`;
    return (await this.query(q, 'createdTime'))[0];
  }

  search(text: string): Promise<DriveFile[]> {
    // "contains" matches word prefixes; callers filter by extension.
    return this.query(`name contains '${escapeQ(text)}' and mimeType != '${FOLDER_MIME}' and trashed = false`, 'modifiedTime desc');
  }

  async download(fileId: string): Promise<Bytes> {
    const buf = await this.authorized((headers) =>
      this.http.get(`${API}/files/${fileId}`, { headers, params: { alt: 'media' }, responseType: 'arraybuffer' }),
    );
    return new Uint8Array(buf);
  }

  async create(folderId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile> {
    return this.upload('post', `${UPLOAD}/files`, { ...meta, parents: [folderId] }, content);
  }

  async update(fileId: string, meta: DriveFileMeta, content: Blob): Promise<DriveFile> {
    return this.upload('patch', `${UPLOAD}/files/${fileId}`, meta, content);
  }

  async createFolder(parentId: string, name: string): Promise<DriveFile> {
    return this.authorized((headers) =>
      this.http.post<DriveFile>(
        `${API}/files`,
        { name, mimeType: FOLDER_MIME, parents: [parentId] },
        { headers, params: { fields: FIELDS } },
      ),
    );
  }

  async move(fileId: string, fromFolderId: string, toFolderId: string): Promise<DriveFile> {
    const params = new HttpParams().set('addParents', toFolderId).set('removeParents', fromFolderId).set('fields', FIELDS);
    return this.authorized((headers) => this.http.patch<DriveFile>(`${API}/files/${fileId}`, {}, { headers, params }));
  }

  async trash(fileId: string): Promise<void> {
    await this.authorized((headers) =>
      this.http.patch(`${API}/files/${fileId}`, { trashed: true }, { headers, params: { fields: 'id' } }),
    );
  }

  async accessToken(): Promise<string> {
    await this.ensureToken();
    return this.token!;
  }

  private async upload(method: 'post' | 'patch', url: string, metadata: object, content: Blob): Promise<DriveFile> {
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    body.append('file', content);
    const params = new HttpParams().set('uploadType', 'multipart').set('fields', FIELDS);
    return this.authorized((headers) => this.http.request<DriveFile>(method.toUpperCase(), url, { body, headers, params }));
  }

  private async query(q: string, orderBy: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      let params = new HttpParams()
        .set('q', q)
        .set('orderBy', orderBy)
        .set('pageSize', 200)
        .set('fields', `nextPageToken,files(${FIELDS})`)
        .set('spaces', 'drive');
      if (pageToken) params = params.set('pageToken', pageToken);
      const res = await this.authorized((headers) =>
        this.http.get<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files`, { headers, params }),
      );
      out.push(...res.files);
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * Sends a request with the current token. A 401 means the token expired before we expected
   * (Play Services may hand back a cached token issued long ago), so it is dropped, a fresh one
   * obtained and the request sent once more.
   */
  private async authorized<T>(request: (headers: HttpHeaders) => Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request(await this.auth()));
    } catch (e) {
      if (!(e instanceof HttpErrorResponse) || e.status !== 401) throw e;
      await this.dropToken();
      return firstValueFrom(request(await this.auth()));
    }
  }

  private async auth(): Promise<HttpHeaders> {
    await this.ensureToken();
    return new HttpHeaders({ Authorization: `Bearer ${this.token}` });
  }

  /** Forgets the token here and, on Android, in Play Services' cache, so the next one is fresh. */
  private async dropToken(): Promise<void> {
    if (this.native && this.token) {
      const { GoogleDriveAuth } = await import('../../platform/android-plugins');
      await GoogleDriveAuth.clearToken({ accessToken: this.token }).catch(() => undefined);
    }
    this.token = undefined;
    this.tokenExpiresAt = 0;
  }

  private async ensureToken(): Promise<void> {
    if (!this.available) throw new Error(this.unavailableReason);
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return;
    if (this.native) return this.ensureNativeToken();
    await loadScript(GIS_SRC);
    this.client ??= google.accounts.oauth2.initTokenClient({
      client_id: environment.googleDrive.clientId,
      scope: SCOPES,
      callback: () => undefined,
    });
    const res = await new Promise<TokenResponse>((resolve) => {
      this.client!.callback = resolve;
      // After the first consent Google skips the consent screen and just closes the popup.
      this.client!.requestAccessToken({ prompt: '' });
    });
    if (res.error || !res.access_token) throw new Error(`Login no Google falhou: ${res.error ?? 'sem token'}`);
    this.setSession(res.access_token, Date.now() + res.expires_in * 1000);
  }

  /** Android: Google blocks its sign-in page inside WebViews, so Play Services provides the token. */
  private async ensureNativeToken(): Promise<void> {
    const { GoogleDriveAuth } = await import('../../platform/android-plugins');
    let { accessToken } = await GoogleDriveAuth.authorize({ scopes: [SCOPES] });
    // Play Services does not report the expiry and may hand back a cached token issued long ago.
    let left = await tokenLifetime(accessToken);
    if (left !== undefined && left < MIN_NATIVE_TOKEN_MS) {
      await GoogleDriveAuth.clearToken({ accessToken }).catch(() => undefined);
      ({ accessToken } = await GoogleDriveAuth.authorize({ scopes: [SCOPES] }));
      left = await tokenLifetime(accessToken);
    }
    this.setSession(accessToken, Date.now() + (left ?? NATIVE_TOKEN_TTL_MS));
  }

  /** Access tokens last ~1 hour; keeping it lets a reload within that hour skip the popup. */
  private setSession(token: string | undefined, expiresAt: number): void {
    this.token = token;
    this.tokenExpiresAt = expiresAt;
    writePreference(SESSION_KEY, token ? { token, expiresAt } : null);
    this._signedIn.set(!!token);
  }
}

/** How long a Google access token still lasts, in ms; undefined when Google cannot tell. */
async function tokenLifetime(token: string): Promise<number | undefined> {
  try {
    const res = await fetch(`${TOKEN_INFO}?access_token=${encodeURIComponent(token)}`);
    const seconds = res.ok ? Number((await res.json()).expires_in) : NaN;
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function escapeQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
