import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {readKorailHistory,serviceLoginState} from '../server-collector/history-dom.ts';
import {korailReceiptResponse,korailDayUrl,collectKorailDay} from '../server-collector/korail.ts';
import {receiptPrintDocument} from '../server-collector/receipt-pdf.ts';
import {prepareAutomaticImport} from '../lib/auto-import.ts';
import {collectionPlan} from '../lib/collection-plan.ts';
import {attachmentFile} from '../lib/receipt-attachment.ts';
const fixture=await readFile(new URL('./fixtures/korail.html',import.meta.url),'utf8');
const day='2026-09-11';
function dom(){return parseHTML(fixture).document;}
async function withDocument(document,work){const before={document:globalThis.document,location:globalThis.location,window:globalThis.window};globalThis.document=document;globalThis.location={href:korailDayUrl(day),pathname:'/ticket/mypage/ticketInfo/receipt'};globalThis.window={};try{return await work();}finally{Object.assign(globalThis,before);}}
function responseRow(ref){const [h_wct_no,date,h_sale_sqno,h_tk_ret_pwd]=ref.split('-');return {h_wct_no,h_sale_dt:'2026'+date,h_sale_sqno,h_tk_ret_pwd};}
test('actual KTX card markup produces separate equal-price journeys, skips returned ticket and ignores receipt popup copies',async()=>withDocument(dom(),()=>{
 const scan=readKorailHistory();assert.equal(scan.count,4);assert.equal(scan.cancelled,1);assert.deepEqual(scan.invalid,[]);assert.equal(scan.blocks.length,3);
 const result=prepareAutomaticImport('ktx',scan.blocks,'',[day]);assert.equal(result.ready.length,2);assert.equal(result.review.length,0);assert.equal(result.ready.reduce((sum,row)=>sum+row.amount,0),119600);assert.equal(new Set(result.ready.map(row=>row.reference)).size,2);assert.equal(result.ready[0].merchant,'서울 → 부산');
}));
test('KTX empty success requires successful official response; HTTP errors and malformed payloads never become empty',()=>{
 assert.deepEqual(korailReceiptResponse({strResult:'SUCC_NULL',resultData:{aentity1:[],h_tot_page_cnt:'0'}}),{count:0,references:[],pages:1});
 for(const data of [{},{strResult:'FAIL',resultData:{aentity1:[]}},{strResult:'SUCC',resultData:{}},{strResult:'SUCC',resultData:{aentity1:[{}]}}])assert.throws(()=>korailReceiptResponse(data));
 const row=responseRow('TEST-0911-000001-FAKE01');assert.equal(korailReceiptResponse({strResult:'SUCC',resultData:{aentity1:[row,row],h_tot_page_cnt:'2'}}).count,1);
 assert.equal(new URL(korailDayUrl(day)).searchParams.get('searchDate'),'20260911');
});
test('dates automatically retarget login without restarting authentication and replace a running old query',()=>{
 const base={providerId:'korail',consentedAt:'approved',requestedDates:['2026-09-09']};
 assert.deepEqual(collectionPlan([{...base,state:'complete',connected:true}],[day]),{start:['korail'],stop:[]});
 assert.deepEqual(collectionPlan([{...base,state:'login',connected:false}],[day]),{start:['korail'],stop:[]});
 assert.deepEqual(collectionPlan([{...base,state:'collecting',connected:true}],[day]),{start:[],stop:['korail']});
 assert.deepEqual(collectionPlan([{...base,state:'complete',requestedDates:[day]}],[day]),{start:[],stop:[]});
 assert.deepEqual(collectionPlan([{...base,state:'disconnected',consentedAt:undefined}],[day]),{start:[],stop:[]});
 assert.deepEqual(collectionPlan([{...base,state:'login'}],[]),{start:[],stop:['korail']});
});
test('receipt document contains original receipt data without executable elements and PDF attachment is validated',async()=>withDocument(dom(),()=>{
 Object.defineProperty(document,'styleSheets',{value:[{href:null,cssRules:[{cssText:'.receipt_print .logo { width:71px; background:url(/images/logo.png); }'}]}]});
 document.querySelector('.receipt_popup').insertAdjacentHTML('beforeend','<script>bad()</script><iframe src="https://bad.invalid/"></iframe><img src="https://bad.invalid/x" onerror="bad()">');
 const html=receiptPrintDocument();assert.ok(html.includes('TEST-0911-000001-FAKE01'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('onerror'));assert.ok(!html.includes('https://bad.invalid'));
 assert.ok(html.includes('width:71px'));assert.ok(html.includes('https://www.korail.com/images/logo.png'));
 const pdf={name:'영수증.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\nsynthetic').toString('base64')};assert.equal(attachmentFile(pdf).type,'application/pdf');
 assert.throws(()=>attachmentFile({...pdf,base64:Buffer.from('<html>').toString('base64')}));
}));
test('public date controls cannot close the login window before authentication',async()=>withDocument(dom(),()=>{
 document.querySelectorAll('a,button').forEach(node=>{if(node.textContent.trim()==='로그아웃')node.remove();});
 document.querySelectorAll('a,button,input').forEach(node=>{node.getClientRects=()=>[{}];});
 assert.equal(serviceLoginState('korail'),false);
 const logout=document.createElement('a');logout.textContent='로그아웃';logout.getClientRects=()=>[{}];document.body.append(logout);
 assert.equal(serviceLoginState('korail'),true);
}));
test('KTX runner performs date query, all pages and receipt capture without user date or print clicks',async()=>{
 const document=dom();document.querySelector('input[id*="000004"]').closest('li.tckList').remove();
 const cards=[...document.querySelectorAll('li.tckList')];cards.slice(1).forEach(node=>node.remove());
 const allRefs=cards.map(card=>card.querySelector('input[id^="check_"]').id.slice(6));let pageIndex=1,waits=0,printed='',closed=false;const selected=[];
 const printPage={async setContent(html){printed=html;},async emulateMedia(options){assert.equal(options.media,'screen');},async pdf(){return Buffer.from('%PDF-1.4\nsynthetic-test-only');},async close(){closed=true;}};
 const page={
  async goto(url){assert.equal(url,korailDayUrl(day));},
  async waitForResponse(predicate){waits++;const refs=pageIndex===1?allRefs.slice(0,1):allRefs.slice(1);const response={url:()=> 'https://www.korail.com/ebizweb/mypage/ticket-history/receipt?h_abrd_dt_from=20260911&h_abrd_dt_to=20260911&radIndGrpDvCd='+pageIndex,request:()=>({method:()=> 'GET'}),json:async()=>({strResult:'SUCC',resultData:{aentity1:refs.map(responseRow),h_tot_page_cnt:'2'}})};assert.ok(predicate(response));return response;},
  async waitForFunction(fn,arg){assert.ok(fn(arg));},
  async evaluate(fn,arg){return fn(arg);},
  locator(selector){return {filter(){return this;},async click(){if(selector==='a.page_group'){cards.slice(1).forEach(card=>document.querySelector('.tckWrap>ul').append(card));document.querySelector('a.page_group').remove();pageIndex=2;}else{selected.push(selector);}}};},
  getByRole(role,options){assert.equal(role,'button');assert.equal(options.name,'선택 영수증 인쇄');return {async click(){const original=document.querySelector('.receipt_print>li');document.querySelector('.receipt_print').innerHTML=original.outerHTML+original.outerHTML.replaceAll(allRefs[0],allRefs[1]);}};},context:()=>({newPage:async()=>printPage})
 };
 // The second response is observed before the click promise resolves, as in Playwright.
 const waiting=page.waitForResponse.bind(page);page.waitForResponse=async predicate=>{if(waits===1){pageIndex=2;}return waiting(predicate);};
 await withDocument(document,async()=>{const result=await collectKorailDay(page,day,async()=>{});assert.equal(result.blocks.length,2);assert.equal(result.cancelled,1);assert.equal(selected.length,2);assert.ok(result.attachment.base64.startsWith('JVBER'));assert.ok(printed.includes('59,800'));assert.ok(closed);assert.equal(waits,2);});
});
