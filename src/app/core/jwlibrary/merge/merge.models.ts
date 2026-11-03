export type MergeEntity = 'notes' | 'highlights' | 'bookmarks' | 'inputFields' | 'tags' | 'playlists';

export const MERGE_ENTITY_LABELS: Record<MergeEntity, string> = {
  notes: 'Notas',
  highlights: 'Marcações',
  bookmarks: 'Marcadores',
  inputFields: 'Comentários e respostas',
  tags: 'Etiquetas',
  playlists: 'Listas de reprodução',
};

/**
 * Who wins when the same item differs between the two files:
 * - `newest`: notes compare their own LastModified; other items use the file's LastModified.
 * - `target` / `source`: always keep that side.
 */
export type ConflictPolicy = 'newest' | 'target' | 'source';

export interface MergeOptions {
  conflictPolicy: ConflictPolicy;
  include: Record<MergeEntity, boolean>;
}

/** What the user chooses in the UI: in a conflict, keep the newest version, file A's, or file B's. */
export type MergePreference = 'newest' | 'a' | 'b';

export interface MergeRequest {
  prefer: MergePreference;
  include: Record<MergeEntity, boolean>;
}

export const DEFAULT_MERGE_REQUEST: MergeRequest = {
  prefer: 'newest',
  include: { notes: true, highlights: true, bookmarks: true, inputFields: true, tags: true, playlists: true },
};

export type ConflictResolution = 'kept-target' | 'took-source' | 'kept-both';

export interface MergeConflict {
  entity: MergeEntity;
  description: string;
  resolution: ConflictResolution;
  target?: string;
  source?: string;
}

export interface EntityCounters {
  added: number;
  updated: number;
  identical: number;
}

export interface MergeReport {
  counters: Record<MergeEntity, EntityCounters>;
  conflicts: MergeConflict[];
  /** Media files referenced by merged playlists that must be copied from the source archive. */
  mediaFiles: string[];
  warnings: string[];
}

/** Adds the counters, conflicts and warnings of `next` into `into` (used when merging several files). */
export function accumulateReport(into: MergeReport, next: MergeReport): MergeReport {
  for (const key of Object.keys(into.counters) as MergeEntity[]) {
    into.counters[key].added += next.counters[key].added;
    into.counters[key].updated += next.counters[key].updated;
    into.counters[key].identical += next.counters[key].identical;
  }
  into.conflicts.push(...next.conflicts);
  into.mediaFiles.push(...next.mediaFiles);
  into.warnings.push(...next.warnings);
  return into;
}

export function emptyReport(): MergeReport {
  const c = (): EntityCounters => ({ added: 0, updated: 0, identical: 0 });
  return {
    counters: { notes: c(), highlights: c(), bookmarks: c(), inputFields: c(), tags: c(), playlists: c() },
    conflicts: [],
    mediaFiles: [],
    warnings: [],
  };
}
