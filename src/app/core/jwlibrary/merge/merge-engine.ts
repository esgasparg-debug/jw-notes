import { Row, SqliteDb } from '../database/sqlite-db';
import {
  BlockRangeRow,
  BookmarkRow,
  InputFieldRow,
  LocationRow,
  NoteRow,
  TagMapRow,
  TagRow,
  TagType,
  UserMarkRow,
} from '../models/userdata.models';
import { describeLocation } from '../models/location-format';
import { TagRepository } from '../repositories/tag.repository';
import { ConflictResolution, MergeEntity, MergeOptions, MergeReport, emptyReport } from './merge.models';
import { RowCopier } from './row-copier';

const BOOKMARK_SLOTS = 10;
const OPEN_END = 1_000_000_000;

/**
 * Merges every user item from `source` into `target` (mutating `target`) and reports what happened.
 *
 * Items are matched by natural keys rather than ids, because ids are local to each device:
 * Location by its identifying columns, Tag by (Type, Name), UserMark/Note by GUID,
 * Bookmark by (publication, slot), InputField by (location, text tag).
 */
export function mergeUserData(target: SqliteDb, source: SqliteDb, options: MergeOptions): MergeReport {
  return new MergeEngine(target, source, options).run();
}

class MergeEngine {
  private readonly report = emptyReport();
  private readonly copier: RowCopier;
  private readonly tagRepo: TagRepository;
  private readonly sourceIsNewer: boolean;

  /** source id → target id */
  private readonly locations = new Map<number, number>();
  private readonly tags = new Map<number, number>();
  private readonly marks = new Map<number, number>();
  private readonly notes = new Map<number, number>();
  private readonly media = new Map<number, number>();
  private readonly playlists = new Map<number, number>();

  constructor(
    private readonly target: SqliteDb,
    private readonly source: SqliteDb,
    private readonly options: MergeOptions,
  ) {
    this.copier = new RowCopier(source, target);
    this.tagRepo = new TagRepository(target);
    const lm = (db: SqliteDb) =>
      (db.hasTable('LastModified') ? db.scalar<string>('SELECT LastModified FROM LastModified') : undefined) ?? '';
    this.sourceIsNewer = lm(source) > lm(target);
  }

  run(): MergeReport {
    const inc = this.options.include;
    const sv = this.source.scalar<number>('PRAGMA user_version');
    const tv = this.target.scalar<number>('PRAGMA user_version');
    if (sv !== tv) this.report.warnings.push(`Versões de esquema diferentes (${tv} e ${sv}); apenas colunas em comum foram copiadas.`);

    this.target.transaction(() => {
      if (inc.tags) this.mergeTags();
      if (inc.highlights) this.mergeHighlights();
      if (inc.notes) this.mergeNotes();
      if (inc.bookmarks) this.mergeBookmarks();
      if (inc.inputFields) this.mergeInputFields();
      if (inc.playlists) this.mergePlaylists();
      if (inc.tags) this.mergeTagMaps();
    });
    return this.report;
  }

  /* ---------------- conflict policy ---------------- */

  /** Decides whether the source version should replace the target's. Per-row timestamps win over file timestamps. */
  private sourceWins(targetTs?: string | null, sourceTs?: string | null): boolean {
    if (this.options.conflictPolicy === 'source') return true;
    if (this.options.conflictPolicy === 'target') return false;
    if (targetTs && sourceTs && targetTs !== sourceTs) return sourceTs > targetTs;
    return this.sourceIsNewer;
  }

  private conflict(entity: MergeEntity, description: string, resolution: ConflictResolution, target?: string, source?: string): void {
    this.report.conflicts.push({ entity, description, resolution, target, source });
  }

  /* ---------------- Location ---------------- */

  private mapLocation(sourceId: number | null): number | null {
    if (sourceId == null) return null;
    const cached = this.locations.get(sourceId);
    if (cached != null) return cached;

    const row = this.source.get<LocationRow>('SELECT * FROM Location WHERE LocationId = ?', [sourceId]);
    if (!row) return null;
    const found = this.findLocation(row);
    let id: number;
    if (found) {
      id = found.LocationId;
      if (!found.Title && row.Title) this.target.run('UPDATE Location SET Title = ? WHERE LocationId = ?', [row.Title, id]);
    } else {
      id = this.copier.insert('Location', row as unknown as Row, {}, ['LocationId']);
    }
    this.locations.set(sourceId, id);
    return id;
  }

  private findLocation(r: LocationRow): LocationRow | undefined {
    const extra = this.copier.hasColumn('Location', 'Specialty')
      ? ` AND IFNULL(Specialty, '') = IFNULL(?, '') AND IFNULL(Edition, '') = IFNULL(?, '')`
      : '';
    const params = [r.Type, r.KeySymbol, r.MepsLanguage, r.BookNumber, r.ChapterNumber, r.DocumentId, r.Track, r.IssueTagNumber];
    const exact = this.target.get<LocationRow>(
      `SELECT * FROM Location WHERE Type = ? AND KeySymbol IS ? AND MepsLanguage IS ? AND BookNumber IS ?
         AND ChapterNumber IS ? AND DocumentId IS ? AND Track IS ? AND IssueTagNumber IS ?${extra}`,
      extra ? [...params, r.Specialty ?? null, r.Edition ?? null] : params,
    );
    if (exact || r.BookNumber == null) return exact;
    // UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type) — reuse it even if other columns differ.
    return this.target.get<LocationRow>(
      'SELECT * FROM Location WHERE BookNumber = ? AND ChapterNumber IS ? AND KeySymbol IS ? AND MepsLanguage IS ? AND Type = ?',
      [r.BookNumber, r.ChapterNumber, r.KeySymbol, r.MepsLanguage, r.Type],
    );
  }

  private locationLabel(sourceLocationId: number | null): string {
    if (sourceLocationId == null) return 'nota avulsa';
    const row = this.source.get<LocationRow>('SELECT * FROM Location WHERE LocationId = ?', [sourceLocationId]);
    return row ? describeLocation(row).label : `local ${sourceLocationId}`;
  }

  /* ---------------- Tag ---------------- */

  private mergeTags(): void {
    const c = this.report.counters.tags;
    for (const t of this.source.all<TagRow>('SELECT * FROM Tag')) {
      // There is a single Favorites tag whose name is localised, so match it by type only.
      const existing =
        t.Type === TagType.Favorite
          ? this.target.scalar<number>('SELECT TagId FROM Tag WHERE Type = ?', [t.Type])
          : this.target.scalar<number>('SELECT TagId FROM Tag WHERE Type = ? AND Name = ?', [t.Type, t.Name]);
      if (existing != null) {
        this.tags.set(t.TagId, existing);
        c.identical++;
      } else {
        this.tags.set(t.TagId, this.target.run('INSERT INTO Tag (Type, Name) VALUES (?, ?)', [t.Type, t.Name]).lastId);
        c.added++;
      }
    }
  }

  private mergeTagMaps(): void {
    for (const m of this.source.all<TagMapRow>('SELECT * FROM TagMap ORDER BY TagId, Position')) {
      const tagId = this.tags.get(m.TagId);
      if (tagId == null) continue;
      if (m.NoteId != null) {
        const noteId = this.notes.get(m.NoteId);
        if (noteId != null) this.tagRepo.attach(tagId, { noteId });
      } else if (m.LocationId != null) {
        const locationId = this.mapLocation(m.LocationId);
        if (locationId != null) this.tagRepo.attach(tagId, { locationId });
      } else if (m.PlaylistItemId != null) {
        const playlistItemId = this.playlists.get(m.PlaylistItemId);
        if (playlistItemId != null) this.tagRepo.attach(tagId, { playlistItemId });
      }
    }
  }

  /* ---------------- UserMark / BlockRange (highlights) ---------------- */

  private mergeHighlights(): void {
    const c = this.report.counters.highlights;
    const sourceRanges = groupBy(this.source.all<BlockRangeRow>('SELECT * FROM BlockRange'), (r) => r.UserMarkId);

    for (const m of this.source.all<UserMarkRow>('SELECT * FROM UserMark')) {
      const ranges = sourceRanges.get(m.UserMarkId) ?? [];
      const byGuid = this.target.get<UserMarkRow>('SELECT * FROM UserMark WHERE UserMarkGuid = ?', [m.UserMarkGuid]);
      if (byGuid) {
        this.marks.set(m.UserMarkId, byGuid.UserMarkId);
        this.reconcileColor(byGuid, m);
        continue;
      }

      const locationId = this.mapLocation(m.LocationId)!;
      const overlapping = this.overlappingMarks(locationId, ranges);
      if (!overlapping.length) {
        this.marks.set(m.UserMarkId, this.insertMark(m, locationId, ranges));
        c.added++;
        continue;
      }

      // Same passage highlighted independently on both devices → one highlight.
      const twin = overlapping.find((id) => sameRanges(this.targetRanges(id), ranges));
      if (twin != null) {
        this.marks.set(m.UserMarkId, twin);
        this.reconcileColor(this.target.get<UserMarkRow>('SELECT * FROM UserMark WHERE UserMarkId = ?', [twin])!, m);
        continue;
      }

      // Partially overlapping highlights: JW Library never stores overlaps, so keep only one side.
      const where = this.locationLabel(m.LocationId);
      if (this.sourceWins()) {
        const newId = this.insertMark(m, locationId, ranges);
        for (const oldId of overlapping) this.replaceMark(oldId, newId);
        this.marks.set(m.UserMarkId, newId);
        c.updated++;
        this.conflict('highlights', `Marcações sobrepostas em ${where}`, 'took-source');
      } else {
        this.marks.set(m.UserMarkId, overlapping[0]);
        this.conflict('highlights', `Marcações sobrepostas em ${where}`, 'kept-target');
      }
    }
  }

  private reconcileColor(existing: UserMarkRow, incoming: UserMarkRow): void {
    const c = this.report.counters.highlights;
    if (existing.ColorIndex === incoming.ColorIndex && existing.StyleIndex === incoming.StyleIndex) {
      c.identical++;
      return;
    }
    const where = this.locationLabel(incoming.LocationId);
    if (this.sourceWins()) {
      this.target.run('UPDATE UserMark SET ColorIndex = ?, StyleIndex = ? WHERE UserMarkId = ?', [
        incoming.ColorIndex,
        incoming.StyleIndex,
        existing.UserMarkId,
      ]);
      c.updated++;
      this.conflict('highlights', `Cor diferente em ${where}`, 'took-source', `cor ${existing.ColorIndex}`, `cor ${incoming.ColorIndex}`);
    } else {
      this.conflict('highlights', `Cor diferente em ${where}`, 'kept-target', `cor ${existing.ColorIndex}`, `cor ${incoming.ColorIndex}`);
    }
  }

  private insertMark(m: UserMarkRow, locationId: number, ranges: BlockRangeRow[]): number {
    const id = this.copier.insert('UserMark', m as unknown as Row, { LocationId: locationId }, ['UserMarkId']);
    for (const r of ranges) this.copier.insert('BlockRange', r as unknown as Row, { UserMarkId: id }, ['BlockRangeId']);
    return id;
  }

  /** Moves notes from `oldId` to `newId` and deletes the old highlight. */
  private replaceMark(oldId: number, newId: number): void {
    this.target.run('UPDATE Note SET UserMarkId = ? WHERE UserMarkId = ?', [newId, oldId]);
    this.target.run('DELETE FROM BlockRange WHERE UserMarkId = ?', [oldId]);
    this.target.run('DELETE FROM UserMark WHERE UserMarkId = ?', [oldId]);
    for (const [src, tgt] of this.marks) if (tgt === oldId) this.marks.set(src, newId);
  }

  private overlappingMarks(locationId: number, ranges: BlockRangeRow[]): number[] {
    const ids = new Set<number>();
    for (const r of ranges) {
      for (const row of this.target.all<{ UserMarkId: number }>(
        `SELECT DISTINCT br.UserMarkId FROM BlockRange br JOIN UserMark um ON um.UserMarkId = br.UserMarkId
          WHERE um.LocationId = ? AND br.BlockType = ? AND br.Identifier = ?
            AND IFNULL(br.StartToken, -1) <= ? AND IFNULL(br.EndToken, ${OPEN_END}) >= ?`,
        [locationId, r.BlockType, r.Identifier, r.EndToken ?? OPEN_END, r.StartToken ?? -1],
      )) {
        ids.add(row.UserMarkId);
      }
    }
    return [...ids];
  }

  private targetRanges(markId: number): BlockRangeRow[] {
    return this.target.all<BlockRangeRow>('SELECT * FROM BlockRange WHERE UserMarkId = ?', [markId]);
  }

  /** Resolves a source UserMarkId even when highlights themselves are not being merged. */
  private mapMark(sourceId: number | null): number | null {
    if (sourceId == null) return null;
    const mapped = this.marks.get(sourceId);
    if (mapped != null) return mapped;
    const guid = this.source.scalar<string>('SELECT UserMarkGuid FROM UserMark WHERE UserMarkId = ?', [sourceId]);
    return guid ? (this.target.scalar<number>('SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?', [guid]) ?? null) : null;
  }

  /* ---------------- Note ---------------- */

  private mergeNotes(): void {
    const c = this.report.counters.notes;
    for (const n of this.source.all<NoteRow>('SELECT * FROM Note')) {
      const existing = this.target.get<NoteRow>('SELECT * FROM Note WHERE Guid = ?', [n.Guid]);
      if (existing) {
        this.notes.set(n.NoteId, existing.NoteId);
        if (same(existing.Title, n.Title) && same(existing.Content, n.Content)) {
          c.identical++;
        } else if (this.sourceWins(existing.LastModified, n.LastModified)) {
          this.target.run('UPDATE Note SET Title = ?, Content = ?, LastModified = ? WHERE NoteId = ?', [
            n.Title,
            n.Content,
            n.LastModified,
            existing.NoteId,
          ]);
          c.updated++;
          this.conflict('notes', noteLabel(n), 'took-source', preview(existing), preview(n));
        } else {
          this.conflict('notes', noteLabel(n), 'kept-target', preview(existing), preview(n));
        }
        continue;
      }

      const locationId = this.mapLocation(n.LocationId);
      // The same note typed on both devices gets different GUIDs; treat identical text at the same place as one note.
      const twin = this.target.scalar<number>(
        `SELECT NoteId FROM Note WHERE LocationId IS ? AND BlockIdentifier IS ?
           AND IFNULL(Title, '') = ? AND IFNULL(Content, '') = ?`,
        [locationId, n.BlockIdentifier, n.Title ?? '', n.Content ?? ''],
      );
      if (twin != null) {
        this.notes.set(n.NoteId, twin);
        c.identical++;
        continue;
      }
      const id = this.copier.insert('Note', n as unknown as Row, { LocationId: locationId, UserMarkId: this.mapMark(n.UserMarkId) }, [
        'NoteId',
      ]);
      this.notes.set(n.NoteId, id);
      c.added++;
    }
  }

  /* ---------------- Bookmark ---------------- */

  private mergeBookmarks(): void {
    const c = this.report.counters.bookmarks;
    for (const b of this.source.all<BookmarkRow>('SELECT * FROM Bookmark')) {
      const locationId = this.mapLocation(b.LocationId)!;
      const pubId = this.mapLocation(b.PublicationLocationId)!;
      const values = { LocationId: locationId, PublicationLocationId: pubId };

      const samePlace = this.target.get<BookmarkRow>(
        `SELECT * FROM Bookmark WHERE PublicationLocationId = ? AND LocationId = ? AND BlockType = ? AND BlockIdentifier IS ?`,
        [pubId, locationId, b.BlockType, b.BlockIdentifier],
      );
      if (samePlace) {
        if (same(samePlace.Title, b.Title) && same(samePlace.Snippet, b.Snippet)) c.identical++;
        else if (this.sourceWins()) {
          this.target.run('UPDATE Bookmark SET Title = ?, Snippet = ? WHERE BookmarkId = ?', [b.Title, b.Snippet, samePlace.BookmarkId]);
          c.updated++;
        } else c.identical++;
        continue;
      }

      const occupied = this.target.get<BookmarkRow>('SELECT * FROM Bookmark WHERE PublicationLocationId = ? AND Slot = ?', [pubId, b.Slot]);
      if (!occupied) {
        this.copier.insert('Bookmark', b as unknown as Row, values, ['BookmarkId']);
        c.added++;
        continue;
      }

      const used = new Set(
        this.target.all<{ Slot: number }>('SELECT Slot FROM Bookmark WHERE PublicationLocationId = ?', [pubId]).map((r) => r.Slot),
      );
      const free = Array.from({ length: BOOKMARK_SLOTS }, (_, i) => i).find((s) => !used.has(s));
      const label = `Marcador "${b.Title}" (${this.locationLabel(b.PublicationLocationId)})`;
      if (free != null) {
        this.copier.insert('Bookmark', b as unknown as Row, { ...values, Slot: free }, ['BookmarkId']);
        c.added++;
        this.conflict('bookmarks', `${label}: posição ${b.Slot + 1} ocupada, movido para ${free + 1}`, 'kept-both');
      } else if (this.sourceWins()) {
        this.target.run('DELETE FROM Bookmark WHERE BookmarkId = ?', [occupied.BookmarkId]);
        this.copier.insert('Bookmark', b as unknown as Row, values, ['BookmarkId']);
        c.updated++;
        this.conflict('bookmarks', `${label}: todas as posições ocupadas`, 'took-source', occupied.Title, b.Title);
      } else {
        this.conflict('bookmarks', `${label}: todas as posições ocupadas`, 'kept-target', occupied.Title, b.Title);
      }
    }
  }

  /* ---------------- InputField ---------------- */

  private mergeInputFields(): void {
    if (!this.source.hasTable('InputField') || !this.target.hasTable('InputField')) return;
    const c = this.report.counters.inputFields;
    for (const f of this.source.all<InputFieldRow>('SELECT * FROM InputField')) {
      const locationId = this.mapLocation(f.LocationId)!;
      const existing = this.target.scalar<string>('SELECT Value FROM InputField WHERE LocationId = ? AND TextTag = ?', [
        locationId,
        f.TextTag,
      ]);
      if (existing == null) {
        this.target.run('INSERT INTO InputField (LocationId, TextTag, Value) VALUES (?, ?, ?)', [locationId, f.TextTag, f.Value]);
        c.added++;
      } else if (existing === f.Value) {
        c.identical++;
      } else {
        const label = `Resposta em ${this.locationLabel(f.LocationId)}`;
        if (this.sourceWins()) {
          this.target.run('UPDATE InputField SET Value = ? WHERE LocationId = ? AND TextTag = ?', [f.Value, locationId, f.TextTag]);
          c.updated++;
          this.conflict('inputFields', label, 'took-source', existing, f.Value);
        } else {
          this.conflict('inputFields', label, 'kept-target', existing, f.Value);
        }
      }
    }
  }

  /* ---------------- Playlists ---------------- */

  private mergePlaylists(): void {
    if (!this.source.hasTable('PlaylistItem') || !this.target.hasTable('PlaylistItem')) return;
    const c = this.report.counters.playlists;

    for (const m of this.source.all<Row>('SELECT * FROM IndependentMedia')) {
      const existing = this.target.scalar<number>('SELECT IndependentMediaId FROM IndependentMedia WHERE Hash = ? OR FilePath = ?', [
        m['Hash'],
        m['FilePath'],
      ]);
      if (existing != null) {
        this.media.set(m['IndependentMediaId'] as number, existing);
      } else {
        this.media.set(m['IndependentMediaId'] as number, this.copier.insert('IndependentMedia', m, {}, ['IndependentMediaId']));
        this.report.mediaFiles.push(m['FilePath'] as string);
      }
    }

    const accuracy = new Map<number, number>();
    for (const a of this.source.all<{ PlaylistItemAccuracyId: number; Description: string }>('SELECT * FROM PlaylistItemAccuracy')) {
      const id =
        this.target.scalar<number>('SELECT PlaylistItemAccuracyId FROM PlaylistItemAccuracy WHERE Description = ?', [a.Description]) ??
        this.target.run('INSERT INTO PlaylistItemAccuracy (Description) VALUES (?)', [a.Description]).lastId;
      accuracy.set(a.PlaylistItemAccuracyId, id);
    }

    for (const p of this.source.all<Row>('SELECT * FROM PlaylistItem')) {
      const sourceId = p['PlaylistItemId'] as number;
      const existing = this.target.scalar<number>(
        `SELECT PlaylistItemId FROM PlaylistItem WHERE Label = ? AND IFNULL(ThumbnailFilePath, '') = IFNULL(?, '')
           AND StartTrimOffsetTicks IS ? AND EndTrimOffsetTicks IS ?`,
        [p['Label'], p['ThumbnailFilePath'], p['StartTrimOffsetTicks'], p['EndTrimOffsetTicks']],
      );
      if (existing != null) {
        this.playlists.set(sourceId, existing);
        c.identical++;
        continue;
      }
      const id = this.copier.insert('PlaylistItem', p, { Accuracy: accuracy.get(p['Accuracy'] as number) ?? p['Accuracy'] }, [
        'PlaylistItemId',
      ]);
      this.playlists.set(sourceId, id);
      this.copyPlaylistChildren(sourceId, id);
      c.added++;
    }
  }

  private copyPlaylistChildren(sourceId: number, targetId: number): void {
    for (const r of this.source.all<Row>('SELECT * FROM PlaylistItemLocationMap WHERE PlaylistItemId = ?', [sourceId])) {
      this.copier.insert('PlaylistItemLocationMap', r, {
        PlaylistItemId: targetId,
        LocationId: this.mapLocation(r['LocationId'] as number),
      });
    }
    for (const r of this.source.all<Row>('SELECT * FROM PlaylistItemIndependentMediaMap WHERE PlaylistItemId = ?', [sourceId])) {
      const mediaId = this.media.get(r['IndependentMediaId'] as number);
      if (mediaId != null)
        this.copier.insert('PlaylistItemIndependentMediaMap', r, { PlaylistItemId: targetId, IndependentMediaId: mediaId });
    }
    for (const marker of this.source.all<Row>('SELECT * FROM PlaylistItemMarker WHERE PlaylistItemId = ?', [sourceId])) {
      const markerId = this.copier.insert('PlaylistItemMarker', marker, { PlaylistItemId: targetId }, ['PlaylistItemMarkerId']);
      for (const table of ['PlaylistItemMarkerBibleVerseMap', 'PlaylistItemMarkerParagraphMap']) {
        if (!this.source.hasTable(table) || !this.target.hasTable(table)) continue;
        for (const r of this.source.all<Row>(`SELECT * FROM ${table} WHERE PlaylistItemMarkerId = ?`, [marker['PlaylistItemMarkerId']])) {
          this.copier.insert(table, r, { PlaylistItemMarkerId: markerId });
        }
      }
    }
  }
}

/* ---------------- helpers ---------------- */

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function sameRanges(a: BlockRangeRow[], b: BlockRangeRow[]): boolean {
  const norm = (rs: BlockRangeRow[]) =>
    rs
      .map((r) => `${r.BlockType}:${r.Identifier}:${r.StartToken ?? ''}:${r.EndToken ?? ''}`)
      .sort()
      .join('|');
  return norm(a) === norm(b);
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

function noteLabel(n: NoteRow): string {
  return `Nota "${n.Title || (n.Content ?? '').slice(0, 40) || 'sem título'}"`;
}

function preview(n: NoteRow): string {
  return [n.Title, n.Content].filter(Boolean).join(' — ').slice(0, 200);
}
