type OCRWorker={recognize:(image:HTMLCanvasElement)=>Promise<{data:{text:string;confidence:number}}>;terminate:()=>Promise<void>};
type Engine={createWorker:(languages:string,oem:number,options:Record<string,unknown>)=>Promise<OCRWorker>};
let scriptPromise:Promise<Engine>|null=null;
function loadEngine():Promise<Engine>{
 if(scriptPromise)return scriptPromise;
 scriptPromise=new Promise<Engine>((resolve,reject)=>{
  const existing=(window as typeof window & {Tesseract?:Engine}).Tesseract;if(existing){resolve(existing);return;}
  const script=document.createElement('script');script.src='/vendor/ocr/tesseract.min.js';
  const timer=setTimeout(()=>{script.remove();reject(new Error('인식 파일을 불러오지 못했습니다. 다시 시도해 주세요.'));},45000);
  script.onload=()=>{clearTimeout(timer);const engine=(window as typeof window & {Tesseract?:Engine}).Tesseract;engine?resolve(engine):reject(new Error('인식 도구를 불러오지 못했습니다.'));};
  script.onerror=()=>{clearTimeout(timer);reject(new Error('인식 파일을 불러오지 못했습니다.'));};document.head.appendChild(script);
 }).catch(e=>{scriptPromise=null;throw e;});
 return scriptPromise;
}
async function deadline<T>(promise:Promise<T>,ms:number,signal?:AbortSignal):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{
  abort=()=>reject(new DOMException('인식을 취소했어요.','AbortError'));
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>reject(new Error('인식 시간이 초과되었습니다. 더 선명한 영수증을 사용해 주세요.')),ms);
 })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function ocr(canvas:HTMLCanvasElement,status:(s:string)=>void,signal?:AbortSignal){
 status('한국어 영수증 인식 준비 중…');const engine=await deadline(loadEngine(),45000,signal);signal?.throwIfAborted();let expired=false;let worker:OCRWorker|undefined;
 try{
  const creating=engine.createWorker('kor+eng',1,{workerPath:'/vendor/ocr/worker.min.js',corePath:'/vendor/ocr/',langPath:'/vendor/ocr/lang',workerBlobURL:false,errorHandler:()=>{}});
  void creating.then(w=>{if(expired)void w.terminate();}).catch(()=>{});
  worker=await deadline(creating,90000,signal);status('영수증의 글자를 읽는 중…');
  const result=await deadline(worker.recognize(canvas),90000,signal);
  if(!result.data.text.trim())throw new Error('읽을 수 있는 글자가 없습니다. 선명한 사진으로 다시 시도해 주세요.');
  return {text:result.data.text,lowConfidence:result.data.confidence<55};
 }finally{expired=true;if(worker)await worker.terminate().catch(()=>{});}
}
export async function readReceiptFile(file:File,status:(s:string)=>void,signal?:AbortSignal):Promise<{text:string;warning?:string;pageNumber?:number}[]>{
 signal?.throwIfAborted();
 if(file.size>12*1024*1024)throw new Error('파일 크기는 12MB 이하여야 합니다.');
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:await file.arrayBuffer()});
  const out:{text:string;warning?:string;pageNumber?:number}[]=[];
  try{const pdf=await deadline(task.promise,90000,signal);if(pdf.numPages>12)throw new Error('PDF는 한 번에 12페이지까지 읽을 수 있습니다. 파일을 나누어 주세요.');
   for(let i=1;i<=pdf.numPages;i++){
    signal?.throwIfAborted();status('PDF '+i+' / '+pdf.numPages+' 페이지 읽는 중…');const page=await deadline(pdf.getPage(i),90000,signal);
    const content=await deadline(page.getTextContent(),90000,signal);let text='';
    for(const item of content.items){if('str' in item)text+=item.str+('hasEOL' in item&&item.hasEOL?'\n':' ');}
    if(text.trim().length>=30){out.push({text,pageNumber:i});continue;}
    const base=page.getViewport({scale:1});const scale=Math.min(2,2400/Math.max(base.width,base.height),Math.sqrt(4000000/(base.width*base.height)));
    const viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{await deadline(page.render({canvas,viewport}).promise,90000,signal);const r=await ocr(canvas,status,signal);out.push({text:r.text,pageNumber:i,warning:r.lowConfidence?'글자가 불명확합니다. 원본과 대조해 주세요.':undefined});}finally{canvas.width=canvas.height=0;}
   }
   return out;
  }finally{await task.destroy();}
 }
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('PDF, JPG, PNG, WEBP 파일을 선택해 주세요.');
 const bitmap=await createImageBitmap(file);const scale=Math.min(1,2600/Math.max(bitmap.width,bitmap.height),Math.sqrt(4000000/(bitmap.width*bitmap.height)));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 try{signal?.throwIfAborted();const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지를 읽을 수 없습니다.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const r=await ocr(canvas,status,signal);return [{text:r.text,warning:r.lowConfidence?'글자가 불명확합니다. 원본과 대조해 주세요.':undefined}];}
 finally{bitmap.close();canvas.width=canvas.height=0;}
}

