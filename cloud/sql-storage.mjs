// Adapter for the shared authentication implementation, backed by DO SQLite.
export class AuthStorage {
  constructor(state) {
    this.state = state;
    const sql = state.storage.sql;
    this.sql = {
      exec: query => sql.exec(query),
      prepare: query => ({
        get: (...values) => sql.exec(query, ...values).toArray()[0],
        all: (...values) => sql.exec(query, ...values).toArray(),
        run: (...values) => { sql.exec(query, ...values).toArray(); return { changes: sql.exec('SELECT changes() AS n').one().n }; },
      }),
    };
    sql.exec(`CREATE TABLE IF NOT EXISTS home_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS home_sessions(token TEXT PRIMARY KEY,expires INTEGER);
      CREATE TABLE IF NOT EXISTS receipts(user_id TEXT,attachment_key TEXT);
      CREATE TABLE IF NOT EXISTS trips(user_id TEXT);
      CREATE TABLE IF NOT EXISTS report_settings(user_id TEXT,template_key TEXT);
      CREATE TABLE IF NOT EXISTS report_shares(user_id TEXT,file_key TEXT);`);
  }
  transaction(operation) { return this.state.storage.transactionSync(operation); }
  get(key) { const row=this.sql.prepare('SELECT value FROM home_state WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; }
  set(key,value) { this.sql.prepare('INSERT INTO home_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  delete(key) { this.sql.prepare('DELETE FROM home_state WHERE key=?').run(key); }
  bucket() { return { delete: async () => {} }; }
}
