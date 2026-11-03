import { Injectable, InjectionToken, inject } from '@angular/core';
import type { SqlJsStatic } from 'sql.js';
import { SqliteDb } from './sqlite-db';

/** Where angular.json copies the sql.js WebAssembly binary (see the "assets" section). */
export const SQL_WASM_DIR = 'assets/sqljs/';

/**
 * Loads the sql.js engine. The default uses the WebAssembly build served from SQL_WASM_DIR;
 * tests swap in the pure-JS build, which needs no binary download.
 */
export const SQL_JS_LOADER = new InjectionToken<() => Promise<SqlJsStatic>>('SQL_JS_LOADER', {
  providedIn: 'root',
  factory: () => () => import('sql.js').then((m) => m.default({ locateFile: (file: string) => `${SQL_WASM_DIR}${file}` })),
});

/** Loads the SQLite engine once and opens databases with it. Works fully offline. */
@Injectable({ providedIn: 'root' })
export class SqlJsService {
  private readonly loader = inject(SQL_JS_LOADER);
  private engine?: Promise<SqlJsStatic>;

  async open(bytes?: Uint8Array): Promise<SqliteDb> {
    const SQL = await this.load();
    return new SqliteDb(new SQL.Database(bytes));
  }

  private load(): Promise<SqlJsStatic> {
    this.engine ??= this.loader().catch((e) => {
      this.engine = undefined;
      throw e;
    });
    return this.engine;
  }
}
