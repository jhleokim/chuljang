const bytes = (value:string) => new TextEncoder().encode(value);
export function base64url(value:Uint8Array){let text='';for(const n of value)text+=String.fromCharCode(n);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function signingKey(secret:string){return crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signCollector(secret:string,timestamp:string,body:string){return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),bytes(timestamp+'\n'+body))));}
export async function verifyCollector(secret:string,timestamp:string|null,signature:string|null,body:string,now=Date.now()){
 if(!timestamp||!signature||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000)return false;
 try{return await crypto.subtle.verify('HMAC',await signingKey(secret),unbase64(signature),bytes(timestamp+'\n'+body));}catch{return false;}
}
async function encryptionKey(secret:string){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bytes('chuljang-browser-state-v1:'+secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function sealCollector(secret:string,scope:string,value:unknown){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(scope)},await encryptionKey(secret),bytes(JSON.stringify(value)));return base64url(iv)+'.'+base64url(new Uint8Array(encrypted));}
export async function openCollector<T>(secret:string,scope:string,value:string):Promise<T>{const [iv,payload]=value.split('.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:bytes(scope)},await encryptionKey(secret),unbase64(payload));return JSON.parse(new TextDecoder().decode(plain)) as T;}
