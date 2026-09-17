import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {storageKey,encrypted,encryptFile,decryptFile} from './encryption.mjs';

export class HomeStorage {
  constructor(directory, secret) {
    this.directory = resolve(directory);
    this.fileKey = secret ? storageKey(secret) : null;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.directory, 'files'), { recursive: true, mode: 0o700 });
    this.sql = new DatabaseSync(join(this.directory, 'chuljang.sqlite'));
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (!this.sql.prepare("SELECT 1 FROM sqlite_master WHERE name='receipts'").get()) {
      this.sql.exec(readFileSync(resolve('drizzle/0000_fluffy_fallen_one.sql'), 'utf8'));
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS home_schema_migrations (name TEXT PRIMARY KEY)');
    this.sql.prepare('INSERT OR IGNORE INTO home_schema_migrations VALUES (?)').run('0000_fluffy_fallen_one.sql');
    for(const name of readdirSync(resolve('drizzle')).filter(name=>/^\d+_.+\.sql$/.test(name)).sort()){
      if(this.sql.prepare('SELECT 1 FROM home_schema_migrations WHERE name=?').get(name))continue;
      this.transaction(()=>{this.sql.exec(readFileSync(resolve('drizzle',name),'utf8'));this.sql.prepare('INSERT INTO home_schema_migrations VALUES (?)').run(name);});
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS home_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS home_sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS home_login_attempts (time INTEGER NOT NULL);`);
    if(this.fileKey)for(const name of readdirSync(join(this.directory,'files'))){
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      const path=join(this.directory,'files',name),bytes=readFileSync(path);
      if(encrypted(bytes)){decryptFile(this.fileKey,'receipts/'+name,bytes);continue;}
      const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,encryptFile(this.fileKey,'receipts/'+name,bytes),{mode:0o600,flag:'wx'});renameSync(temp,path);
    }
  }
  get(key) { const row = this.sql.prepare('SELECT value FROM home_state WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; }
  set(key, value) { this.sql.prepare('INSERT INTO home_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  delete(key) { this.sql.prepare('DELETE FROM home_state WHERE key=?').run(key); }
  transaction(operation) {
    this.sql.exec('BEGIN IMMEDIATE');
    try { const value = operation(); this.sql.exec('COMMIT'); return value; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  prepare(query) { return new Statement(this, query); }
  async batch(statements) { return this.transaction(() => statements.map(statement => statement.execute())); }
  filePath(key) {
    if (!/^receipts\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid file key');
    return join(this.directory, 'files', key.slice(9));
  }
  bucket() {
    return {
      put: async (key, stream) => {
        const target = this.filePath(key), temp = target + '.' + randomUUID() + '.tmp';
        const bytes = await new Response(stream).arrayBuffer();
        if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('File too large');
        try { await writeFile(temp, this.fileKey?encryptFile(this.fileKey,key,new Uint8Array(bytes)):new Uint8Array(bytes), { mode: 0o600, flag: 'wx' }); await rename(temp, target); }
        finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      },
      get: async key => { try { const bytes=await readFile(this.filePath(key));return { body: new Uint8Array(this.fileKey?decryptFile(this.fileKey,key,bytes):bytes) }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
      delete: async key => { await unlink(this.filePath(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); },
    };
  }
  close() { this.sql.close(); }
}
class Statement {
  constructor(storage, query, values = []) { this.storage = storage; this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.storage, this.query, values); }
  async all() { return { results: this.storage.sql.prepare(this.query).all(...this.values), success: true, meta: {} }; }
  async first(column) { const row = this.storage.sql.prepare(this.query).get(...this.values); return column ? row?.[column] ?? null : row ?? null; }
  execute() { const result = this.storage.sql.prepare(this.query).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
  async run() { return this.execute(); }
}
