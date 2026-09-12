export type ReceiptAttachment={name:string;mimeType:'application/pdf';base64:string};
export function attachmentFile(value:unknown):File|undefined{
 if(value===undefined)return;
 const file=value as ReceiptAttachment;
 if(!file||file.mimeType!=='application/pdf'||typeof file.name!=='string'||file.name.length>180||typeof file.base64!=='string'||file.base64.length>2000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw new Error('영수증 PDF 형식이 올바르지 않습니다.');
 const binary=atob(file.base64);if(!binary.startsWith('%PDF-'))throw new Error('영수증 원본이 PDF가 아닙니다.');
 return new File([Uint8Array.from(binary,char=>char.charCodeAt(0))],file.name.replace(/[\\/]/g,'-'),{type:'application/pdf'});
}
