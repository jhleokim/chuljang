import ExcelJS from 'exceljs';
import {checkWorkbook} from './report-zip.ts';
import {reportConfigSchema,reportFields,fieldLabels,reportValue,type ReportConfig} from './report.ts';
import type {Receipt,Trip} from './receipts.ts';

export async function loadWorkbook(bytes:Uint8Array){checkWorkbook(bytes);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);return workbook;}
export async function inspectReportTemplate(bytes:Uint8Array){
 const workbook=await loadWorkbook(bytes);const sheets=workbook.worksheets.filter(sheet=>sheet.state==='visible').map(sheet=>sheet.name);
 const sheet=workbook.getWorksheet(sheets[0]);if(!sheet)throw new Error('표시할 시트가 없습니다.');
 const aliases={date:/^(이용일|승차일|일자|날짜|사용일|이용일자)$/,service:/^(서비스|교통수단|구분)$/,merchant:/^(이용내역|사용처|내용|내역|적요|노선)$/,amount:/^(결제금액|금액|사용금액|요금|합계금액)(\(원\)|원)?$/,reference:/^(승인번호|예약번호|승인·예약번호|승인\/예약번호)$/,trip:/^(출장|출장명)$/};
 for(let row=1;row<=Math.min(sheet.rowCount,50);row++){
  const columns=Object.fromEntries(reportFields.map(field=>[field,''])) as ReportConfig['columns'];
  sheet.getRow(row).eachCell(cell=>{const label=String(cell.text).replace(/\s/g,'');for(const field of reportFields)if(aliases[field].test(label))columns[field]=cell.address.replace(/\d/g,'');});
  if(columns.date&&columns.amount)return {sheets,sheet:sheet.name,firstRow:row+1,lastRow:row+30,columns};
 }
 return {sheets,sheet:sheet.name};
}
export async function buildReportWorkbook(rows:Receipt[],trips:Trip[],dates:string[],input:ReportConfig,template?:Uint8Array){
 const config=reportConfigSchema.parse(input),workbook=template?await loadWorkbook(template):new ExcelJS.Workbook();
 const sheet=template?workbook.getWorksheet(config.sheet):workbook.addWorksheet('출장 정산서');
 if(!sheet)throw new Error('저장된 양식의 시트를 찾을 수 없습니다. 양식 설정을 확인해 주세요.');
 const start=template?config.firstRow:7,last=template?config.lastRow:start+rows.length-1,total=rows.reduce((sum,row)=>sum+row.amount,0);
 if(rows.length>last-start+1)throw new Error(`양식의 입력 공간은 ${last-start+1}건입니다. 양식 설정에서 마지막 행을 늘리거나 날짜를 나누어 주세요.`);
 if(!template){
  sheet.columns=[{width:16},{width:25},{width:36},{width:18},{width:30},{width:25}];
  sheet.mergeCells('A1:F1');sheet.getCell('A1').value=config.title;sheet.getCell('A1').font={name:'맑은 고딕',size:22,bold:true,color:{argb:'FF17345C'}};sheet.getRow(1).height=38;
  sheet.mergeCells('A3:F3');sheet.getCell('A3').value='출장일: '+dates.join(', ');sheet.getCell('A3').alignment={wrapText:true};sheet.getRow(3).height=Math.max(24,Math.ceil(dates.length/7)*18);
  sheet.getCell('A4').value='합계 (원)';sheet.getCell('D4').value={formula:`SUM(D7:D${last})`,result:total};sheet.getCell('D4').numFmt='#,##0" 원"';sheet.getCell('D4').font={size:16,bold:true};
  reportFields.forEach((field,index)=>{const cell=sheet.getCell(6,index+1);cell.value=fieldLabels[field];cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17345C'}};cell.font={name:'맑은 고딕',bold:true,color:{argb:'FFFFFFFF'}};});
  sheet.views=[{state:'frozen',ySplit:6}];sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};sheet.autoFilter=`A6:F${last}`;
 }
 const columns=template?config.columns:{date:'A',service:'B',merchant:'C',amount:'D',reference:'E',trip:'F'};
 // Fixed input range preserves footer positions, merged cells and template formulas.
 for(let index=0;index<=last-start;index++)for(const field of reportFields){
  const column=columns[field];if(!column)continue;const cell=sheet.getCell(column+(start+index));
  if(cell.isMerged&&cell.master.address!==cell.address)throw new Error('입력 열이 병합 셀의 중간을 가리킵니다. 양식 설정에서 병합 셀의 첫 열을 선택해 주세요.');
  if(cell.type===ExcelJS.ValueType.Formula)throw new Error('입력 범위에 수식이 있습니다. 합계 행을 제외하도록 마지막 입력 행을 조정해 주세요.');
  cell.value=rows[index]?reportValue(rows[index],field,trips):null;
  if(field==='amount')cell.numFmt='#,##0';
  if(!template){cell.font={name:'맑은 고딕',size:11};cell.alignment={vertical:'middle',wrapText:true};sheet.getRow(start+index).height=30;}
 }
 const replacements:Record<string,string|number>={title:config.title,dates:dates.join(', '),total,count:rows.length};
 workbook.eachSheet(page=>page.eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string'){
  const match=cell.value.match(/^\{\{(title|dates|total|count)\}\}$/);if(match)cell.value=replacements[match[1]];
  else cell.value=cell.value.replace(/\{\{(title|dates|total|count)\}\}/g,(_,key)=>String(replacements[key]));
 }})));
 workbook.calcProperties.fullCalcOnLoad=true;
 return new Uint8Array(await workbook.xlsx.writeBuffer());
}
