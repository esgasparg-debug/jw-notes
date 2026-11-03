// The pure-JS (asm.js) build of sql.js ships without its own typings.
declare module 'sql.js/dist/sql-asm.js' {
  import type { SqlJsConfig, SqlJsStatic } from 'sql.js';
  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
