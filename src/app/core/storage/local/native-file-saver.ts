import { Bytes } from '../storage.models';

/**
 * Saving on Android/iOS, where WebViews can neither download files nor use the File System
 * Access API: the backup is written to the app's cache and handed to the native share sheet,
 * from which the user picks Google Drive, OneDrive, Files, etc. Plugins load lazily so the
 * web and desktop builds never fetch them.
 */
export async function saveWithShareSheet(bytes: Bytes, name: string): Promise<void> {
  const [uri, { Share }] = await Promise.all([writeToCache(bytes, name), import('@capacitor/share')]);
  await Share.share({ title: name, files: [uri], dialogTitle: 'Salvar backup em…' });
}

/** Writes a file into the app's cache (Android/iOS) and returns its native URI. */
export async function writeToCache(bytes: Bytes, name: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { uri } = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
  return uri;
}

function toBase64(bytes: Bytes): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
