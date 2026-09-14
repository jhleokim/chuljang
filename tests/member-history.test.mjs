import test from 'node:test';import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {transitAvailability,parseMemberRows,memberQueryControls,memberResultSnapshot} from '../server-collector/member-history.ts';
const day='2026-09-11';
test('Tmoney availability follows Korea midnight and never equates recent or old unavailable dates with zero spend',()=>{
 const now=new Date('2026-09-14T15:01:00Z');assert.match(transitAvailability('2026-09-14',now),/이틀/);assert.equal(transitAvailability('2026-09-13',now),null);assert.match(transitAvailability('2025-01-01',now),/기간/);
});
test('transit uses actual usage date, excludes top-ups and refunds, preserves zero transfer fares and payment date differences',()=>{
 const headers=['결제일시','사용일시','거래구분','승차역','하차역','이용금액'];
 const result=parseMemberRows('tmoneyTransit',headers,[['2026-09-12',day+' 08:03','사용','서울','시청','1,500원'],['2026-09-12',day+' 08:20','사용','시청','을지로','0원'],[day,day,'충전','','','50,000원'],[day,'2026-09-10','사용','강남','역삼','1,500원']],day);
 assert.equal(result.rows.length,2);assert.equal(result.cancelled,1);assert.equal(result.rows.reduce((sum,row)=>sum+row.amount,0),1500);
 assert.throws(()=>parseMemberRows('kobus',['결제일시','금액'],[[day,'10000']],day),/이용일/);
 assert.throws(()=>parseMemberRows('kobus',['출발일시','결제금액'],[[day+' / 2026-09-12','10000']],day),/왕복/);
 assert.throws(()=>parseMemberRows('tmoneyTransit',headers,[[day,day,'사용','','','-1500']],day),/금액/);
});
test('member controls exclude password and hidden values; result table pagination and explicit empty state are distinguished',()=>{
 const {document}=parseHTML('<html><body><input type="password" id="password"><input type="hidden" name="startDate"><label for="from">조회시작일</label><input id="from"><label for="to">조회종료일</label><input id="to"><select id="cardSelect"><option value="opaque">등록카드</option></select><button>조회</button><table><thead><tr><th>사용일시</th><th>이용금액</th></tr></thead><tbody><tr><td>2026-09-11</td><td>1500원</td></tr></tbody></table><div class="paging"><strong>1</strong><a>2</a><a title="다음">다음</a></div></body></html>');
 for(const node of document.querySelectorAll('*'))node.getClientRects=()=>[{}];Object.defineProperty(document.body,'innerText',{value:document.body.textContent});const before={document:globalThis.document,window:globalThis.window};globalThis.document=document;globalThis.window={};
 try{const controls=memberQueryControls('tmoneyTransit');assert.ok(controls.start&&controls.end&&controls.card&&controls.query);assert.equal(document.querySelector('input[type=password]').hasAttribute('data-chuljang-query'),false);assert.equal(document.querySelector('input[type=hidden]').hasAttribute('data-chuljang-query'),false);const result=memberResultSnapshot('tmoneyTransit');assert.equal(result.rows.length,1);assert.ok(result.next);assert.equal(document.querySelector(result.next).textContent,'2');document.querySelector('tbody').innerHTML='<tr><td colspan="2">조회된 내역이 없습니다.</td></tr>';for(const node of document.querySelectorAll('tbody *'))node.getClientRects=()=>[{}];assert.equal(memberResultSnapshot('tmoneyTransit').empty,true);}finally{Object.assign(globalThis,before);}
});
