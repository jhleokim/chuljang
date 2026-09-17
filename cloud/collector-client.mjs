import {signCollector} from '../lib/collector-security.ts';
export async function sendCollector(env,owner,values) {
  const body=JSON.stringify({...values,owner,nonce:crypto.randomUUID()}),timestamp=String(Date.now());
  return fetch(env.CHULJANG_COLLECTOR_URL,{method:'POST',headers:{'Content-Type':'application/json','x-collector-time':timestamp,'x-collector-signature':await signCollector(env.CHULJANG_COLLECTOR_SECRET,timestamp,body)},body,signal:AbortSignal.timeout(25000),redirect:'manual'});
}
