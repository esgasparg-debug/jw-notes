import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface PromptRequest {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
}

export type ActiveDialog =
  | (ConfirmRequest & { kind: 'confirm'; resolve(ok: boolean): void })
  | (PromptRequest & { kind: 'prompt'; resolve(value: string | null): void });

/** Promise-based confirm/prompt dialogs rendered by <app-confirm-host>; replaces window.confirm/prompt. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly _active = signal<ActiveDialog | null>(null);
  readonly active = this._active.asReadonly();

  confirm(req: ConfirmRequest): Promise<boolean> {
    this.cancelActive();
    return new Promise((resolve) => this._active.set({ ...req, kind: 'confirm', resolve }));
  }

  /** Resolves with the trimmed text, or null when cancelled or left empty. */
  prompt(req: PromptRequest): Promise<string | null> {
    this.cancelActive();
    return new Promise((resolve) => this._active.set({ ...req, kind: 'prompt', resolve }));
  }

  accept(value?: string): void {
    const a = this._active();
    this._active.set(null);
    if (a?.kind === 'confirm') a.resolve(true);
    else if (a?.kind === 'prompt') a.resolve(value?.trim() || null);
  }

  cancel(): void {
    this.cancelActive();
  }

  private cancelActive(): void {
    const a = this._active();
    this._active.set(null);
    if (a?.kind === 'confirm') a.resolve(false);
    else if (a?.kind === 'prompt') a.resolve(null);
  }
}
