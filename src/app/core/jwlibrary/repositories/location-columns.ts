import { describeLocation } from '../models/location-format';
import { LocationInfo, LocationRow } from '../models/userdata.models';

/** SELECT fragment that pulls the Location columns needed by describeLocation(), prefixed to avoid clashes. */
export function locationColumns(alias: string, prefix = 'loc_'): string {
  return ['LocationId', 'BookNumber', 'ChapterNumber', 'DocumentId', 'IssueTagNumber', 'KeySymbol', 'Title']
    .map((c) => `${alias}.${c} AS ${prefix}${c}`)
    .join(', ');
}

export function readLocation(row: Record<string, unknown>, prefix = 'loc_'): LocationInfo | null {
  const id = row[`${prefix}LocationId`] as number | null;
  if (id == null) return null;
  const pick = <K extends keyof LocationRow>(k: K) => row[`${prefix}${k}`] as LocationRow[K];
  return describeLocation({
    LocationId: id,
    BookNumber: pick('BookNumber'),
    ChapterNumber: pick('ChapterNumber'),
    DocumentId: pick('DocumentId'),
    IssueTagNumber: pick('IssueTagNumber'),
    KeySymbol: pick('KeySymbol'),
    Title: pick('Title'),
  });
}

export function likeParam(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
