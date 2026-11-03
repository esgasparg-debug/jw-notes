import { isoNow } from '../archive/jwlibrary-archive';
import { SqliteDb } from '../database/sqlite-db';
import { DocumentStats } from '../models/userdata.models';
import { BookmarkRepository } from './bookmark.repository';
import { HighlightRepository } from './highlight.repository';
import { InputFieldRepository } from './input-field.repository';
import { NoteRepository } from './note.repository';
import { TagRepository } from './tag.repository';

/** Unit of work over one open userData.db: groups every repository bound to the same connection. */
export class UserData {
  readonly tags: TagRepository;
  readonly notes: NoteRepository;
  readonly highlights: HighlightRepository;
  readonly bookmarks: BookmarkRepository;
  readonly inputFields: InputFieldRepository;

  constructor(readonly db: SqliteDb) {
    this.tags = new TagRepository(db);
    this.notes = new NoteRepository(db, this.tags);
    this.highlights = new HighlightRepository(db);
    this.bookmarks = new BookmarkRepository(db);
    this.inputFields = new InputFieldRepository(db);
  }

  stats(): DocumentStats {
    const count = (table: string, where = '') =>
      this.db.hasTable(table) ? (this.db.scalar<number>(`SELECT COUNT(*) FROM ${table} ${where}`) ?? 0) : 0;
    return {
      notes: count('Note'),
      highlights: count('UserMark'),
      bookmarks: count('Bookmark'),
      inputFields: count('InputField'),
      tags: count('Tag', 'WHERE Type = 1'),
      playlists: count('PlaylistItem'),
    };
  }

  schemaVersion(): number | undefined {
    return this.db.scalar<number>('PRAGMA user_version');
  }

  /** Bumps the single-row LastModified table, which JW Library uses to decide what is newer. */
  touch(ts = isoNow()): void {
    if (this.db.hasTable('LastModified')) this.db.run('UPDATE LastModified SET LastModified = ?', [ts]);
  }

  lastModified(): string | undefined {
    return this.db.hasTable('LastModified') ? this.db.scalar<string>('SELECT LastModified FROM LastModified') : undefined;
  }
}
