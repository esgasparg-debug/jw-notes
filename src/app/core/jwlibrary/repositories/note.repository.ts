import { isoNow } from '../archive/jwlibrary-archive';
import { SqliteDb } from '../database/sqlite-db';
import { NoteDraft, NoteFilter, NoteItem, TagRef, TagType } from '../models/userdata.models';
import { likeParam, locationColumns, readLocation } from './location-columns';
import { TagRepository } from './tag.repository';

export class NoteRepository {
  constructor(
    private readonly db: SqliteDb,
    private readonly tags: TagRepository,
  ) {}

  list(filter: NoteFilter = {}): NoteItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.text?.trim()) {
      where.push(`(IFNULL(n.Title, '') LIKE ? ESCAPE '\\' OR IFNULL(n.Content, '') LIKE ? ESCAPE '\\')`);
      const p = likeParam(filter.text.trim());
      params.push(p, p);
    }
    if (filter.tag === 'none') {
      where.push('NOT EXISTS (SELECT 1 FROM TagMap m WHERE m.NoteId = n.NoteId)');
    } else if (typeof filter.tag === 'number') {
      where.push('EXISTS (SELECT 1 FROM TagMap m WHERE m.NoteId = n.NoteId AND m.TagId = ?)');
      params.push(filter.tag);
    }
    if (filter.publication) {
      where.push('l.KeySymbol = ?');
      params.push(filter.publication);
    }
    const rows = this.db.all(
      `SELECT n.*, um.ColorIndex, ${locationColumns('l')}
         FROM Note n
         LEFT JOIN Location l ON l.LocationId = n.LocationId
         LEFT JOIN UserMark um ON um.UserMarkId = n.UserMarkId
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY n.LastModified DESC, n.NoteId DESC`,
      params,
    );
    const tagsByNote = this.tagsByNote();
    return rows.map((r) => ({
      id: r['NoteId'] as number,
      guid: r['Guid'] as string,
      title: (r['Title'] as string) ?? '',
      content: (r['Content'] as string) ?? '',
      created: r['Created'] as string,
      lastModified: r['LastModified'] as string,
      highlightColor: (r['ColorIndex'] as number) ?? null,
      location: readLocation(r),
      tags: tagsByNote.get(r['NoteId'] as number) ?? [],
    }));
  }

  get(id: number): NoteItem | undefined {
    return this.list().find((n) => n.id === id);
  }

  /** Publications that have at least one note, for the filter dropdown. */
  publications(): string[] {
    return this.db
      .all<{ KeySymbol: string }>(
        `SELECT DISTINCT l.KeySymbol FROM Note n JOIN Location l ON l.LocationId = n.LocationId
          WHERE l.KeySymbol IS NOT NULL ORDER BY l.KeySymbol`,
      )
      .map((r) => r.KeySymbol);
  }

  create(draft: NoteDraft): number {
    const ts = isoNow();
    return this.db.run(`INSERT INTO Note (Guid, Title, Content, LastModified, Created, BlockType) VALUES (?, ?, ?, ?, ?, 0)`, [
      crypto.randomUUID().toUpperCase(),
      draft.title,
      draft.content,
      ts,
      ts,
    ]).lastId;
  }

  update(id: number, draft: NoteDraft): void {
    this.db.run(`UPDATE Note SET Title = ?, Content = ?, LastModified = ? WHERE NoteId = ?`, [draft.title, draft.content, isoNow(), id]);
  }

  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM TagMap WHERE NoteId = ?', [id]);
      this.db.run('DELETE FROM Note WHERE NoteId = ?', [id]);
    });
  }

  addTag(noteId: number, tagId: number): void {
    this.tags.attach(tagId, { noteId });
  }

  removeTag(noteId: number, tagId: number): void {
    this.db.run('DELETE FROM TagMap WHERE NoteId = ? AND TagId = ?', [noteId, tagId]);
  }

  private tagsByNote(): Map<number, TagRef[]> {
    const map = new Map<number, TagRef[]>();
    const rows = this.db.all<{ NoteId: number; TagId: number; Name: string }>(
      `SELECT m.NoteId, t.TagId, t.Name FROM TagMap m JOIN Tag t ON t.TagId = m.TagId
        WHERE m.NoteId IS NOT NULL AND t.Type = ? ORDER BY t.Name`,
      [TagType.User],
    );
    for (const r of rows) {
      const list = map.get(r.NoteId) ?? [];
      list.push({ id: r.TagId, name: r.Name });
      map.set(r.NoteId, list);
    }
    return map;
  }
}
