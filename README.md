# 출장 · CHULJANG

KTX, 카카오 T, 티머니 고속버스, 항공, 쏘카 영수증을 정리하는 한국어 웹앱입니다.

## 기능
- Chrome 확장 도구로 현재 열린 웹 영수증의 선택 텍스트 또는 표시된 표·본문을 수집하고 검토창으로 전송.
- 이미지 및 PDF에서 한국어/영문 텍스트 인식. OCR은 브라우저 기기 안에서 실행.
- 날짜·이용내역·원화 금액 교정, 중복 가져오기 방지, 검토 완료 표시.
- 출장 기간이 한 건에만 일치하면 새 영수증 자동 분류. 기존 내역은 수정 화면에서 출장 선택.
- 사용자별 D1 저장, R2 원본 보관, 인증된 원본 다운로드, CSV 내보내기.
- WebMCP: list_receipts(조회), stage_receipt_text(검토창 준비, 저장하지 않음).

## 수집 범위와 한계
각 서비스에 자동 로그인하거나 계정 전체 이용내역을 무인 수집하지 않습니다. 비공개 API·쿠키 추출·CAPTCHA 우회는 사용하지 않습니다. 수집 도구는 현재 탭만 읽는 실험 기능입니다. 페이지 넘김·iframe·캔버스 본문은 지원하지 않으며, 실제 서비스 계정 화면에 대한 통합 검증은 수행하지 않았습니다.

카카오 T 및 쏘카 개인 영수증은 앱에서 발급·공유해야 합니다. 항공은 대한항공 공식 발급 안내를 기준으로 하며 항공사별 계정 연동은 없습니다.

인식 결과는 원본과 비교해야 합니다. 음수·외화·복수 후보 금액은 자동 확정하지 않습니다. 현재 원화 정수만 지원하므로 외화 영수증은 카드 원화 청구액을 입력하세요. 취소·환불 건은 지출에서 제외하세요.

파일은 1회 합계 12MB·20개, PDF는 파일당 12페이지, 저장은 100건까지입니다. 저장 전 초안은 브라우저 메모리에만 있어 새로고침하면 사라집니다.

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
- node --experimental-strip-types --test tests/receipts.test.mjs tests/collector.test.mjs
- node node_modules/typescript/bin/tsc --noEmit
- node tests/api-smoke.mjs

API smoke는 로컬 5173 서버와 D1에 합성 데이터를 생성합니다. 운영에서는 실행하지 않습니다.

## 수집 도구
collector/에 소스, public/chuljang-collector.zip에 설치 파일이 있습니다. 사이트의 수집 방법에서 안내합니다. activeTab 권한으로 사용자가 실행한 현재 탭만 읽습니다. 로그인정보·입력필드·쿠키를 읽지 않습니다. 전송 대상은 고정된 출장 사이트입니다.

## 공식 발급 안내
- 코레일: https://www.korail.com/
- 카카오 T: https://service.kakaomobility.com/cs/faqs/content/?category=16
- 고속버스: https://www.kobus.co.kr/mrs/mrsrecplist.do
- 시외버스: https://txbus.t-money.co.kr/recp/recpEnty.do
- 대한항공: https://www.koreanair.com/
- 쏘카: https://enterprise.socar.kr/bizweb_guide/

2026-09-11 공식 자료 기준이며 서비스 화면·발급 정책은 바뀔 수 있습니다. 코레일의 공개 승차권 진위확인 API는 개인 구매내역 수집 API가 아니므로 사용하지 않습니다.

## 데이터·라이선스
GitHub에는 코드와 인식 엔진만 포함합니다. 사용자 영수증·로그인정보·운영 DB는 저장소에 넣지 않습니다. 원본은 사용자가 저장할 때 비공개 R2에 업로드합니다.

OCR 자산은 기존 jacha 프로젝트의 배포 자산을 재사용했습니다. Tesseract 라이선스·NOTICE는 public/vendor/ocr에, PDF.js 라이선스는 public/vendor/LICENSE-pdfjs에 있습니다.

