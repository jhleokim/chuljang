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

## 배포 — 푸시하면 Cloudflare가 배포

Cloudflare Workers Builds에 저장소를 연결하면 브랜치에 푸시할 때마다 빌드·배포된다. 별도의 CI 설정이나 API 토큰 보관은 필요 없다.

### 최초 1회

1. D1과 R2를 만든다.
   ```
   npx wrangler d1 create chuljang
   npx wrangler r2 bucket create chuljang-receipts
   ```
2. 출력된 `database_id`를 `hosting.json`의 `d1_database_id`에 넣고 커밋한다. 이 값은 비밀이 아니며, 저장소에 있어야 Cloudflare 빌드가 바인딩을 찾는다. 이름을 바꿨다면 `d1_database_name`·`r2_bucket_name`도 맞춘다.
3. Cloudflare 대시보드 → Workers & Pages → Create → Import a repository에서 이 저장소를 연결하고 설정한다.

   | 항목 | 값 |
   | --- | --- |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy --config dist/server/wrangler.json` |
   | Root directory | `/` |
   | Build variable | `NODE_VERSION=22` |

4. 스키마를 적용한다. 로컬에서 한 번만 실행하면 된다.
   ```
   npm run build && npm run db:migrate:remote
   ```
5. 로그인 비밀키를 넣는다. 저장소에는 넣지 않는다.
   ```
   npx wrangler secret put CHULJANG_AUTH_SECRET --config dist/server/wrangler.json
   npx wrangler secret put CHULJANG_ACCESS_CODE --config dist/server/wrangler.json
   ```
   대시보드의 Worker → Settings → Variables and Secrets에서 넣어도 된다. 수집 서버를 쓰면 `CHULJANG_COLLECTOR_URL`·`CHULJANG_COLLECTOR_SECRET`도 같은 방식으로 설정한다.

주소는 `chuljang.<계정 subdomain>.workers.dev`가 된다. 자체 도메인은 Worker → Settings → Domains & Routes에서 붙인다.

### 이후

푸시만 하면 된다. 마이그레이션은 자동으로 돌지 않는다. `drizzle/`에 새 SQL이 생겼을 때만 `npm run db:migrate:remote`를 한 번 실행한다(기존 파일을 다시 적용하면 테이블 중복 생성으로 실패한다).

`d1_database_id`를 비워 둔 채 Cloudflare 빌드가 돌면 빌드 단계에서 안내와 함께 실패한다. 로컬 개발은 이 값이 비어 있어도 자리표시자로 동작한다.

Cloudflare 계정 자격증명이 없어 이 저장소에서 실제 배포를 실행해 확인하지는 못했다. 빌드 산출물(`dist/server/wrangler.json`, `workers_dev: true`), 식별자 주입, 빈 `d1_database_id` 가드, 로컬 마이그레이션은 확인했다.

## 확장(collector/)

`collector/`는 호환 목적으로 남긴 Chrome 확장 실험 코드이며 제품 흐름에는 필요하지 않다. 자체 도메인으로 옮길 때는 `collector/providers.js`의 `DESTINATION`(또는 로드 전에 `globalThis.CHULJANG_DESTINATION`)과 `collector/manifest.json`의 `host_permissions`·`matches`를 함께 바꾼다.
