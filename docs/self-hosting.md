# 직접 배포와 로그인

이 앱은 ChatGPT Sites에서 만들었지만 더 이상 ChatGPT 로그인에 의존하지 않는다. 로그인은 앱이 직접 처리하고, 배포는 Cloudflare Workers 계정만 있으면 된다.

## 무엇이 바뀌었나

| 이전 (ChatGPT Sites) | 지금 |
| --- | --- |
| `/signin-with-chatgpt`를 플랫폼이 가로챔 | 앱의 `/signin` 화면과 `POST /api/auth/signin` |
| 플랫폼이 넣어 주는 `oai-authenticated-user-*` 헤더로 사용자 식별 | 앱이 서명한 `chuljang_session` 쿠키 |
| 로컬 개발은 vite 플러그인이 로그인 쿠키를 위조 | 로컬도 실제 로그인 화면을 그대로 사용 |
| `.openai/hosting.json`이 바인딩 정의 | 루트 `hosting.json` (`.openai/hosting.json`이 있으면 함께 읽어 호환 유지) |
| 허용 출처에 `chuljang-receipts.jhleokim.chatgpt.site` 고정 | 같은 출처 기본 허용 + `CHULJANG_APP_ORIGINS` |

기존 `/signin-with-chatgpt`·`/signout-with-chatgpt` 주소로 들어오는 링크는 새 경로로 넘어간다.

## 환경 변수

`.env.example`을 복사해 로컬은 `.dev.vars`, 배포는 `wrangler secret put`으로 설정한다.

| 이름 | 설명 |
| --- | --- |
| `CHULJANG_AUTH_SECRET` | 세션 서명 키. 배포 환경 필수. `openssl rand -base64 48` |
| `CHULJANG_ACCESS_CODE` | 배포 환경 로그인에 필요한 접속 코드. localhost에서는 없어도 로그인된다 |
| `CHULJANG_ALLOWED_EMAILS` | 선택. 로그인 가능한 이메일 목록(쉼표 구분) |
| `CHULJANG_USER_ALIASES` | 선택. `me@example.com=user_기존ID` 형식으로 기존 계정 데이터를 이어받는다 |
| `CHULJANG_APP_ORIGINS` | 선택. 다른 도메인에서도 제공할 때 허용할 출처 |
| `CHULJANG_TRUST_PLATFORM_AUTH` | 선택. `1`이면 `oai-authenticated-user-*` 헤더를 신뢰한다. **ChatGPT Sites 뒤에서 운영할 때만 켠다** |
| `CHULJANG_COLLECTOR_URL`·`CHULJANG_COLLECTOR_SECRET` | 서버 수집 연결. [서버 설정](zero-install-collection.md) 참고 |

`CHULJANG_AUTH_SECRET`이 없으면 배포 호스트에서는 로그인 화면이 설정 안내를 표시하고 로그인을 막는다. 앱 앞단에 신뢰할 수 있는 프록시가 없는 배포에서 `CHULJANG_TRUST_PLATFORM_AUTH`를 켜면 누구나 헤더를 위조해 다른 사용자로 접근할 수 있으므로 기본값은 꺼짐이다.

## 기존 데이터 이어받기

영수증과 출장은 사용자 ID 기준으로 저장된다. 새 로그인은 이메일에서 안정적인 ID(`usr_…`)를 만들고, 기존 ChatGPT 계정 ID로 저장된 데이터는 `CHULJANG_USER_ALIASES=me@example.com=기존ID`로 연결한다. 기존 ID는 운영 D1의 `receipts.user_id`에서 확인한다.

```
npx wrangler d1 execute DB --remote --config dist/server/wrangler.json \
  --command "select user_id, count(*) from receipts group by user_id"
```

## 배포

0. Cloudflare API 토큰을 준비한다. 권한은 Workers Scripts 편집, Workers R2 Storage 편집, D1 편집, Workers KV 읽기가 필요하다.
   ```
   export CLOUDFLARE_ACCOUNT_ID=...
   export CLOUDFLARE_API_TOKEN=...
   ```
1. D1과 R2를 만든다. 출력에 나오는 database_id를 다음 단계에 쓴다.
   ```
   npx wrangler d1 create chuljang
   npx wrangler r2 bucket create chuljang-receipts
   ```
2. 실제 식별자를 넣어 빌드한다. 값을 주지 않으면 로컬 개발용 자리표시자가 들어간다.
   ```
   CHULJANG_D1_DATABASE_ID=... CHULJANG_D1_DATABASE_NAME=... CHULJANG_R2_BUCKET_NAME=... npm run build
   ```
3. `npm run db:migrate:remote`으로 스키마를 적용한다.
4. `npm run deploy`로 Worker를 올린다. 계정 선택은 `CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_API_TOKEN`을 사용한다.
5. `wrangler secret put CHULJANG_AUTH_SECRET`, `CHULJANG_ACCESS_CODE`와 필요한 수집 비밀키를 설정한다.

주소는 `chuljang.<계정 subdomain>.workers.dev`가 된다. 자체 도메인은 나중에 Cloudflare 대시보드나 wrangler routes로 연결한다.

## GitHub Actions로 배포

`.github/workflows/deploy.yml`이 위 절차를 대신 수행한다. 수동 실행 전용이라 푸시만으로 배포되지 않는다. **workflow_dispatch 워크플로는 기본 브랜치에 있어야 Actions 탭에 나타난다.**

1. Cloudflare에서 D1·R2를 만들고 API 토큰을 발급한다(위 0~1단계).
2. 저장소 Settings → Secrets and variables → Actions에 등록한다.

   | 종류 | 이름 | 값 |
   | --- | --- | --- |
   | Variables | `CHULJANG_D1_DATABASE_ID` | `wrangler d1 create` 출력의 database_id |
   | Variables | `CHULJANG_D1_DATABASE_NAME` | 예: `chuljang` |
   | Variables | `CHULJANG_R2_BUCKET_NAME` | 예: `chuljang-receipts` |
   | Secrets | `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` | 배포 자격증명 |
   | Secrets | `CHULJANG_AUTH_SECRET`·`CHULJANG_ACCESS_CODE` | 로그인 설정. 없으면 배포본에서 로그인할 수 없다 |
   | Secrets | `CHULJANG_ALLOWED_EMAILS`·`CHULJANG_USER_ALIASES`·`CHULJANG_COLLECTOR_URL`·`CHULJANG_COLLECTOR_SECRET` | 선택. 비워 두면 건너뛴다 |

3. Actions → Deploy → Run workflow. 마이그레이션 적용과 비밀키 갱신은 실행할 때 켜고 끌 수 있다.

워크플로는 테스트·타입체크를 통과해야 배포하고, 배포 후 Worker 비밀키를 넣은 다음 실행 요약에 접속 주소를 남긴다. 비어 있는 시크릿은 건너뛰므로 기존 값이 지워지지 않는다.

Cloudflare 계정 자격증명이 없어 이 저장소에서 실제 배포를 실행해 확인하지는 못했다. 빌드 산출물(`dist/server/wrangler.json`, `workers_dev: true`), 로컬 마이그레이션, 워크플로의 셸 로직과 YAML은 확인했다.

## 확장(collector/)

`collector/`는 호환 목적으로 남긴 Chrome 확장 실험 코드이며 제품 흐름에는 필요하지 않다. 자체 도메인으로 옮길 때는 `collector/providers.js`의 `DESTINATION`(또는 로드 전에 `globalThis.CHULJANG_DESTINATION`)과 `collector/manifest.json`의 `host_permissions`·`matches`를 함께 바꾼다.
