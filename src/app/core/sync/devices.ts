import { Injectable, inject, signal } from '@angular/core';
import { readPreference, writePreference } from '../../shared/utils/preferences';
import { PlatformService, RuntimePlatform } from '../platform/platform.service';
import { FileRef } from '../storage/storage.models';

/**
 * A device taking part in sync rounds, stored as jw-notes/config/aparelhos/<id>.json. One file
 * per device, so two devices never write the same file at the same time.
 */
export interface DeviceInfo {
  version: 1;
  id: string;
  /** e.g. "Samsung_SM-X216B" or the computer's name. */
  name: string;
  platform: RuntimePlatform;
  /** Firebase Cloud Messaging token (Android), used by the notification relay. */
  pushToken?: string;
  updatedAt: string;
}

/** A registered device and its part in the current round (the backups waiting in the inbox). */
export interface DeviceStatus {
  device: DeviceInfo;
  /** The backup it sent in this round, if any. */
  upload: FileRef | null;
  me: boolean;
}

/** Drive appProperties key that tags a backup with the device that sent it. */
export const DEVICE_PROPERTY = 'jwNotesDevice';

const ID_KEY = 'device.id';
const PUSH_TOKEN_KEY = 'device.pushToken';

/** This device: a stable random id plus a readable name. */
@Injectable({ providedIn: 'root' })
export class DeviceIdentity {
  readonly platform: RuntimePlatform = inject(PlatformService).platform;
  readonly id: string = readPreference<string>(ID_KEY) ?? newId();

  private readonly _pushToken = signal<string | null>(readPreference<string>(PUSH_TOKEN_KEY));
  readonly pushToken = this._pushToken.asReadonly();
  private name?: Promise<string>;

  setPushToken(token: string): void {
    writePreference(PUSH_TOKEN_KEY, token);
    this._pushToken.set(token);
  }

  deviceName(): Promise<string> {
    this.name ??= resolveName(this.platform).catch(() => fallbackName(this.platform));
    return this.name;
  }
}

function newId(): string {
  const id = crypto.randomUUID();
  writePreference(ID_KEY, id);
  return id;
}

async function resolveName(platform: RuntimePlatform): Promise<string> {
  if (platform === 'android') {
    const { JwLibraryApp } = await import('../platform/android-plugins');
    return (await JwLibraryApp.deviceName()).name;
  }
  const desktop = (window as unknown as { jwNotesDesktop?: { deviceName?: () => Promise<string> } }).jwNotesDesktop;
  if (desktop?.deviceName) return desktop.deviceName();
  return fallbackName(platform);
}

function fallbackName(platform: RuntimePlatform): string {
  return { android: 'Android', ios: 'iPhone', electron: 'Computador', web: 'Navegador' }[platform];
}
