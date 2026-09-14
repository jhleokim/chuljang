import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {zipSync,strToU8} from 'fflate';
import {defaultReport,reportRows,reportConfigSchema,mailComposeUrl} from '../lib/report.ts';
import {buildReportWorkbook,loadWorkbook,inspectReportTemplate} from '../lib/report-workbook.ts';
import {checkWorkbook} from '../lib/report-zip.ts';
import {shareHash,shareToken} from '../lib/report-share.ts';
const rows=[{id:'one',date:'2026-09-09',source:'ktx',merchant:'서울 → 부산',amount:59800,reference:'TEST-1',tripId:null},{id:'two',date:'2026-09-11',source:'transit',merchant:'=HYPERLINK("evil")',amount:1500,reference:'TEST-2',tripId:null}];
test('report selects exact non-contiguous dates and keeps expenses as numeric cells and descriptions as text',async()=>{
 assert.equal(reportRows(rows,['2026-09-09']).length,1);assert.throws(()=>reportRows(rows,[]));assert.throws(()=>reportRows(rows,['2026-09-10']));
 const bytes=await buildReportWorkbook(rows,[],rows.map(row=>row.date),defaultReport),book=await loadWorkbook(bytes),sheet=book.worksheets[0];
 assert.equal(sheet.getCell('D4').result,61300);assert.equal(sheet.getCell('D7').value,59800);assert.equal(sheet.getCell('C8').value,rows[1].merchant);assert.equal(sheet.getCell('C8').type,ExcelJS.ValueType.String);
});
test('custom workbook retains unrelated cells and formulas, fills placeholders and refuses to overwrite a total formula',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('회사양식');sheet.getCell('A1').value='{{title}}';sheet.getCell('A2').value='{{dates}}';sheet.getCell('A4').value='이용일';sheet.getCell('B4').value='금액';sheet.getCell('D5').value='그대로';sheet.getCell('B5').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF00AA00'}};sheet.getCell('B7').value={formula:'SUM(B5:B6)',result:0};
 const template=new Uint8Array(await book.xlsx.writeBuffer()),detected=await inspectReportTemplate(template);assert.equal(detected.firstRow,5);assert.equal(detected.columns.amount,'B');
 const config={...defaultReport,sheet:'회사양식',firstRow:5,lastRow:6,columns:{date:'A',service:'',merchant:'',amount:'B',reference:'',trip:''}};
 const output=await loadWorkbook(await buildReportWorkbook(rows,[],['2026-09-09','2026-09-11'],config,template)),page=output.worksheets[0];assert.equal(page.getCell('D5').value,'그대로');assert.equal(page.getCell('B7').formula,'SUM(B5:B6)');assert.equal(page.getCell('B5').fill.fgColor.argb,'FF00AA00');assert.equal(page.getCell('A1').value,config.title);
 await assert.rejects(()=>buildReportWorkbook(rows,[],['2026-09-09'],{...config,lastRow:7},template),/수식/);
 await assert.rejects(()=>buildReportWorkbook(rows,[],['2026-09-09'],{...config,lastRow:5},template),/입력 공간/);
});
test('unsafe workbook archives and ambiguous mappings fail; share links use independent 256-bit tokens',async()=>{
 assert.throws(()=>checkWorkbook(new Uint8Array([1,2,3])));assert.throws(()=>checkWorkbook(zipSync({'xl/workbook.xml':strToU8('x'),'xl/vbaProject.bin':strToU8('macro')})));
 assert.equal(reportConfigSchema.safeParse({...defaultReport,columns:{...defaultReport.columns,date:'D'}}).success,false);
 const a=shareToken(),b=shareToken();assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);assert.notEqual(await shareHash(a),a);
 const link=mailComposeUrl({...defaultReport,recipient:'owner@example.com'},'https://example.com/share/'+a,'2026-09-20T00:00:00Z');const url=new URL(link);assert.equal(url.hostname,'mail.google.com');assert.equal(url.searchParams.get('to'),'owner@example.com');assert.match(url.searchParams.get('body'),/example.com\/share\//);
});
