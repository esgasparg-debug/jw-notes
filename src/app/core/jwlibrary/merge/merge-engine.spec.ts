import { TestBed } from '@angular/core/testing';
import { createUserDataDb, seed } from '../../../../testing/userdata-schema';
import { SqlJsService } from '../database/sql-js.service';
import { SqliteDb } from '../database/sqlite-db';
import { mergeUserData } from './merge-engine';
import { DEFAULT_MERGE_REQUEST, MergeOptions } from './merge.models';

const NEWEST: MergeOptions = { conflictPolicy: 'newest', include: DEFAULT_MERGE_REQUEST.include };

describe('mergeUserData', () => {
  let target: SqliteDb;
  let source: SqliteDb;

  beforeEach(async () => {
    const sql = TestBed.inject(SqlJsService);
    target = await createUserDataDb(sql, '2026-01-01T00:00:00Z');
    source = await createUserDataDb(sql, '2026-02-01T00:00:00Z');
  });

  afterEach(() => {
    target.close();
    source.close();
  });

  const count = (db: SqliteDb, table: string) => db.scalar<number>(`SELECT COUNT(*) FROM ${table}`);

  it('adds notes that only exist in the source and reuses matching locations', () => {
    const t = seed(target);
    const s = seed(source);
    const tLoc = t.bibleChapter(40, 5);
    t.note('N1', 'Sermão', 'texto A', '2026-01-01T00:00:00Z', tLoc);
    const sLoc = s.bibleChapter(40, 5);
    s.note('N2', 'Bem-aventuranças', 'texto B', '2026-01-02T00:00:00Z', sLoc);

    const report = mergeUserData(target, source, NEWEST);

    expect(report.counters.notes.added).toBe(1);
    expect(count(target, 'Note')).toBe(2);
    expect(count(target, 'Location')).toBe(1);
    expect(target.scalar('SELECT LocationId FROM Note WHERE Guid = ?', ['N2'])).toBe(tLoc);
  });

  it('keeps the most recently edited version of the same note', () => {
    seed(target).note('N1', 'Título', 'antigo', '2026-01-01T00:00:00Z');
    seed(source).note('N1', 'Título', 'novo', '2026-03-01T00:00:00Z');

    const report = mergeUserData(target, source, NEWEST);

    expect(target.scalar<string>('SELECT Content FROM Note WHERE Guid = ?', ['N1'])).toBe('novo');
    expect(report.counters.notes.updated).toBe(1);
    expect(report.conflicts[0].resolution).toBe('took-source');
  });

  it('respects a "keep target" policy even when the source note is newer', () => {
    seed(target).note('N1', 'Título', 'meu', '2026-01-01T00:00:00Z');
    seed(source).note('N1', 'Título', 'outro', '2026-03-01T00:00:00Z');

    mergeUserData(target, source, { ...NEWEST, conflictPolicy: 'target' });

    expect(target.scalar<string>('SELECT Content FROM Note WHERE Guid = ?', ['N1'])).toBe('meu');
  });

  it('treats identical notes with different GUIDs at the same place as one note', () => {
    const tLoc = seed(target).bibleChapter(1, 1);
    seed(target).note('A', 'x', 'igual', '2026-01-01T00:00:00Z', tLoc);
    const sLoc = seed(source).bibleChapter(1, 1);
    seed(source).note('B', 'x', 'igual', '2026-01-01T00:00:00Z', sLoc);

    const report = mergeUserData(target, source, NEWEST);

    expect(count(target, 'Note')).toBe(1);
    expect(report.counters.notes.identical).toBe(1);
  });

  it('merges highlights by GUID and deduplicates identical ranges created on both devices', () => {
    const tLoc = seed(target).bibleChapter(43, 3);
    seed(target).highlight('H1', tLoc, 1, 16, 0, 10);
    const sLoc = seed(source).bibleChapter(43, 3);
    seed(source).highlight('H1', sLoc, 1, 16, 0, 10); // same GUID
    seed(source).highlight('H2', sLoc, 2, 16, 0, 10); // same range, other device
    seed(source).highlight('H3', sLoc, 3, 17, 0, 5); // new verse

    const report = mergeUserData(target, source, NEWEST);

    expect(count(target, 'UserMark')).toBe(2);
    expect(count(target, 'BlockRange')).toBe(2);
    expect(report.counters.highlights.added).toBe(1);
  });

  it('replaces partially overlapping highlights when the source wins and keeps notes attached', () => {
    const t = seed(target);
    const tLoc = t.bibleChapter(19, 23);
    const oldMark = t.highlight('OLD', tLoc, 1, 1, 0, 5);
    t.note('N', 'nota', 'na marcação', '2026-01-01T00:00:00Z', tLoc, oldMark);
    const sLoc = seed(source).bibleChapter(19, 23);
    seed(source).highlight('NEW', sLoc, 2, 1, 3, 9);

    const report = mergeUserData(target, source, NEWEST); // source file is newer

    expect(target.scalar('SELECT COUNT(*) FROM UserMark WHERE UserMarkGuid = ?', ['OLD'])).toBe(0);
    const newId = target.scalar<number>('SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?', ['NEW']);
    expect(target.scalar('SELECT UserMarkId FROM Note WHERE Guid = ?', ['N'])).toBe(newId);
    expect(report.conflicts.some((c) => c.entity === 'highlights' && c.resolution === 'took-source')).toBe(true);
  });

  it('links notes to the merged highlight and carries their tags', () => {
    const s = seed(source);
    const loc = s.bibleChapter(1, 1);
    const mark = s.highlight('H', loc, 4, 1, 0, 3);
    const note = s.note('N', 'n', 'c', '2026-01-01T00:00:00Z', loc, mark);
    const tag = s.tag('Estudo');
    s.tagNote(tag, note, 0);
    const existingTag = seed(target).tag('Estudo');

    mergeUserData(target, source, NEWEST);

    const noteId = target.scalar<number>('SELECT NoteId FROM Note WHERE Guid = ?', ['N']);
    const markId = target.scalar<number>('SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?', ['H']);
    expect(target.scalar('SELECT UserMarkId FROM Note WHERE NoteId = ?', [noteId!])).toBe(markId);
    expect(target.scalar('SELECT TagId FROM TagMap WHERE NoteId = ?', [noteId!])).toBe(existingTag);
    expect(count(target, 'Tag')).toBe(1);
  });

  it('moves a bookmark to a free slot when its slot is taken by a different place', () => {
    const t = seed(target);
    const tPub = t.publication();
    t.bookmark(tPub, t.bibleChapter(1, 1), 0, 'Gênesis 1');
    const s = seed(source);
    const sPub = s.publication();
    s.bookmark(sPub, s.bibleChapter(1, 2), 0, 'Gênesis 2');

    const report = mergeUserData(target, source, NEWEST);

    expect(target.all<{ Slot: number }>('SELECT Slot FROM Bookmark ORDER BY Slot').map((r) => r.Slot)).toEqual([0, 1]);
    expect(report.conflicts[0].resolution).toBe('kept-both');
  });

  it('merges publication input fields and resolves differing answers by file date', () => {
    const tLoc = seed(target).document(1102024123, 'mwb', 20240100);
    seed(target).inputField(tLoc, 'p1', 'resposta antiga');
    const sLoc = seed(source).document(1102024123, 'mwb', 20240100);
    seed(source).inputField(sLoc, 'p1', 'resposta nova');
    seed(source).inputField(sLoc, 'p2', 'outra');

    const report = mergeUserData(target, source, NEWEST);

    expect(target.scalar<string>("SELECT Value FROM InputField WHERE TextTag = 'p1'")).toBe('resposta nova');
    expect(count(target, 'InputField')).toBe(2);
    expect(report.counters.inputFields).toEqual({ added: 1, updated: 1, identical: 0 });
  });

  it('skips entity types that were not selected', () => {
    seed(source).note('N', 't', 'c', '2026-01-01T00:00:00Z');

    mergeUserData(target, source, { ...NEWEST, include: { ...NEWEST.include, notes: false } });

    expect(count(target, 'Note')).toBe(0);
  });

  it('is idempotent: merging the same source twice adds nothing the second time', () => {
    const s = seed(source);
    const loc = s.bibleChapter(2, 3);
    s.note('N', 't', 'c', '2026-01-01T00:00:00Z', loc);
    s.highlight('H', loc, 1, 1, 0, 1);

    mergeUserData(target, source, NEWEST);
    const second = mergeUserData(target, source, NEWEST);

    expect(second.counters.notes.added).toBe(0);
    expect(second.counters.highlights.added).toBe(0);
    expect(second.conflicts.length).toBe(0);
  });
});
