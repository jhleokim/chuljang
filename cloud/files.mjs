import { DurableObject } from 'cloudflare:workers';
import {storageKey,encryptFile,decryptFile} from '../selfhost/encryption.mjs';

// Each private file has its own object. No public object URL or shared cache.
export class PrivateFile extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS chunks(part INTEGER PRIMARY KEY,body BLOB NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  }
  async put(key,stream) {
    if (!/^receipts\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid key');
    const reader=stream.getReader(),chunks=[];let size=0;
    try { for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12*1024*1024){await reader.cancel();throw new Error('File too large');}chunks.push(value); } } finally {reader.releaseLock();}
    const bytes=encryptFile(storageKey(this.env.CLOUD_FILE_KEY),key,Buffer.concat(chunks));
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec('DELETE FROM chunks');
      for(let offset=0;offset<bytes.length;offset+=128*1024)this.ctx.storage.sql.exec('INSERT INTO chunks VALUES (?,?)',offset,bytes.subarray(offset,offset+128*1024));
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO metadata VALUES (?,?)','key',key);
    });
  }
  get(key) {
    const row=this.ctx.storage.sql.exec('SELECT value FROM metadata WHERE key=?','key').toArray()[0];
    if(!row||row.value!==key)return new Response(null,{status:404});
    const chunks=this.ctx.storage.sql.exec('SELECT body FROM chunks ORDER BY part').toArray();
    return new Response(decryptFile(storageKey(this.env.CLOUD_FILE_KEY),key,Buffer.concat(chunks.map(row=>Buffer.from(row.body)))),{headers:{'Cache-Control':'no-store'}});
  }
  remove() { this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM chunks');this.ctx.storage.sql.exec('DELETE FROM metadata');}); }
}
