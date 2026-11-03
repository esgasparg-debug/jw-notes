import { Pipe, PipeTransform } from '@angular/core';
import { FolderRef } from '../../core/storage/storage.models';

/** ["Meu Drive", "jw-notes", "sync"] → "Meu Drive › jw-notes › sync" */
@Pipe({ name: 'folderPath' })
export class FolderPathPipe implements PipeTransform {
  transform(path: FolderRef[] | null | undefined): string {
    return (path ?? []).map((f) => f.name).join(' › ');
  }
}
