# 출장 · CHULJANG

> 현재 제품은 확장 도구 설치 안내를 제거했습니다. 설치 없는 자동 수집 백엔드는 아직 연결되지 않았으며, 아래 Chrome 수집 설명은 이전 실험 구현의 기록입니다. 현재 가능한 기능은 날짜 선택·파일 인식·저장·검토입니다. [설치 없는 수집 구조](docs/zero-install-collection.md)를 참고하세요.

KTX, 카카오 T, 티머니 고속버스, 항공, 쏘카 영수증을 정리하는 한국어 웹앱입니다.

## 기능
- Chrome 수집 도구 v2: 허용한 서비스에서 기존 로그인 세션을 재사용하고 이용내역·영수증 링크를 자동 탐색.
- 날짜·원화 금액이 명확한 내역 자동 저장(검토 필요 상태), 불명확한 내역만 검토 목록에 추가.
- 여러 서비스 수집 큐, 실제 저장 후 확인 응답, 실패·검토 대기 내역 재전송.
- 이미지 및 PDF에서 한국어/영문 텍스트 인식. OCR은 브라우저 기기 안에서 실행.
- 날짜·이용내역·원화 금액 교정, 중복 가져오기 방지, 검토 완료 표시.
- 출장 기간이 한 건에만 일치하면 새 영수증 자동 분류. 기존 내역은 수정 화면에서 출장 선택.
- 사용자별 D1 저장, R2 원본 보관, 인증된 원본 다운로드, CSV 내보내기.
- WebMCP: list_receipts(조회), stage_receipt_text(검토창 준비, 저장하지 않음).

## 수집 범위와 한계
Chrome 프로필의 Google 로그인은 서비스별 로그인을 대신하지 않습니다. 처음 한 번 확장 도구 설치·서비스 접근 허용이 필요하며, 이후 Chrome에 남아 있는 각 서비스의 로그인 상태를 사용합니다. 로그인·본인인증·보안문자는 공식 페이지에서 사용자가 완료하며, 완료 후 자동으로 이어집니다.

기본 연결은 코레일, KOBUS, 대한항공입니다. 아시아나와 쏘카 비즈니스는 선택 연결입니다. 쏘카 비즈니스는 별도 기업 프로필이 필요합니다. 카카오 T·쏘카 개인 영수증과 기타 항공사는 앱/PDF 가져오기를 사용합니다.

자동 탐색은 허용된 공식 호스트의 화면에 표시된 영수증 표·레코드와 제한된 조회 링크/버튼만 사용합니다. 비밀번호·쿠키·입력값 추출, 비공개 API, CAPTCHA 우회, 결제·예약·취소 동작은 하지 않습니다. iframe·캔버스·자동 다운로드 PDF·모든 과거 페이지를 보장하지 않습니다. 현재 공식 화면의 조회 기간, 서비스당 최대 100건·20개 화면, 대기 250건으로 제한합니다.

공식 공개 페이지와 경로를 확인했으며 **실제 회원 계정의 전체 이용내역 수집은 아직 통합 검증하지 않았습니다.** 페이지 변경이나 별도 인증이 있으면 ‘공식 화면 확인 필요’로 표시합니다. 코레일 깊은 링크는 공개 배포 JS의 경로에서 도출했고, 회원 화면에서의 동작은 미검증입니다.

인식 결과는 원본과 비교해야 합니다. 음수·외화·복수 후보 금액은 자동 확정하지 않습니다. 현재 원화 정수만 지원하므로 외화 영수증은 카드 원화 청구액을 입력하세요. 취소·환불 건은 지출에서 제외하세요.

파일은 1회 합계 12MB·20개, PDF는 파일당 12페이지입니다. 큰 검토 목록은 100건씩 나누어 저장합니다. 파일/텍스트 초안은 페이지 메모리에 있어 새로고침하면 사라집니다. Chrome 수집 대기 내역은 확장 도구 세션 메모리에 30분 보관하며, 저장·명시적 제외 후 삭제합니다. 새로고침 시 대기 내역은 다시 전달됩니다. Chrome 종료·확장 업데이트 시 미저장 대기 내역은 사라집니다.

## 실행
Node.js 22.13+와 npm이 필요합니다.

1. npm run install:ci
2. npm run build
3. 새 로컬 DB에 최초 1회 마이그레이션:
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fluffy_fallen_one.sql
4. npm run dev

로컬 /signin-with-chatgpt?return_to=/ 에서 개발 로그인합니다. 운영은 Sites 인증 헤더와 접근 제어를 사용하므로 임의 호스팅에 그대로 배포하면 안 됩니다.

Windows npm.cmd 경로 오류가 있는 환경은 Node로 실제 npm-cli.js를 직접 실행하세요.

## 검증
- node --experimental-strip-types --test tests/*.test.mjs
- node node_modules/typescript/bin/tsc --noEmit
- node tests/api-smoke.mjs

API smoke는 로컬 5173 서버와 D1에 합성 데이터를 생성합니다. 운영에서는 실행하지 않습니다.

## 수집 도구
collector/에 소스, public/chuljang-collector.zip에 설치 파일이 있습니다. 사이트의 수집 방법에서 안내합니다. 선택한 공식 호스트만 선택 권한으로 허용합니다. 직접 만든 수집 탭만 탐색하고 완료된 비활성 탭은 닫습니다. 선택한 서비스와 시작 설정만 local storage에 저장하고, 영수증 텍스트·작업 상태는 session storage에 보관합니다. Chrome 시작 시 자동 수집을 켜면 최근 수집 후 6시간이 지난 시작 시 실행합니다. 전송 대상은 고정된 출장 사이트이며 인증과 저장 응답을 기다립니다.

## 공식 발급 안내
- 코레일: https://www.korail.com/ticket/search
- 카카오 T: https://service.kakaomobility.com/cs/faqs/content/?category=16
- 고속버스: https://www.kobus.co.kr/mrs/mrsrecplist.do
- 시외버스: https://txbus.t-money.co.kr/recp/recpEnty.do
- 대한항공: https://www.koreanair.com/reservation/list
- 아시아나: https://flyasiana.com/C/KR/KO/index.do
- 쏘카 기업: https://enterprise.socar.kr/
- 쏘카: https://enterprise.socar.kr/bizweb_guide/

2026-09-11 공식 자료 기준이며 서비스 화면·발급 정책은 바뀔 수 있습니다. 코레일의 공개 승차권 진위확인 API는 개인 구매내역 수집 API가 아니므로 사용하지 않습니다.

## 데이터·라이선스
GitHub에는 코드와 인식 엔진만 포함합니다. 사용자 영수증·로그인정보·운영 DB는 저장소에 넣지 않습니다. 원본은 사용자가 저장할 때 비공개 R2에 업로드합니다.

OCR 자산은 기존 jacha 프로젝트의 배포 자산을 재사용했습니다. Tesseract 라이선스·NOTICE는 public/vendor/ocr에, PDF.js 라이선스는 public/vendor/LICENSE-pdfjs에 있습니다.


## 날짜 중심 수집 (v3)
로그인 → 출장 날짜 복수 선택(최대 62일) → 자동 수집 순서입니다. 날짜는 선택한 정확한 집합으로 작업·패킷·검토·API에 전달됩니다. 결제/발급일만 있는 내역과 여러 날의 합계는 이용일 확인이 필요합니다. 날짜 선택은 이 탭의 세션 설정, 수집 도구 날짜 설정은 기기에 보관합니다. 기본 Chrome 시작 자동 수집은 꺼져 있습니다.

편집 가능한 네이티브 이용일 범위가 명확할 때만 날짜 입력과 조회를 자동 실행합니다. 회원 페이지 전체 조회 기간 및 서비스별 전체 수집은 실계정 검증 전이므로 조회 범위 확인 상태를 표시합니다. 정산 파일은 사용자 양식 미지정 상태이며 웹메일 첨부/전송은 아직 구현하지 않았습니다. 기존 임의 CSV 출력 버튼을 주 작업 흐름에서 제거했습니다.
