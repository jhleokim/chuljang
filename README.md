# 출장 · CHULJANG

한국어 출장 영수증 정리 웹앱. 사용 흐름은 **출장 날짜 복수 선택 → 사용한 서비스 로그인 → 자동 조회·저장**입니다. 확장 도구 설치, 별도 수집 시작, 로그인 완료 버튼은 필요하지 않습니다. 날짜가 바뀌면 연결된 서비스의 조회 작업에 자동 반영합니다. 서비스별 구현 상태는 아래와 같습니다.

## 기능

- KTX·코레일, 티머니 지하철·시내버스, KOBUS 고속버스의 공식 로그인 연결.
- 로그인 성공 자동 감지, 유효한 인증 상태 암호화 보관·재사용, 사용자·서비스별 작업 분리와 연결 해제.
- KTX 전용 조회: 선택 날짜를 하루씩 조회하고, 공식 응답과 화면의 승차권을 대조하며, 더보기 페이지와 선택 영수증 PDF를 처리.
- 실제 이용일을 선택 날짜 집합과 대조. 명확한 내역은 자동 저장하고 불명확한 내역은 검토.
- 페이지를 닫아도 서버 수집과 대기 내역 유지. 다시 방문하면 미처리 결과 전달, 저장 후 확인 응답으로 중복 방지.
- 이미지·PDF 한국어 OCR, 날짜·금액 교정, 출장별 분류와 검토 완료 표시.
- 사용자별 D1 저장, 비공개 R2 원본과 인증된 다운로드.
- WebMCP list_receipts(조회), stage_receipt_text(검토 초안 준비), collection_status(수집 상태 조회).

## 수집 범위

| 서비스 | 현재 구현 상태 |
| --- | --- |
| KTX·코레일 | 공식 이용내역 화면과 조회 응답에 맞춘 전용 어댑터 구현. 날짜별 조회, 더보기, 취소 제외, 건수 대조, 공식 인쇄 화면의 영수증 PDF 생성을 합성 테스트로 검증했습니다. **실제 회원 계정으로 로그인부터 저장까지의 통합 검증은 아직 하지 않았습니다.** |
| 티머니 지하철·시내버스 | 공식 로그인과 회원 조회 화면 구조 확인까지 구현. 인증 후 조회 어댑터는 `adapter_pending` 상태이며 자동 수집 완성을 뜻하지 않습니다. |
| KOBUS 고속버스 | 공식 로그인과 회원 조회 화면 구조 확인까지 구현. 인증 후 조회 어댑터는 `adapter_pending` 상태입니다. 티머니 지하철·시내버스와 별도 서비스입니다. |

티머니 일반 조회는 회원 계정에 등록된 선불·모바일 티머니카드가 대상이며, 공식 제공 기간은 조회일 기준 D−367일부터 D−2일까지입니다. 오늘·어제 내역은 아직 제공되지 않습니다. 은행·카드사 발행 신용·체크카드의 후불교통 내역은 발행 카드사에서 받아야 합니다. 가입 전 내역은 증빙과 본인인증이 필요한 별도 신청 대상입니다. [티머니 공식 FAQ](https://pay.tmoney.co.kr/ncs/pct/cuscent/ReadFaqBscList.dev)

항공·개인 카카오 T·쏘카는 발급받은 이미지/PDF를 가져올 수 있습니다. 항공·쏘카 기업 웹의 기존 실험 연결은 자동 수집을 검증한 서비스로 안내하지 않습니다. **지정 정산 양식의 파일 저장과 웹메일 첨부·전송은 아직 사용할 수 없습니다.**

허용한 공식 호스트에서 조회·영수증 인쇄 동작을 사용합니다. KTX는 응답과 표시 내역이 일치하고 선택 날짜의 모든 페이지를 확인한 경우에만 해당 날짜를 완료로 처리합니다. 로그인과 추가 인증은 사용자가 공식 화면에서 완료하며, Chrome 프로필 로그인은 서비스별 인증을 대신하지 않습니다.

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

server-collector/는 설치 없는 서버 수집 구현입니다. KTX 전용 어댑터의 합성 검증은 tests/transit-collection.test.mjs에 있습니다. collector/의 날짜·화면 읽기 모듈을 공유하며, 기존 Chrome 확장 실험 코드는 호환 목적으로 보존했습니다. 제품 사용에 확장 도구는 필요하지 않습니다.

## 데이터·라이선스

GitHub에는 코드와 인식 엔진만 포함합니다. 사용자 영수증·로그인 정보·운영 DB·비밀키는 저장소에 넣지 않습니다. 자동 수집 PDF와 사용자가 가져온 원본은 영수증 저장 시 비공개 R2에 보관합니다.

OCR 자산은 기존 jacha 프로젝트 자산을 재사용했습니다. Tesseract 라이선스·NOTICE는 public/vendor/ocr, PDF.js 라이선스는 public/vendor/LICENSE-pdfjs에 있습니다.
