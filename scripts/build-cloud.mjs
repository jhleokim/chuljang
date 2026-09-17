import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const pkg=JSON.parse(readFileSync('node_modules/vinext/package.json','utf8'));
const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin.vinext;
execFileSync(process.execPath,[resolve('node_modules/vinext',bin),'build'],{stdio:'inherit',env:{...process.env,CHULJANG_CLOUD_APP:'1'}});
// Vite's pinned Cloudflare plugin emits a field removed by newer Wrangler.
const file='dist/server/wrangler.json',config=JSON.parse(readFileSync(file,'utf8'));
delete config.legacy_env;
for(const database of config.d1_databases||[])if(database.migrations_dir)database.migrations_dir=resolve('drizzle');
writeFileSync(file,JSON.stringify(config,null,2)+'\n');
