import { Injectable } from '@angular/core';

export type RuntimePlatform = 'web' | 'electron' | 'android' | 'ios';

interface CapacitorGlobal {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

/** Tells the app which shell it is running in, so features can adapt without `if (window.x)` scattered around. */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly platform: RuntimePlatform = detect();

  get isNative(): boolean {
    return this.platform !== 'web';
  }
}

function detect(): RuntimePlatform {
  const w = window as unknown as { Capacitor?: CapacitorGlobal; jwNotesDesktop?: unknown };
  if (w.jwNotesDesktop) return 'electron';
  if (w.Capacitor?.isNativePlatform()) {
    const p = w.Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
  }
  return 'web';
}
