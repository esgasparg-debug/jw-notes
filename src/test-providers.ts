import { Provider } from '@angular/core';
import type { SqlJsStatic } from 'sql.js';
import { SQL_JS_LOADER } from './app/core/jwlibrary/database/sql-js.service';

/**
 * Providers added to every unit test (wired through "providersFile" in angular.json).
 * Tests run in Node + jsdom, so sql.js uses its pure-JS build instead of fetching a .wasm file.
 */
const providers: Provider[] = [
  {
    provide: SQL_JS_LOADER,
    useValue: () =>
      import('sql.js/dist/sql-asm.js').then((m: { default: (config?: object) => Promise<SqlJsStatic> }) => m.default()),
  },
];

export default providers;
