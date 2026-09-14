# Proxmox 홈서버 실행

Sites/Cloudflare 설정을 유지하면서 별도 Linux VM에서 웹앱·SQLite·파일·Chromium을 실행합니다. 홈서버 실행에는 Cloudflare 계정, 브라우저 사용료, 사용자 확장 프로그램이 필요하지 않습니다.

## 실행 구조

- Proxmox 전용 Debian VM 권장: 2 CPU, RAM 6 GB, 디스크 32 GB. 하이퍼바이저에는 Docker를 설치하지 않습니다.
- `selfhost/compose.yml`이 앱을 실행하고 `chuljang-data` 볼륨에 DB, 원본 파일, 암호화된 서비스 로그인 상태를 저장합니다.
- 앱은 호스트의 `127.0.0.1:3080`에만 노출됩니다. 기존 HTTPS 프록시 또는 Caddy로 연결합니다. 원격 접속은 HTTPS가 필요합니다.
- 독립적인 서비스 로그인 화면은 noVNC로 전달합니다. VNC와 Chromium 제어 포트는 외부에 열지 않습니다. 로그인 확인 후 화면 접근 권한이 종료됩니다.
- 수집기는 Node 24의 기본 TypeScript 실행을 사용합니다. `tsx`처럼 함수에 외부 보조 코드를 붙이는 변환기를 사용하면 공식 사이트에 전달한 함수가 실행되지 않을 수 있으므로 운영 실행 명령을 유지합니다.
- 브라우저 HTTPS 프록시는 LAN·루프백·메타데이터 주소를 차단합니다. Chromium은 일반 사용자와 샌드박스로 실행합니다.

## 최초 설치

Linux VM에 Docker와 Compose를 준비하고 프로젝트 루트에서 실행합니다.

```sh
npm run home:prepare -- https://receipts.example.com
docker compose -f selfhost/compose.yml up -d --build
```

`home:prepare`에는 Node 24가 필요합니다. `.env`와 `admin-password.txt`는 덮어쓰지 않으며 Git과 Docker 빌드에서 제외됩니다. 비밀번호 파일은 관리자만 보관하고, 앱 로그인 후 별도 비밀번호 관리 도구로 옮길 수 있습니다. 비밀번호 변경은 `.env`의 해시를 교체한 뒤 앱을 재시작하며 기존 앱 로그인 세션도 무효화됩니다. 암호화 키는 데이터 복구에 필요하므로 보관합니다.

`Caddyfile.example`의 도메인을 실제 도메인으로 교체합니다. LAN IP에 `tls internal`을 사용할 경우 사용자가 해당 내부 인증서를 신뢰해야 합니다. 외부 접속을 허용할 때는 앱의 80/443만 연결하고 Proxmox 8006은 외부에 노출하지 않습니다.

Chromium이 샌드박스 오류로 종료된다면 VM의 unprivileged user namespaces 지원과 제공된 seccomp 설정을 점검합니다. `--no-sandbox`나 privileged 컨테이너로 우회하지 않습니다. seccomp 파일은 Playwright v1.63.0 공식 저장소에서 가져왔습니다.

## 이전과 복구

기존 Sites 데이터가 자동으로 홈서버에 복사되지는 않습니다. 실제 이전 시 기존 저장소를 백업하고, 원본 파일과 영수증/출장 행을 함께 옮기며 `HOME_OWNER_ID`를 원래 소유자 ID에 맞춰야 합니다. 검증이 끝날 때까지 기존 사이트는 유지합니다.

백업은 앱을 정지한 뒤 Docker 데이터 볼륨 전체와 `selfhost/.env`를 함께 보관합니다. 실행 중 SQLite 파일 하나만 복사하지 않습니다. 서비스 중단·복구는 `docker compose ... stop`, `start`를 사용합니다. `down -v`는 데이터를 삭제하므로 사용하지 않습니다.

## 검증 범위

- `npm run home:build`: 일반 Next.js 운영 빌드
- `npm run home:test`: 실제 SQLite, HTTP 인증, 위조 헤더, 원격 화면 접근, 데이터 재시작/취소 검증
- `node --test tests/*.test.mjs`: 기존 기능 포함
- Proxmox Debian 12 VM의 실제 Linux 컨테이너에서 KTX 공식 페이지 열기, 로그인 대기 상태, 인증된 HTTPS 화면과 noVNC 연결을 검증했습니다. 검사 후 임시 서비스 연결은 해제했습니다.

KTX 날짜 조회·페이지 이동·원문 PDF 어댑터를 재사용합니다. 실제 회원 계정으로 최종 검증이 필요합니다. 티머니·고속버스는 로그인 및 회원 화면 구조 확인까지 구현되어 있으며, 자동 날짜 조회와 수집은 아직 `adapter_pending`입니다. 홈서버로 옮겼다는 이유로 수집 완료를 표시하지 않습니다.

참고: [Next.js 자체 호스팅](https://nextjs.org/docs/app/guides/self-hosting), [Playwright Docker](https://playwright.dev/docs/docker), [noVNC API](https://novnc.com/noVNC/docs/API.html). noVNC는 MPL 2.0이며 설치 패키지에 원문 라이선스가 포함됩니다.
