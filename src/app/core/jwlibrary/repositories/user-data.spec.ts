import { TestBed } from '@angular/core/testing';
import { createUserDataDb, seed } from '../../../../testing/userdata-schema';
import { SqlJsService } from '../database/sql-js.service';
import { UserData } from './user-data';

describe('UserData repositories', () => {
  let data: UserData;

  beforeEach(async () => {
    data = new UserData(await createUserDataDb(TestBed.inject(SqlJsService)));
  });

  afterEach(() => data.db.close());

  it('creates, filters, updates and deletes notes', () => {
    const id = data.notes.create({ title: 'Oração', content: 'Filipenses 4:6' });
    data.notes.create({ title: 'Outra', content: 'sem relação' });

    expect(data.notes.list({ text: 'filipenses' }).map((n) => n.id)).toEqual([id]);

    data.notes.update(id, { title: 'Oração', content: 'editado' });
    expect(data.notes.get(id)?.content).toBe('editado');

    data.notes.delete(id);
    expect(data.notes.get(id)).toBeUndefined();
  });

  it('treats LIKE wildcards in the search text literally', () => {
    data.notes.create({ title: '100% certo', content: '' });
    data.notes.create({ title: '100 vezes', content: '' });

    expect(data.notes.list({ text: '100%' }).length).toBe(1);
  });

  it('tags notes, filters by tag and untags', () => {
    const note = data.notes.create({ title: 'n', content: '' });
    const other = data.notes.create({ title: 'm', content: '' });
    const tag = data.tags.create('Pregação');
    data.notes.addTag(note, tag);
    data.notes.addTag(note, tag); // no duplicate

    expect(data.notes.list({ tag }).map((n) => n.id)).toEqual([note]);
    expect(data.notes.list({ tag: 'none' }).map((n) => n.id)).toEqual([other]);
    expect(data.tags.list()[0].usage).toBe(1);

    data.notes.removeTag(note, tag);
    expect(data.notes.get(note)?.tags).toEqual([]);
  });

  it('rejects duplicate tag names and merges tags without losing items', () => {
    const a = data.tags.create('A');
    const b = data.tags.create('B');
    expect(() => data.tags.create('A')).toThrow(/Já existe/);
    expect(() => data.tags.rename(b, 'A')).toThrow(/Já existe/);

    const n1 = data.notes.create({ title: '1', content: '' });
    const n2 = data.notes.create({ title: '2', content: '' });
    data.notes.addTag(n1, a);
    data.notes.addTag(n2, b);
    data.notes.addTag(n1, b);

    data.tags.mergeInto(b, a);

    expect(data.tags.list().map((t) => t.name)).toEqual(['A']);
    expect(data.notes.list({ tag: a }).length).toBe(2);
  });

  it('deleting a highlight keeps its notes', () => {
    const s = seed(data.db);
    const loc = s.bibleChapter(1, 1);
    const mark = s.highlight('H', loc, 1, 1, 0, 2);
    s.note('N', 't', 'c', '2026-01-01T00:00:00Z', loc, mark);

    data.highlights.delete(mark);

    expect(data.highlights.list().length).toBe(0);
    expect(data.notes.list()[0].highlightColor).toBeNull();
  });

  it('describes Bible locations with the book name', () => {
    const s = seed(data.db);
    const loc = s.bibleChapter(40, 24);
    s.note('N', 't', 'c', '2026-01-01T00:00:00Z', loc);

    expect(data.notes.list()[0].location?.label).toBe('Mateus 24');
  });
});
