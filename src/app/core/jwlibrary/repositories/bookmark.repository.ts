import { SqliteDb } from '../database/sqlite-db';
import { BookmarkItem } from '../models/userdata.models';
import { locationColumns, readLocation } from './location-columns';

export class BookmarkRepository {
  constructor(private readonly db: SqliteDb) {}

  list(): BookmarkItem[] {
    return this.db
      .all(
        `SELECT b.BookmarkId, b.Slot, b.Title, b.Snippet, ${locationColumns('l')}, ${locationColumns('p', 'pub_')}
           FROM Bookmark b
           JOIN Location l ON l.LocationId = b.LocationId
           JOIN Location p ON p.LocationId = b.PublicationLocationId
          ORDER BY p.KeySymbol, b.Slot`,
      )
      .map((r) => ({
        id: r['BookmarkId'] as number,
        slot: r['Slot'] as number,
        title: (r['Title'] as string) ?? '',
        snippet: (r['Snippet'] as string) ?? '',
        location: readLocation(r)!,
        publication: readLocation(r, 'pub_')!,
      }));
  }

  update(id: number, title: string, snippet: string): void {
    if (!title.trim()) throw new Error('O marcador precisa de um título.');
    this.db.run('UPDATE Bookmark SET Title = ?, Snippet = ? WHERE BookmarkId = ?', [title.trim(), snippet || null, id]);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM Bookmark WHERE BookmarkId = ?', [id]);
  }
}
