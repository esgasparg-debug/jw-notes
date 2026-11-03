import type { BindParams, Database, SqlValue } from 'sql.js';

export type Row = Record<string, SqlValue>;
export type Params = SqlValue[] | Record<string, SqlValue>;

/**
 * Thin typed wrapper over a sql.js Database. Repositories and the merge engine depend on
 * this instead of sql.js directly, which keeps them small and easy to test.
 */
export class SqliteDb {
  private txDepth = 0;

  constructor(private readonly db: Database) {}

  all<T = Row>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as BindParams);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar<T extends SqlValue = number>(sql: string, params: Params = []): T | undefined {
    const row = this.get(sql, params);
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  /** Runs a write statement and returns the new rowid (for INSERTs) and number of changed rows. */
  run(sql: string, params: Params = []): { lastId: number; changes: number } {
    this.db.run(sql, params as BindParams);
    return {
      lastId: this.scalar<number>('SELECT last_insert_rowid()') ?? 0,
      changes: this.db.getRowsModified(),
    };
  }

  /** Executes `fn` atomically; nested calls join the outer transaction via savepoints. */
  transaction<T>(fn: () => T): T {
    const sp = `sp${this.txDepth++}`;
    this.db.run(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      this.db.run(`RELEASE ${sp}`);
      return result;
    } catch (e) {
      this.db.run(`ROLLBACK TO ${sp}`);
      this.db.run(`RELEASE ${sp}`);
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  tables(): string[] {
    return this.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map(
      (r) => r.name,
    );
  }

  hasTable(name: string): boolean {
    return !!this.scalar(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}
