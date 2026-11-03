import { Injectable, inject } from '@angular/core';
import { Bytes, LoadedFile } from '../storage/storage.models';
import { errorMessage } from '../ui/notification.service';
import { DEFAULT_THUMBNAIL_NAME, defaultThumbnail } from './archive/default-thumbnail';
import { JwManifest, isoNow, readArchive, writeArchive } from './archive/jwlibrary-archive';
import { applyWal } from './archive/sqlite-wal';
import { SqlJsService } from './database/sql-js.service';
import { JwDocument } from './jw-document';
import { LiveDatabase, backupFileName, localDate, safeDeviceName } from './live/local-jwlibrary';
import { mergeUserData } from './merge/merge-engine';
import { ConflictPolicy, DEFAULT_MERGE_REQUEST, MergeReport, MergeRequest, accumulateReport, emptyReport } from './merge/merge.models';
import { UserData } from './repositories/user-data';

export interface MergeResult {
  document: JwDocument;
  report: MergeReport;
  /** Which input became the base of the merged file (the one with the newer schema, or A on a tie). */
  base: 'a' | 'b';
}

export interface MergeAllResult {
  document: JwDocument;
  report: MergeReport;
  /** Inputs that made it into the result. */
  merged: LoadedFile[];
  /** Inputs that could not be read as JW Library backups. */
  skipped: { file: LoadedFile; error: string }[];
}

/** A backup made from JW Library's live database. */
export interface LiveBackup {
  name: string;
  bytes: Bytes;
  /** The database's LastModified: tells whether anything changed since the previous backup. */
  lastModified: string;
  /** Committed WAL frames folded into userData.db. */
  walFrames: number;
}

/** Opens, serialises and merges JW Library backups. Stateless: callers own the returned documents. */
@Injectable({ providedIn: 'root' })
export class JwLibraryService {
  private readonly sql = inject(SqlJsService);

  async open(file: LoadedFile): Promise<JwDocument> {
    const archive = await readArchive(file.bytes);
    const db = await this.sql.open(archive.database);
    if (!db.hasTable('Note') || !db.hasTable('Location')) {
      db.close();
      throw new Error('Este arquivo não parece ser um backup de dados do JW Library.');
    }
    return new JwDocument(archive, new UserData(db), file.ref);
  }

  /**
   * Builds a `.jwlibrary` file from JW Library's live database, laid out like the app's own
   * "Criar backup": userData.db (WAL folded in), default_thumbnail.png and manifest.json with
   * the database's hash, schema version and LastModified.
   */
  async createBackup(live: LiveDatabase, now = new Date()): Promise<LiveBackup> {
    const { bytes: database, appliedFrames } = applyWal(live.database, live.wal);
    const db = await this.sql.open(database);
    let lastModified: string;
    let schemaVersion: number;
    try {
      if (!db.hasTable('Note') || !db.hasTable('Location')) throw new Error('O arquivo encontrado não é o banco de dados do JW Library.');
      // A copy taken while JW Library was writing can be torn; never upload one.
      if (db.scalar<string>('PRAGMA quick_check') !== 'ok')
        throw new Error('O JW Library estava gravando dados. Tente de novo em alguns segundos.');
      const userData = new UserData(db);
      lastModified = userData.lastModified() ?? isoNow();
      schemaVersion = userData.schemaVersion() ?? 0;
    } finally {
      db.close();
    }

    const name = backupFileName(now, live.deviceName);
    const deviceName = safeDeviceName(live.deviceName);
    const manifest: JwManifest = {
      name,
      creationDate: localDate(now),
      version: 1,
      type: 0,
      userDataBackup: { lastModifiedDate: lastModified, deviceName, databaseName: 'userData.db', hash: '', schemaVersion },
    };
    const attachments = new Map([[DEFAULT_THUMBNAIL_NAME, defaultThumbnail()]]);
    const bytes = await writeArchive(
      { manifest, database, attachments },
      { fileName: name, deviceName, modifiedAt: lastModified, creationDate: manifest.creationDate },
    );
    return { name, bytes, lastModified, walFrames: appliedFrames };
  }

  /**
   * Merges A and B into a new, unsaved document. Neither input file is modified.
   * The input with the newer database schema becomes the base so no columns are lost.
   */
  async merge(a: LoadedFile, b: LoadedFile, request: MergeRequest): Promise<MergeResult> {
    const [docA, docB] = await Promise.all([this.open(a), this.open(b)]);
    const base = (docB.userData.schemaVersion() ?? 0) > (docA.userData.schemaVersion() ?? 0) ? 'b' : 'a';
    const [target, source] = base === 'a' ? [docA, docB] : [docB, docA];
    try {
      const report = mergeUserData(target.userData.db, source.userData.db, {
        conflictPolicy: toPolicy(request.prefer, base),
        include: request.include,
      });
      copyMedia(target, source, report.mediaFiles);
      // Point at file A so "save" defaults to A's cloud folder and name.
      target.source = a.ref;
      return { document: target, report, base };
    } catch (e) {
      target.close();
      throw e;
    } finally {
      source.close();
    }
  }

  /**
   * Merges any number of backups into one new document, keeping the newest version of
   * conflicting items. Unreadable inputs are skipped and reported instead of failing the run.
   * The base is the input with the newest schema (ties: the first one); the rest are applied
   * from oldest to newest, so later edits win.
   */
  async mergeAll(files: LoadedFile[]): Promise<MergeAllResult> {
    const opened: { file: LoadedFile; doc: JwDocument }[] = [];
    const skipped: MergeAllResult['skipped'] = [];
    for (const file of files) {
      try {
        opened.push({ file, doc: await this.open(file) });
      } catch (e) {
        skipped.push({ file, error: errorMessage(e) });
      }
    }
    if (!opened.length) throw new Error('Nenhum dos arquivos é um backup válido do JW Library.');

    const schema = (d: JwDocument) => d.userData.schemaVersion() ?? 0;
    const modified = (d: JwDocument) => d.userData.lastModified() ?? '';
    const base = opened.reduce((best, o) => (schema(o.doc) > schema(best.doc) ? o : best));
    const rest = opened.filter((o) => o !== base).sort((x, y) => modified(x.doc).localeCompare(modified(y.doc)));

    const report = emptyReport();
    const pending = [...rest];
    try {
      while (pending.length) {
        const { doc } = pending.shift()!;
        try {
          accumulateReport(
            report,
            mergeUserData(base.doc.userData.db, doc.userData.db, { conflictPolicy: 'newest', include: DEFAULT_MERGE_REQUEST.include }),
          );
          copyMedia(base.doc, doc, report.mediaFiles);
          // Advance the base's file date so the next input is compared against the newest state.
          if (modified(doc) > modified(base.doc)) base.doc.userData.touch(modified(doc));
        } finally {
          doc.close();
        }
      }
    } catch (e) {
      base.doc.close();
      pending.forEach((o) => o.doc.close());
      throw e;
    }
    return { document: base.doc, report, merged: opened.map((o) => o.file), skipped };
  }
}

function copyMedia(target: JwDocument, source: JwDocument, paths: string[]): void {
  const media = new Map<string, Uint8Array>();
  for (const path of paths) {
    const data = source.attachment(path);
    if (data) media.set(path, data);
  }
  target.addAttachments(media);
}

function toPolicy(prefer: MergeRequest['prefer'], base: 'a' | 'b'): ConflictPolicy {
  if (prefer === 'newest') return 'newest';
  return prefer === base ? 'target' : 'source';
}
