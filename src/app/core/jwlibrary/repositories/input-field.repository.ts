import { SqliteDb } from '../database/sqlite-db';
import { InputFieldItem } from '../models/userdata.models';
import { likeParam, locationColumns, readLocation } from './location-columns';

/** Text typed into publication fields (e.g. answers/comments in study and meeting workbooks). */
export class InputFieldRepository {
  constructor(private readonly db: SqliteDb) {}

  list(text?: string): InputFieldItem[] {
    const filter = text?.trim();
    return this.db
      .all(
        `SELECT f.LocationId, f.TextTag, f.Value, ${locationColumns('l')}
           FROM InputField f JOIN Location l ON l.LocationId = f.LocationId
           ${filter ? `WHERE f.Value LIKE ? ESCAPE '\\'` : ''}
          ORDER BY l.KeySymbol, l.IssueTagNumber DESC, l.DocumentId, f.TextTag`,
        filter ? [likeParam(filter)] : [],
      )
      .map((r) => ({
        locationId: r['LocationId'] as number,
        textTag: r['TextTag'] as string,
        value: (r['Value'] as string) ?? '',
        location: readLocation(r)!,
      }));
  }

  update(locationId: number, textTag: string, value: string): void {
    this.db.run('UPDATE InputField SET Value = ? WHERE LocationId = ? AND TextTag = ?', [value, locationId, textTag]);
  }

  delete(locationId: number, textTag: string): void {
    this.db.run('DELETE FROM InputField WHERE LocationId = ? AND TextTag = ?', [locationId, textTag]);
  }
}
