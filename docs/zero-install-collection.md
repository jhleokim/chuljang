# 설치 없는 영수증 수집

웹 로그인 → 출장 날짜 복수 선택 → 서비스 연결 권한 승인 → 필요한 서비스만 공식 화면에서 로그인 → 서버 수집 순서다. 확장 도구나 로컬 프로그램 설치는 필요 없다. Chrome 프로필 로그인은 서비스별 인증을 대신하지 않는다.

## 구현된 구성

- Sites의 /api/collection은 인증된 사용자 ID로 수집 서버에 요청한다. 비밀키를 브라우저에 전달하지 않는다.
- Cloudflare Worker server-collector/와 Browser Run이 원격 브라우저를 실행한다. Durable Object는 사용자·서비스별 작업, 암호화된 로그인 상태와 수집 대기 내역을 보관한다.
- 연결 승인 후 단기 원격 로그인 링크를 제공한다. 사용자가 서비스 공식 화면에 직접 로그인하고 추가 인증을 완료한다. 로그인 성공 표식을 확인한 뒤 수집한다.
- 이후 유효한 로그인 상태를 재사용한다. 연결 해제는 로그인 상태와 대기 내역을 삭제하고 실행 브라우저 종료를 요청한다.
- 선택한 정확한 날짜 집합을 작업·패킷·저장 검증에 유지한다. 이용일이 불명확한 내역은 검토 대상으로 남긴다.
- 페이지를 닫아도 서버 작업과 대기 내역은 유지된다. 웹이 열려 있을 때 결과를 받아 자동 저장하고, 저장 성공 또는 명시적 제외 후 서버 대기 내역을 삭제한다. 새로고침하면 미처리 결과가 다시 전달된다.

## 범위와 현재 한계

코레일·KOBUS·대한항공을 기본 연결로, 아시아나·쏘카 기업 웹을 선택 연결로 제공한다. 공개 공식 경로를 바탕으로 구성했으며 실제 회원 계정의 전체 이용내역은 아직 통합 검증하지 않았다. 원격 코레일 로그인 링크 생성은 배포 서버에서 확인했다. 원격 브라우저 차단이나 조회 구조 차이로 추가 확인이 필요할 수 있다.

허용된 조회 링크·버튼과 명확한 이용일 필드를 사용한다. 서비스별 최대 15개 화면·100개 후보 내역으로 제한하며 전체 과거 내역을 확인했다고 표시하지 않는다. 개인 카카오 T·쏘카 및 다른 항공사는 파일 가져오기를 사용한다. 지정 양식과 웹메일 첨부·전송은 아직 구현하지 않았다.

## 운영 설정

1. Browser Run과 SQLite Durable Object를 사용할 수 있는 Cloudflare 계정으로 server-collector/wrangler.jsonc의 계정 ID를 설정한다.
2. wrangler secret put COLLECTOR_SECRET --config server-collector/wrangler.jsonc 으로 충분히 긴 임의 비밀키를 설정하고 Worker를 배포한다.
3. Sites 환경에 CHULJANG_COLLECTOR_URL과 같은 키의 CHULJANG_COLLECTOR_SECRET을 설정한다. 비밀키는 저장소에 넣지 않는다. 로컬 개발은 무시된 .dev.vars에 설정한다.
4. 로그인 상태와 영수증 대기 내역은 AES-GCM으로 암호화하며 사용자·서비스·저장 키를 인증 데이터로 사용한다. 키 변경 시 기존 데이터가 해독되지 않으므로 연결 해제·재연결 계획이 필요하다.
5. 서버 요청은 본문·타임스탬프 HMAC으로 인증한다. 사이트 API는 인증·소유자 분리·Origin 검사를 적용한다.

여러 서비스는 25초 간격으로 시작하며 일시적 연결 실패는 제한된 횟수로 재시도한다. 브라우저 실행은 계정 한도를 사용한다. 별도 요금제 변경은 수행하지 않았다. 서버 대기 내역은 저장 확인·제외·연결 해제 전까지 남는다. 수동 파일/텍스트 초안은 페이지 메모리에만 있다.

## 검증

- node --experimental-strip-types --test tests/*.test.mjs: 실제 상태 클래스의 권한·중복 요청·취소·원자적 저장·계정 분리와 날짜/인식 회귀 검사.
- node tests/api-smoke.mjs: 로컬 사이트 API의 인증·날짜·수집 요청 검증.
- node --experimental-strip-types tests/collector-server-smoke.mjs: .dev.vars의 배포 서버에 일회용 연결을 만들어 로그인 링크와 해제를 검사한다. 브라우저 사용량이 발생하며 실제 회원 계정은 사용하지 않는다.

공식 자료: [원격 로그인 인계](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/), [인증 상태 재사용](https://developers.cloudflare.com/browser-run/playwright/), [실행 한도](https://developers.cloudflare.com/browser-run/limits/).
