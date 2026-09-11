# 출장 · CHULJANG

한국어 출장 영수증 정리 웹앱. 확장 도구 설치 없이 서비스 연결을 승인하고 출장 날짜를 복수 선택하면 서버가 해당 날짜의 이용내역을 조회합니다. 처음에는 서비스별 공식 로그인과 필요한 추가 인증을 완료해야 합니다.

## 기능

- 코레일·KOBUS·대한항공 기본 연결, 아시아나·쏘카 기업 웹 선택 연결.
- 서버 원격 로그인, 암호화된 인증 상태 재사용, 사용자·서비스별 작업 분리와 연결 해제.
- 실제 이용일을 선택 날짜 집합과 대조. 명확한 내역은 자동 저장하고 불명확한 내역은 검토.
- 페이지를 닫아도 서버 수집과 대기 내역 유지. 다시 방문하면 미처리 결과 전달, 저장 후 확인 응답으로 중복 방지.
- 이미지·PDF 한국어 OCR, 날짜·금액 교정, 출장별 분류와 검토 완료 표시.
- 사용자별 D1 저장, 비공개 R2 원본과 인증된 다운로드.
- WebMCP list_receipts(조회), stage_receipt_text(검토 초안 준비).

## 수집 범위

원격 코레일 로그인 링크 생성은 배포 서버에서 검증했습니다. **실제 회원 계정의 전체 이용내역 수집은 아직 통합 검증하지 않았습니다.** 원격 브라우저 차단이나 조회 구조 차이로 추가 확인이 필요할 수 있습니다. 현재는 일부 조회 상태를 표시하며 전체 수집 완료를 주장하지 않습니다.

개인 카카오 T·쏘카와 기타 항공사는 앱에서 발급한 이미지/PDF를 가져옵니다. 지정 정산 양식과 웹메일 첨부·전송은 아직 구현하지 않았습니다.

허용한 공식 호스트의 이용내역과 제한된 조회 링크·버튼을 사용합니다. 서비스당 15개 화면·100개 후보 내역까지 처리합니다. 예약·결제·취소와 CAPTCHA 우회는 수행하지 않습니다. Chrome 프로필 로그인은 서비스별 인증을 대신하지 않습니다.

인식 결과는 원본과 비교해야 합니다. 이용일·원화 금액이 불명확하거나 음수·외화인 내역은 자동 확정하지 않습니다. 파일은 1회 합계 12MB·20개, PDF는 파일당 12페이지입니다. 수동 파일/텍스트 초안은 새로고침하면 사라지며, 서버 수집 대기 내역은 저장·제외·연결 해제 전까지 암호화 보관합니다.

## 실행

Node.js 22.13+와 npm이 필요합니다.

1. npm run install:ci
2. npm run build
3. 새 로컬 DB 최초 마이그레이션: node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fluffy_fallen_one.sql
4. 수집 서버를 사용하려면 [서버 설정](docs/zero-install-collection.md)에 따라 .dev.vars를 구성합니다.
5. npm run dev

로컬 /signin-with-chatgpt?return_to=/에서 개발 로그인합니다. 운영은 Sites 인증과 접근 제어를 사용합니다. Windows npm.cmd 오류 시 Node로 실제 npm-cli.js를 실행하세요.

## 검증

- node --experimental-strip-types --test tests/*.test.mjs
- node node_modules/typescript/bin/tsc --noEmit
- node tests/api-smoke.mjs — 로컬 5173 서버와 D1에 합성 데이터 생성.

server-collector/는 설치 없는 서버 수집 구현입니다. collector/의 날짜·화면 읽기 모듈을 공유합니다. 기존 Chrome 확장 실험 코드는 호환 목적으로 보존했으며 제품 사용에 필요하지 않습니다.

## 데이터·라이선스

GitHub에는 코드와 인식 엔진만 포함합니다. 사용자 영수증·로그인 정보·운영 DB·비밀키는 저장소에 넣지 않습니다. 원본은 사용자가 저장할 때 비공개 R2에 업로드합니다.

OCR 자산은 기존 jacha 프로젝트 자산을 재사용했습니다. Tesseract 라이선스·NOTICE는 public/vendor/ocr, PDF.js 라이선스는 public/vendor/LICENSE-pdfjs에 있습니다.
