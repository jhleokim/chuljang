'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Globe as Chrome, LoaderCircle, Settings2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Status = { running: boolean; pending: number; tasks: { providerId: string; name: string; state: string; label: string; note: string; count: number }[] };
export function ChromeCollection({ signedIn, signIn, upload }: { signedIn: boolean; signIn: () => void; upload: () => void }) {
  const [version, setVersion] = useState(0), [status, setStatus] = useState<Status | null>(null), [install, setInstall] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === 'CHULJANG_EXTENSION') { setVersion(event.data.version || 0); if (event.data.status) setStatus(event.data.status); }
      if (event.data?.type === 'CHULJANG_COMMAND_RESULT') { setError(event.data.result?.error || ''); if (event.data.result?.status) setStatus(event.data.result.status); }
    };
    window.addEventListener('message', receive);
    window.postMessage({ type: 'CHULJANG_PROBE' }, location.origin);
    const timer = setInterval(() => window.postMessage({ type: 'CHULJANG_PROBE' }, location.origin), 5000);
    return () => { window.removeEventListener('message', receive); clearInterval(timer); };
  }, []);
  function command(value: string, providerId?: string) {
    if (!signedIn) { signIn(); return; }
    if (version < 2) { setInstall(true); return; }
    setError(''); window.postMessage({ type: 'CHULJANG_COLLECTOR_COMMAND', command: value, providerId, requestId: crypto.randomUUID() }, location.origin);
  }
  return <section className="chrome-collection" aria-label="Chrome 자동 수집">
    <div className="chrome-collection-heading"><div className="chrome-heading-copy"><span className="chrome-mark"><Chrome size={25}/></span><div><span className="chrome-eyebrow">CHROME 자동 수집</span><h2>로그인은 한 번, 영수증은 한곳에.</h2><p>연결한 서비스에서 내역을 찾아 자동 저장해요. 입력이 필요한 건만 확인하세요.</p></div></div><Button className="chrome-start" onClick={() => command(status?.running ? 'STOP' : 'START')}>{status?.running ? <><LoaderCircle size={18} className="animate-spin"/> 수집 중단</> : <><Chrome size={18}/> {version >= 2 ? 'Chrome에서 모두 가져오기' : 'Chrome 연결하기'}</>}</Button></div>
    <div className="chrome-capabilities"><span><Check size={15}/> 서비스 로그인 재사용</span><span><Check size={15}/> 중복 내역 자동 제외</span><span><Check size={15}/> 정상 인식 내역 자동 저장</span>{version >= 2 && <button onClick={() => command('OPEN_SETUP')}><Settings2 size={14}/> 연결 설정</button>}</div>
    {error && <p className="chrome-error" role="alert">{error}</p>}
    {!!status?.tasks.length && <div className="connection-grid">{status.tasks.map(task => <div className="connection-card" key={task.providerId}><strong>{task.name}</strong><span className={'connection-state state-' + task.state}>{task.label}{task.count > 0 ? ` · ${task.count}건` : ''}</span><p>{task.note}</p>{['login', 'attention'].includes(task.state) && <Button variant="outline" size="sm" onClick={() => command('OPEN_SOURCE', task.providerId)}>{task.state === 'login' ? '로그인' : '공식 화면 확인'} <ArrowUpRight size={14}/></Button>}</div>)}</div>}
    {status && status.pending > 0 && <p className="chrome-pending" role="status">{status.pending}건 전송·저장 대기 중 · 입력이 필요한 영수증은 검토 후 저장해 주세요.</p>}
    {install && version < 2 && <div className="chrome-install"><div><h3>처음 한 번 수집 도구를 연결해 주세요</h3><p>이 사이트를 Chrome에서 열고 아래 순서로 연결하면 다음부터 서비스 선택·전송을 반복하지 않아도 돼요.</p><ol><li><a href="/chuljang-collector.zip" download><ArrowDownToLine size={16}/> 수집 도구 v2 다운로드</a> 후 압축 풀기</li><li>Chrome 주소창에 <code>chrome://extensions</code> 입력 → 개발자 모드 켜기</li><li>‘압축해제된 확장 프로그램을 로드합니다’ → 압축을 푼 폴더 선택</li><li>수집 도구에서 ‘연결하고 모두 가져오기’ → 서비스 접근 허용</li></ol><p>이전 버전이 있다면 새 파일로 바꾼 뒤 확장 프로그램의 새로고침을 눌러 주세요.</p></div></div>}
    <div className="chrome-bottom"><p>Chrome 계정 로그인과 각 서비스 로그인은 별개예요. 개인 카카오 T·쏘카는 앱 영수증을 가져와 주세요.</p><Button variant="ghost" onClick={upload}><Upload size={15}/> 사진·PDF 가져오기</Button></div>
  </section>;
}
