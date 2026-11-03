import { LocationInfo, LocationRow } from './userdata.models';

export const BIBLE_BOOKS = [
  'Gênesis',
  'Êxodo',
  'Levítico',
  'Números',
  'Deuteronômio',
  'Josué',
  'Juízes',
  'Rute',
  '1 Samuel',
  '2 Samuel',
  '1 Reis',
  '2 Reis',
  '1 Crônicas',
  '2 Crônicas',
  'Esdras',
  'Neemias',
  'Ester',
  'Jó',
  'Salmos',
  'Provérbios',
  'Eclesiastes',
  'Cântico de Salomão',
  'Isaías',
  'Jeremias',
  'Lamentações',
  'Ezequiel',
  'Daniel',
  'Oseias',
  'Joel',
  'Amós',
  'Obadias',
  'Jonas',
  'Miqueias',
  'Naum',
  'Habacuque',
  'Sofonias',
  'Ageu',
  'Zacarias',
  'Malaquias',
  'Mateus',
  'Marcos',
  'Lucas',
  'João',
  'Atos',
  'Romanos',
  '1 Coríntios',
  '2 Coríntios',
  'Gálatas',
  'Efésios',
  'Filipenses',
  'Colossenses',
  '1 Tessalonicenses',
  '2 Tessalonicenses',
  '1 Timóteo',
  '2 Timóteo',
  'Tito',
  'Filemom',
  'Hebreus',
  'Tiago',
  '1 Pedro',
  '2 Pedro',
  '1 João',
  '2 João',
  '3 João',
  'Judas',
  'Apocalipse',
];

/** Friendly names for the most common publication symbols; unknown ones fall back to the symbol itself. */
const PUBLICATIONS: Record<string, string> = {
  nwt: 'Bíblia (Tradução do Novo Mundo)',
  nwtsty: 'Bíblia de Estudo',
  bi12: 'Bíblia (1986)',
  w: 'A Sentinela',
  wp: 'A Sentinela (público)',
  g: 'Despertai!',
  mwb: 'Apostila Vida e Ministério',
  es: 'Examine as Escrituras Diariamente',
  lff: 'Seja Feliz para Sempre!',
  lmd: 'Ame as Pessoas',
  bt: 'Testemunho Cabal',
  cl: 'Achegue-se a Jeová',
  jy: 'Jesus — o Caminho',
  lv: 'Amor de Deus',
  rr: 'Adoração Pura',
  ia: 'Imite a Sua Fé',
  sjj: 'Cante de Coração',
  it: 'Estudo Perspicaz',
  rsg: 'Guia de Pesquisa',
  scl: 'Textos Bíblicos para a Vida Cristã',
  od: 'Organizados',
  km: 'Nosso Ministério do Reino',
};

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function publicationName(keySymbol: string | null | undefined): string {
  if (!keySymbol) return 'Sem publicação';
  return PUBLICATIONS[keySymbol] ?? keySymbol;
}

/** IssueTagNumber is YYYYMMDD (DD = 00 for monthly issues). */
export function formatIssue(issue: number | null | undefined): string {
  if (!issue) return '';
  const s = String(issue);
  const year = s.slice(0, 4);
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const m = MONTHS[month - 1] ?? '';
  return day ? `${day} ${m}/${year}` : `${m}/${year}`;
}

export function describeLocation(row: Partial<LocationRow> & { LocationId: number }): LocationInfo {
  const publication = publicationName(row.KeySymbol);
  let label: string;
  if (row.BookNumber) {
    const book = BIBLE_BOOKS[row.BookNumber - 1] ?? `Livro ${row.BookNumber}`;
    label = row.ChapterNumber ? `${book} ${row.ChapterNumber}` : book;
  } else if (row.Title) {
    label = row.Title;
  } else {
    label = [publication, formatIssue(row.IssueTagNumber)].filter(Boolean).join(' ');
    if (row.DocumentId) label += ` · doc ${row.DocumentId}`;
  }
  return { id: row.LocationId, label, publication, keySymbol: row.KeySymbol ?? null };
}

/** JW Library highlight palette (UserMark.ColorIndex). */
export const HIGHLIGHT_COLORS: { index: number; name: string; css: string }[] = [
  { index: 1, name: 'Amarelo', css: '#f9e46b' },
  { index: 2, name: 'Verde', css: '#9be37b' },
  { index: 3, name: 'Azul', css: '#7fc4f5' },
  { index: 4, name: 'Rosa', css: '#f59fd0' },
  { index: 5, name: 'Laranja', css: '#f8b26a' },
  { index: 6, name: 'Roxo', css: '#bba2f2' },
];

export function highlightCss(index: number | null | undefined): string {
  return HIGHLIGHT_COLORS.find((c) => c.index === index)?.css ?? 'transparent';
}
