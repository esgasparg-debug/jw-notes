import { Row, SqliteDb } from '../database/sqlite-db';

/**
 * Copies rows between two databases that may be on slightly different schema versions:
 * only the columns present in both tables are written.
 */
export class RowCopier {
  private readonly columns = new Map<string, Set<string>>();

  constructor(
    private readonly source: SqliteDb,
    private readonly target: SqliteDb,
  ) {}

  /** Inserts `row` into `table`, dropping `omit` columns and applying `overrides`. Returns the new rowid. */
  insert(table: string, row: Row, overrides: Row = {}, omit: string[] = []): number {
    const cols = this.shared(table).filter((c) => !omit.includes(c));
    const values = cols.map((c) => (c in overrides ? overrides[c] : row[c]) ?? null);
    const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    return this.target.run(sql, values).lastId;
  }

  hasColumn(table: string, column: string): boolean {
    return this.targetColumns(table).has(column);
  }

  private shared(table: string): string[] {
    const src = columnsOf(this.source, table);
    return [...this.targetColumns(table)].filter((c) => src.has(c));
  }

  private targetColumns(table: string): Set<string> {
    let cols = this.columns.get(table);
    if (!cols) {
      cols = columnsOf(this.target, table);
      this.columns.set(table, cols);
    }
    return cols;
  }
}

function columnsOf(db: SqliteDb, table: string): Set<string> {
  return new Set(db.all<{ name: string }>(`PRAGMA table_info("${table}")`).map((c) => c.name));
}
