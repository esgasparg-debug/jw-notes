const PREFIX = 'jw-notes.';

/** Per-device UI preferences. Storage can be unavailable (private mode, some webviews), so failures are ignored. */
export function readPreference<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* preference is a convenience only */
  }
}
