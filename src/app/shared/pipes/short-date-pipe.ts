import { Pipe, PipeTransform } from '@angular/core';

const FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Formats ISO timestamps from JW Library / cloud APIs in the user's locale. */
@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : FORMAT.format(d);
  }
}
