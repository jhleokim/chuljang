'use client';
import { FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { ko } from 'date-fns/locale';
import { format } from 'date-fns';

export function TripCollection({ signedIn, upload, requestedDates, onDatesChange }: { signedIn: boolean; upload: () => void; requestedDates: string[]; onDatesChange: (dates: string[]) => void }) {
  return <><section className="date-journey" aria-labelledby="date-heading">
    <ol className="journey-steps"><li className={signedIn?'done':''}>01 로그인</li><li className="active">02 출장 날짜 선택</li><li>03 지정 양식으로 저장·공유</li></ol>
    <div className="date-content"><div className="date-copy"><span className="eyebrow">WHEN DID YOU TRAVEL?</span><h2 id="date-heading">출장 다녀온 날만<br/>골라주세요.</h2><p>하루씩 눌러 여러 날짜를 선택하세요.<br/>보관한 영수증을 선택한 이용일로 모아볼 수 있습니다.</p>
      <div className="selected-days" aria-live="polite"><strong>{requestedDates.length ? requestedDates.length+'일 선택됨' : '아직 선택한 날짜가 없어요'}</strong><div>{requestedDates.map(day=><button key={day} disabled={false} onClick={()=>onDatesChange(requestedDates.filter(value=>value!==day))} aria-label={day+' 선택 해제'}>{day.slice(5).replace('-', '. ')} <span aria-hidden="true">×</span></button>)}</div></div>
      {!!requestedDates.length && <button className="clear-days" disabled={false} onClick={()=>onDatesChange([])}>날짜 선택 초기화</button>}
    </div><div className="trip-calendar"><Calendar mode="multiple" locale={ko} weekStartsOn={1} selected={requestedDates.map(day=>new Date(day+'T12:00:00'))} onSelect={days=>onDatesChange((days||[]).map(day=>format(day,'yyyy-MM-dd')).sort())} max={62} disabled={false ? true : {after:new Date()}} captionLayout="dropdown" startMonth={new Date(2020,0)} endMonth={new Date()} labels={{labelNext:()=> '다음 달',labelPrevious:()=> '이전 달'}}/><p>최대 62일 · 선택하지 않은 날짜는 제외</p></div></div>

  </section><section className="chrome-collection" aria-label="자동 수집 연결 상태">
    <div className="chrome-collection-heading"><div className="chrome-heading-copy"><span className="chrome-mark"><FileText size={25}/></span><div><span className="chrome-eyebrow">자동 수집 연결 상태</span><h2>설치 없는 수집 기능을 준비하고 있어요.</h2><p>아직 서비스 계정 연결과 자동 수집을 사용할 수 없습니다.</p></div></div><Button className="chrome-start" disabled>자동 수집 연결 전</Button></div>
    <div className="chrome-bottom"><p>현재는 영수증 파일의 자동 인식과 날짜별 정리를 사용할 수 있어요.</p><Button variant="ghost" onClick={upload}><Upload size={15}/> 사진·PDF 가져오기</Button></div>
  </section></>;
}
