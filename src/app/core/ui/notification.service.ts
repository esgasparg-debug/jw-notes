import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private seq = 0;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  info(message: string): void {
    this.push('info', message, 3000);
  }

  success(message: string): void {
    this.push('success', message, 3000);
  }

  error(error: unknown, prefix?: string): void {
    const message = errorMessage(error);
    console.error(error);
    this.push('error', prefix ? `${prefix}: ${message}` : message, 7000);
  }

  dismiss(id: number): void {
    this._toasts.update((ts) => ts.filter((t) => t.id !== id));
  }

  private push(kind: ToastKind, message: string, ms: number): void {
    const id = ++this.seq;
    this._toasts.update((ts) => [...ts, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
