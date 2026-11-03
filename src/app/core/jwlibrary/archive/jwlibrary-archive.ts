import JSZip from 'jszip';
import { Bytes } from '../../storage/storage.models';
import { applyWal, toWalMode } from './sqlite-wal';

export interface JwManifest {
  name: string;
  creationDate: string;
  version: number;
  type: number;
  userDataBackup: {
    lastModifiedDate: string;
    deviceName: string;
    databaseName: string;
    hash: string;
    schemaVersion: number;
  };
}

/** The unzipped contents of a `.jwlibrary` backup. */
export interface JwArchive {
  manifest: JwManifest;
  /** The SQLite database, with any WAL already folded in. */
  database: Uint8Array;
  /** Other entries (thumbnail, media) carried over untouched when saving. */
  attachments: Map<string, Uint8Array>;
}

const DEFAULT_DB = 'userData.db';
const SQLITE_SIDE_FILES = /-(wal|shm|journal)$/;

export async function readArchive(bytes: Uint8Array): Promise<JwArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('O arquivo não é um backup .jwlibrary válido (não é um zip).');
  }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Backup inválido: manifest.json não encontrado.');
  const manifest = JSON.parse(await manifestFile.async('string')) as JwManifest;

  const dbName = manifest.userDataBackup?.databaseName || DEFAULT_DB;
  const dbFile = zip.file(dbName);
  if (!dbFile) throw new Error(`Backup inválido: ${dbName} não encontrado.`);
  const wal = await zip.file(`${dbName}-wal`)?.async('uint8array');
  const { bytes: database } = applyWal(await dbFile.async('uint8array'), wal);

  const attachments = new Map<string, Uint8Array>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === 'manifest.json' || entry.name === dbName || SQLITE_SIDE_FILES.test(entry.name)) continue;
    attachments.set(entry.name, await entry.async('uint8array'));
  }
  return { manifest, database, attachments };
}

export interface WriteOptions {
  fileName: string;
  deviceName?: string;
  /** ISO timestamp written to the manifest; defaults to now. */
  modifiedAt?: string;
  /** "YYYY-MM-DD" the backup was made; defaults to the date of `modifiedAt`. */
  creationDate?: string;
}

export async function writeArchive(archive: JwArchive, opts: WriteOptions): Promise<Bytes> {
  const ts = opts.modifiedAt ?? isoNow();
  const dbName = archive.manifest.userDataBackup?.databaseName || DEFAULT_DB;
  const database = toWalMode(archive.database);
  const manifest: JwManifest = {
    ...archive.manifest,
    name: opts.fileName,
    creationDate: opts.creationDate ?? ts.slice(0, 10),
    userDataBackup: {
      ...archive.manifest.userDataBackup,
      databaseName: dbName,
      lastModifiedDate: ts,
      deviceName: opts.deviceName ?? archive.manifest.userDataBackup?.deviceName ?? 'JW Notes',
      hash: await sha256Hex(database),
    },
  };

  // Same entry order as JW Library: database, attachments, manifest last.
  const zip = new JSZip();
  zip.file(dbName, database);
  for (const [path, data] of archive.attachments) zip.file(path, data);
  zip.file('manifest.json', JSON.stringify(manifest));
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }));
}

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JW Library stores timestamps as ISO-8601 without milliseconds. */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}
