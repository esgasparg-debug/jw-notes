import { SqliteDb } from '../database/sqlite-db';
import { HighlightItem } from '../models/userdata.models';
import { locationColumns, readLocation } from './location-columns';

export interface HighlightFilter {
  color?: number | null;
  publication?: string | null;
}

/** Highlights ("marcações") are UserMark rows; their text spans live in BlockRange. */
export class HighlightRepository {
  constructor(private readonly db: SqliteDb) {}

  list(filter: HighlightFilter = {}): HighlightItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.color != null) {
      where.push('um.ColorIndex = ?');
      params.push(filter.color);
    }
    if (filter.publication) {
      where.push('l.KeySymbol = ?');
      params.push(filter.publication);
    }
    const rows = this.db.all(
      `SELECT um.UserMarkId, um.UserMarkGuid, um.ColorIndex,
              (SELECT COUNT(*) FROM Note n WHERE n.UserMarkId = um.UserMarkId) AS NoteCount,
              ${locationColumns('l')}
         FROM UserMark um JOIN Location l ON l.LocationId = um.LocationId
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.KeySymbol, l.BookNumber, l.ChapterNumber, l.IssueTagNumber, l.DocumentId, um.UserMarkId`,
      params,
    );
    const ranges = this.rangesByMark();
    return rows.map((r) => ({
      id: r['UserMarkId'] as number,
      guid: r['UserMarkGuid'] as string,
      colorIndex: r['ColorIndex'] as number,
      noteCount: r['NoteCount'] as number,
      location: readLocation(r)!,
      ranges: ranges.get(r['UserMarkId'] as number) ?? [],
    }));
  }

  publications(): string[] {
    return this.db
      .all<{ KeySymbol: string }>(
        `SELECT DISTINCT l.KeySymbol FROM UserMark um JOIN Location l ON l.LocationId = um.LocationId
          WHERE l.KeySymbol IS NOT NULL ORDER BY l.KeySymbol`,
      )
      .map((r) => r.KeySymbol);
  }

  setColor(id: number, colorIndex: number): void {
    this.db.run('UPDATE UserMark SET ColorIndex = ? WHERE UserMarkId = ?', [colorIndex, id]);
  }

  /** Removes the highlight. Notes attached to it are kept, just no longer linked to a highlight. */
  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('UPDATE Note SET UserMarkId = NULL WHERE UserMarkId = ?', [id]);
      this.db.run('DELETE FROM BlockRange WHERE UserMarkId = ?', [id]);
      this.db.run('DELETE FROM UserMark WHERE UserMarkId = ?', [id]);
    });
  }

  private rangesByMark(): Map<number, HighlightItem['ranges']> {
    const map = new Map<number, HighlightItem['ranges']>();
    for (const r of this.db.all<{
      UserMarkId: number;
      BlockType: number;
      Identifier: number;
      StartToken: number | null;
      EndToken: number | null;
    }>('SELECT UserMarkId, BlockType, Identifier, StartToken, EndToken FROM BlockRange ORDER BY Identifier, StartToken')) {
      const list = map.get(r.UserMarkId) ?? [];
      list.push({ blockType: r.BlockType, identifier: r.Identifier, start: r.StartToken, end: r.EndToken });
      map.set(r.UserMarkId, list);
    }
    return map;
  }
}
