import { HomeStorage } from './storage.mjs';

type Runtime = {storage:HomeStorage;collector?:{request:(owner:string,values:Record<string,unknown>)=>Promise<unknown>}};
const key=Symbol.for('chuljang.home.runtime');
const shared=globalThis as typeof globalThis & {[key]:Runtime|undefined};
export function runtime():Runtime{
  if(!shared[key])shared[key]={storage:new HomeStorage(process.env.CHULJANG_DATA_DIR||'./selfhost-data')};
  return shared[key]!;
}
// Only the home build resolves cloudflare:workers to this module. No cloud SDK
// or cloud account is needed by these storage bindings.
export const env={
  get HOME_ORIGIN(){return process.env.HOME_ORIGIN;},
  get DB(){return runtime().storage as unknown as D1Database;},
  get BUCKET(){return runtime().storage.bucket() as unknown as R2Bucket;},
  get HOME_COLLECTOR(){return runtime().collector;},
};
