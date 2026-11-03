import { SqlJsService } from '../app/core/jwlibrary/database/sql-js.service';
import { SqliteDb } from '../app/core/jwlibrary/database/sqlite-db';

/** userData.db schema 16 as shipped by JW Library (CHECK constraints trimmed to the ones that matter for tests). */
export const USERDATA_SCHEMA = `
PRAGMA user_version = 16;
CREATE TABLE Location(
  LocationId INTEGER NOT NULL PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER, DocumentId INTEGER, Track INTEGER,
  IssueTagNumber INTEGER NOT NULL DEFAULT 0, KeySymbol TEXT, MepsLanguage INTEGER, Type INTEGER NOT NULL, Title TEXT,
  Specialty TEXT, Edition TEXT,
  UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type));
CREATE UNIQUE INDEX IX_Location_Media ON Location(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type, COALESCE(Specialty, ''), COALESCE(Edition, ''));
CREATE TABLE UserMark(
  UserMarkId INTEGER NOT NULL PRIMARY KEY, ColorIndex INTEGER NOT NULL, LocationId INTEGER NOT NULL, StyleIndex INTEGER NOT NULL,
  UserMarkGuid TEXT NOT NULL UNIQUE, Version INTEGER NOT NULL);
CREATE TABLE BlockRange(
  BlockRangeId INTEGER NOT NULL PRIMARY KEY, BlockType INTEGER NOT NULL, Identifier INTEGER NOT NULL, StartToken INTEGER,
  EndToken INTEGER, UserMarkId INTEGER NOT NULL, CHECK (BlockType BETWEEN 1 AND 2));
CREATE TABLE Note(
  NoteId INTEGER NOT NULL PRIMARY KEY, Guid TEXT NOT NULL UNIQUE, UserMarkId INTEGER, LocationId INTEGER, Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  Created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL) OR((BlockType BETWEEN 1 AND 2) AND BlockIdentifier IS NOT NULL)));
CREATE TABLE Tag(TagId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, Name TEXT NOT NULL, UNIQUE(Type, Name), CHECK(length(Name) > 0));
CREATE TABLE TagMap(
  TagMapId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER, LocationId INTEGER, NoteId INTEGER, TagId INTEGER NOT NULL,
  Position INTEGER NOT NULL,
  CONSTRAINT TagId_Position UNIQUE(TagId, Position), CONSTRAINT TagId_NoteId UNIQUE(TagId, NoteId),
  CONSTRAINT TagId_LocationId UNIQUE(TagId, LocationId), CONSTRAINT TagId_PlaylistItemId UNIQUE(TagId, PlaylistItemId),
  CHECK((NoteId IS NULL AND LocationId IS NULL AND PlaylistItemId IS NOT NULL) OR
        (LocationId IS NULL AND PlaylistItemId IS NULL AND NoteId IS NOT NULL) OR
        (PlaylistItemId IS NULL AND NoteId IS NULL AND LocationId IS NOT NULL)));
CREATE TABLE Bookmark(
  BookmarkId INTEGER NOT NULL PRIMARY KEY, LocationId INTEGER NOT NULL, PublicationLocationId INTEGER NOT NULL, Slot INTEGER NOT NULL,
  Title TEXT NOT NULL, Snippet TEXT, BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  CONSTRAINT PublicationLocationId_Slot UNIQUE (PublicationLocationId, Slot));
CREATE TABLE InputField(LocationId INTEGER NOT NULL, TextTag TEXT NOT NULL, Value TEXT NOT NULL, PRIMARY KEY (LocationId, TextTag));
CREATE TABLE IndependentMedia(
  IndependentMediaId INTEGER NOT NULL PRIMARY KEY, OriginalFilename TEXT NOT NULL, FilePath TEXT NOT NULL UNIQUE,
  MimeType TEXT NOT NULL, Hash TEXT NOT NULL);
CREATE TABLE PlaylistItemAccuracy(PlaylistItemAccuracyId INTEGER NOT NULL PRIMARY KEY, Description TEXT NOT NULL UNIQUE);
CREATE TABLE PlaylistItem(
  PlaylistItemId INTEGER NOT NULL PRIMARY KEY, Label TEXT NOT NULL, StartTrimOffsetTicks INTEGER, EndTrimOffsetTicks INTEGER,
  Accuracy INTEGER NOT NULL, EndAction INTEGER NOT NULL, ThumbnailFilePath TEXT);
CREATE TABLE PlaylistItemIndependentMediaMap(
  PlaylistItemId INTEGER NOT NULL, IndependentMediaId INTEGER NOT NULL, DurationTicks INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemId, IndependentMediaId));
CREATE TABLE PlaylistItemLocationMap(
  PlaylistItemId INTEGER NOT NULL, LocationId INTEGER NOT NULL, MajorMultimediaType INTEGER NOT NULL, BaseDurationTicks INTEGER,
  PRIMARY KEY(PlaylistItemId, LocationId));
CREATE TABLE PlaylistItemMarker(
  PlaylistItemMarkerId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER NOT NULL, Label TEXT NOT NULL,
  StartTimeTicks INTEGER NOT NULL, DurationTicks INTEGER NOT NULL, EndTransitionDurationTicks INTEGER NOT NULL,
  UNIQUE(PlaylistItemId, StartTimeTicks));
CREATE TABLE PlaylistItemMarkerBibleVerseMap(PlaylistItemMarkerId INTEGER NOT NULL, VerseId INTEGER NOT NULL, PRIMARY KEY(PlaylistItemMarkerId, VerseId));
CREATE TABLE PlaylistItemMarkerParagraphMap(
  PlaylistItemMarkerId INTEGER NOT NULL, MepsDocumentId INTEGER NOT NULL, ParagraphIndex INTEGER NOT NULL,
  MarkerIndexWithinParagraph INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph));
CREATE TABLE LastModified(LastModified TEXT NOT NULL);
INSERT INTO LastModified VALUES ('2026-01-01T00:00:00Z');
`;

export async function createUserDataDb(sql: SqlJsService, lastModified = '2026-01-01T00:00:00Z'): Promise<SqliteDb> {
  const db = await sql.open();
  for (const stmt of USERDATA_SCHEMA.split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    db.run(stmt);
  db.run('UPDATE LastModified SET LastModified = ?', [lastModified]);
  return db;
}

/** Small helpers to seed rows tersely in specs. */
export function seed(db: SqliteDb) {
  return {
    bibleChapter(book: number, chapter: number, keySymbol = 'nwtsty', lang = 5): number {
      return db.run('INSERT INTO Location (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type) VALUES (?, ?, ?, ?, 0)', [
        book,
        chapter,
        keySymbol,
        lang,
      ]).lastId;
    },
    /** A whole publication (Location.Type = 1), as used by Bookmark.PublicationLocationId. */
    publication(keySymbol = 'nwtsty', lang = 5): number {
      return db.run('INSERT INTO Location (KeySymbol, MepsLanguage, Type) VALUES (?, ?, 1)', [keySymbol, lang]).lastId;
    },
    document(docId: number, keySymbol = 'w', issue = 20240100, lang = 5): number {
      return db.run('INSERT INTO Location (DocumentId, IssueTagNumber, KeySymbol, MepsLanguage, Type) VALUES (?, ?, ?, ?, 0)', [
        docId,
        issue,
        keySymbol,
        lang,
      ]).lastId;
    },
    highlight(guid: string, locationId: number, color: number, identifier: number, start: number | null, end: number | null): number {
      const id = db.run('INSERT INTO UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version) VALUES (?, ?, 0, ?, 1)', [
        color,
        locationId,
        guid,
      ]).lastId;
      db.run('INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId) VALUES (2, ?, ?, ?, ?)', [
        identifier,
        start,
        end,
        id,
      ]);
      return id;
    },
    note(
      guid: string,
      title: string,
      content: string,
      lastModified: string,
      locationId: number | null = null,
      userMarkId: number | null = null,
    ): number {
      return db.run(
        'INSERT INTO Note (Guid, Title, Content, LastModified, Created, LocationId, UserMarkId, BlockType) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
        [guid, title, content, lastModified, lastModified, locationId, userMarkId],
      ).lastId;
    },
    tag(name: string, type = 1): number {
      return db.run('INSERT INTO Tag (Type, Name) VALUES (?, ?)', [type, name]).lastId;
    },
    tagNote(tagId: number, noteId: number, position: number): void {
      db.run('INSERT INTO TagMap (TagId, NoteId, Position) VALUES (?, ?, ?)', [tagId, noteId, position]);
    },
    bookmark(pubId: number, locationId: number, slot: number, title: string): number {
      return db.run('INSERT INTO Bookmark (LocationId, PublicationLocationId, Slot, Title) VALUES (?, ?, ?, ?)', [
        locationId,
        pubId,
        slot,
        title,
      ]).lastId;
    },
    inputField(locationId: number, tag: string, value: string): void {
      db.run('INSERT INTO InputField (LocationId, TextTag, Value) VALUES (?, ?, ?)', [locationId, tag, value]);
    },
  };
}
