import { SqliteDb } from '../database/sqlite-db';
import { TagItem, TagType } from '../models/userdata.models';

export type TagTarget = { noteId: number } | { locationId: number } | { playlistItemId: number };

export class TagRepository {
  constructor(private readonly db: SqliteDb) {}

  list(type: TagType = TagType.User): TagItem[] {
    return this.db
      .all<{ TagId: number; Name: string; Type: number; Usage: number }>(
        `SELECT t.TagId, t.Name, t.Type, (SELECT COUNT(*) FROM TagMap m WHERE m.TagId = t.TagId) AS Usage
           FROM Tag t WHERE t.Type = ? ORDER BY t.Name COLLATE NOCASE`,
        [type],
      )
      .map((r) => ({ id: r.TagId, name: r.Name, type: r.Type as TagType, usage: r.Usage }));
  }

  create(name: string, type: TagType = TagType.User): number {
    const clean = this.validName(name);
    if (this.db.scalar('SELECT 1 FROM Tag WHERE Type = ? AND Name = ?', [type, clean])) {
      throw new Error(`Já existe uma etiqueta chamada "${clean}".`);
    }
    return this.db.run('INSERT INTO Tag (Type, Name) VALUES (?, ?)', [type, clean]).lastId;
  }

  rename(id: number, name: string): void {
    const clean = this.validName(name);
    const clash = this.db.scalar('SELECT TagId FROM Tag WHERE Name = ? AND Type = (SELECT Type FROM Tag WHERE TagId = ?) AND TagId <> ?', [
      clean,
      id,
      id,
    ]);
    if (clash) throw new Error(`Já existe uma etiqueta chamada "${clean}". Use "Mesclar" para juntá-las.`);
    this.db.run('UPDATE Tag SET Name = ? WHERE TagId = ?', [clean, id]);
  }

  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM TagMap WHERE TagId = ?', [id]);
      this.db.run('DELETE FROM Tag WHERE TagId = ?', [id]);
    });
  }

  /** Moves every item tagged with `sourceId` to `targetId` and removes the source tag. */
  mergeInto(sourceId: number, targetId: number): void {
    if (sourceId === targetId) return;
    this.db.transaction(() => {
      const maps = this.db.all<{ NoteId: number | null; LocationId: number | null; PlaylistItemId: number | null }>(
        'SELECT NoteId, LocationId, PlaylistItemId FROM TagMap WHERE TagId = ? ORDER BY Position',
        [sourceId],
      );
      for (const m of maps) {
        if (m.NoteId != null) this.attach(targetId, { noteId: m.NoteId });
        else if (m.LocationId != null) this.attach(targetId, { locationId: m.LocationId });
        else if (m.PlaylistItemId != null) this.attach(targetId, { playlistItemId: m.PlaylistItemId });
      }
      this.delete(sourceId);
    });
  }

  /** Adds an item to a tag at the end of its ordering; no-op if already tagged. */
  attach(tagId: number, target: TagTarget): void {
    const [col, value] =
      'noteId' in target
        ? ['NoteId', target.noteId]
        : 'locationId' in target
          ? ['LocationId', target.locationId]
          : ['PlaylistItemId', target.playlistItemId];
    if (this.db.scalar(`SELECT 1 FROM TagMap WHERE TagId = ? AND ${col} = ?`, [tagId, value])) return;
    const position = this.db.scalar<number>('SELECT IFNULL(MAX(Position), -1) + 1 FROM TagMap WHERE TagId = ?', [tagId]) ?? 0;
    this.db.run(`INSERT INTO TagMap (TagId, ${col}, Position) VALUES (?, ?, ?)`, [tagId, value, position]);
  }

  private validName(name: string): string {
    const clean = name.trim();
    if (!clean) throw new Error('O nome da etiqueta não pode ficar vazio.');
    return clean;
  }
}
