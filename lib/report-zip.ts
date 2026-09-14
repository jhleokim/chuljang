import {unzipSync} from 'fflate';
export function checkWorkbook(bytes:Uint8Array){
 if(bytes.length>5*1024*1024)throw new Error('양식은 5MB 이하의 XLSX 파일로 올려주세요.');
 let expanded=0,count=0;const names:string[]=[];
 unzipSync(bytes,{filter:file=>{expanded+=file.originalSize;names.push(file.name);if(++count>1500||expanded>25*1024*1024||file.originalSize>8*1024*1024)throw new Error('양식의 압축 해제 크기가 너무 큽니다.');return false;}});
 if(!names.includes('xl/workbook.xml')||names.some(name=>/vbaProject|externalLinks|activeX/i.test(name)))throw new Error('매크로·외부 연결이 없는 XLSX 양식을 사용해 주세요.');
}
