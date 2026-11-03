/** Row shapes of the JW Library userData.db (schema 14–16). Column names match the database. */

export interface LocationRow {
  LocationId: number;
  BookNumber: number | null;
  ChapterNumber: number | null;
  DocumentId: number | null;
  Track: number | null;
  IssueTagNumber: number;
  KeySymbol: string | null;
  MepsLanguage: number | null;
  Type: number;
  Title: string | null;
  Specialty?: string | null;
  Edition?: string | null;
}

export interface NoteRow {
  NoteId: number;
  Guid: string;
  UserMarkId: number | null;
  LocationId: number | null;
  Title: string | null;
  Content: string | null;
  LastModified: string;
  Created: string;
  BlockType: number;
  BlockIdentifier: number | null;
}

export interface UserMarkRow {
  UserMarkId: number;
  ColorIndex: number;
  LocationId: number;
  StyleIndex: number;
  UserMarkGuid: string;
  Version: number;
}

export interface BlockRangeRow {
  BlockRangeId: number;
  BlockType: number;
  Identifier: number;
  StartToken: number | null;
  EndToken: number | null;
  UserMarkId: number;
}

export interface TagRow {
  TagId: number;
  Type: number;
  Name: string;
}

export interface TagMapRow {
  TagMapId: number;
  PlaylistItemId: number | null;
  LocationId: number | null;
  NoteId: number | null;
  TagId: number;
  Position: number;
}

export interface BookmarkRow {
  BookmarkId: number;
  LocationId: number;
  PublicationLocationId: number;
  Slot: number;
  Title: string;
  Snippet: string | null;
  BlockType: number;
  BlockIdentifier: number | null;
}

export interface InputFieldRow {
  LocationId: number;
  TextTag: string;
  Value: string;
}

/** Tag.Type values. */
export enum TagType {
  Favorite = 0,
  User = 1,
  Playlist = 2,
}

/* ---------- view models used by the editor ---------- */

export interface LocationInfo {
  id: number;
  /** Human-readable place, e.g. "Mateus 5" or "A Sentinela nov/2024". */
  label: string;
  publication: string;
  keySymbol: string | null;
}

export interface TagRef {
  id: number;
  name: string;
}

export interface NoteItem {
  id: number;
  guid: string;
  title: string;
  content: string;
  created: string;
  lastModified: string;
  location: LocationInfo | null;
  highlightColor: number | null;
  tags: TagRef[];
}

export interface NoteDraft {
  title: string;
  content: string;
}

export interface NoteFilter {
  text?: string;
  /** A tag id, `'none'` for untagged notes, or empty for all. */
  tag?: number | 'none' | null;
  publication?: string | null;
}

export interface HighlightItem {
  id: number;
  guid: string;
  colorIndex: number;
  location: LocationInfo;
  ranges: { blockType: number; identifier: number; start: number | null; end: number | null }[];
  noteCount: number;
}

export interface BookmarkItem {
  id: number;
  slot: number;
  title: string;
  snippet: string;
  location: LocationInfo;
  publication: LocationInfo;
}

export interface InputFieldItem {
  locationId: number;
  textTag: string;
  value: string;
  location: LocationInfo;
}

export interface TagItem {
  id: number;
  name: string;
  type: TagType;
  usage: number;
}

export interface DocumentStats {
  notes: number;
  highlights: number;
  bookmarks: number;
  inputFields: number;
  tags: number;
  playlists: number;
}
