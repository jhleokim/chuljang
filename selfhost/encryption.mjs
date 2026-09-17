import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const magic=Buffer.from('CHULJANG-ENCRYPTED-1\0');
export function storageKey(secret){if(!secret||secret.length<40)throw new Error('Missing storage encryption secret');return createHash('sha256').update('chuljang-private-files-v1:'+secret).digest();}
export const encrypted=bytes=>Buffer.from(bytes).subarray(0,magic.length).equals(magic);
export function encryptFile(key,name,bytes){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(name));const data=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([magic,iv,cipher.getAuthTag(),data]);}
export function decryptFile(key,name,bytes){
 const value=Buffer.from(bytes);if(!encrypted(value))throw new Error('Unencrypted private file');
 const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',key,value.subarray(offset,offset+12));decipher.setAAD(Buffer.from(name));decipher.setAuthTag(value.subarray(offset+12,offset+28));return Buffer.concat([decipher.update(value.subarray(offset+28)),decipher.final()]);
}
