import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

/**
 * App-local Capacitor plugins (Java sources in mobile/android/java, applied by
 * scripts/setup-android.cjs). Import this module lazily so web and desktop never load it.
 */

interface GoogleDriveAuthPlugin {
  authorize(options: { scopes: string[] }): Promise<{ accessToken: string }>;
  clearToken(options: { accessToken: string }): Promise<void>;
}

/** A file shared to the app; `error` when Android handed it over but it could not be read. */
export interface SharedFile {
  name?: string;
  /** Base64 contents. */
  data?: string;
  error?: string;
}

interface SharedBackupPlugin {
  addListener(event: 'received', listener: (file: SharedFile) => void): Promise<PluginListenerHandle>;
}

interface JwLibraryAppPlugin {
  /** "Manufacturer_Model", the way JW Library names its backups. */
  deviceName(): Promise<{ name: string }>;
  /** Opens JW Library, so the user can make a backup and share it back. */
  open(): Promise<void>;
  /**
   * Hands a .jwlibrary file (Filesystem URI in the app's cache) to JW Library, which asks to
   * restore it. `via` tells whether JW Library took it directly or the user had to pick an app.
   */
  restore(options: { uri: string }): Promise<{ via: 'jwlibrary' | 'chooser' }>;
  /** Whether the accessibility robot (JwLibraryRobot) is turned on. */
  robotStatus(): Promise<{ enabled: boolean }>;
  /** Opens Settings › Accessibility, where only the user can turn the robot on. */
  openRobotSettings(): Promise<void>;
  /** The robot opens JW Library, makes a backup and shares it back to JW Notes (arrives via SharedBackup). */
  backupAutomatically(): Promise<void>;
}

export const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth');
export const SharedBackup = registerPlugin<SharedBackupPlugin>('SharedBackup');
export const JwLibraryApp = registerPlugin<JwLibraryAppPlugin>('JwLibraryApp');
