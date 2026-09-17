# Cloud app + home collector

The public application is `https://chuljang.hanatrust.workers.dev`.

## Temporary test mode

`TEST_MODE=1` removes the application's username/password UI. Opening `/`
creates a random, HttpOnly browser-specific test session; requests without that
cookie cannot read an existing account. Normal member/admin accounts are kept
and are not used as a shared anonymous workspace. Test workspaces and shares
expire after 24 hours; the directory alarm deletes their data and queues home
collector revocation. `/api/test-session/end` deletes only the current test
workspace and requires the same-origin POST and its cookie.

Home collector IDs beginning with `test-` always use a fresh browser and never
load or save service authentication state. Deploy the matching home collector
revision before turning this mode on. An old collector does not support this
privacy guarantee. Existing normal accounts remain available if test mode is
later turned off.

Fresh KTX sessions enter the official `/ticket/login` page, wait for its real
form and a stable authenticated state, and go directly to the first dated
query without the intermediate protected history navigation. Tmoney uses its
official mobile login/security-keypad path because its desktop login can
request a Windows-only keyboard driver. Captchas and identity checks remain
user actions on the official screen. Never remove those protections or send
credentials from a replacement form.

`tests/test-mode-smoke.mjs <origin>` verifies independent browser spaces,
private files, templates, and identity/origin rejection. Add `--collector`
only after deploying the home revision to check official-login readiness,
mobile controls, and WSS. These checks do not validate a member's actual
receipt totals; test dates and official member login are still needed.

- **Cloudflare Worker:** UI, app sign-in, receipt APIs, trip management, report
  templates and export/share workflows. Static assets are hosted on Cloudflare.
- **D1:** receipt, trip, template and share metadata. Existing owner IDs survive
  migration; the database rejects writes by disabled accounts.
- **AccountDirectory Durable Object:** only the invitation/identity directory,
  atomic invitation consumption, password authentication, session revocation,
  and recoverable account deletion. Receipt queries are served independently.
- **PrivateFile Durable Objects:** one object per encrypted private file, with
  bounded chunks and no public object endpoint. This account does not have R2
  enabled; the existing bucket interface maps to these Cloudflare objects.
- **Home server:** only service login browsers and receipt collection. Service
  cookies and pending captures remain encrypted on the home server. Cloud app
  requests use timestamped HMAC signatures; the collector rejects replayed nonces.
- **Remote login:** authenticated cloud route proxies only the collection screen.
  Home server checks current cloud identity before accepting it and rechecks
  every 10 seconds. Raw identity/forwarding headers are discarded at the edge.

Stopping the home server must not stop sign-in, existing receipt views, uploaded
files, or report creation. Collection can be unavailable independently. No
Cloudflare Browser Rendering binding or paid browser action is used.

Build using `node scripts/build-cloud.mjs`, then deploy
`dist/server/wrangler.json` with Wrangler. The separate Sites build remains the
default `npm run build`; `.openai/hosting.json` still describes that older Site.
Do not deploy the Sites authentication build to the public workers.dev address.

Set `HOME_PASSWORD_HASH`, `CLOUD_FILE_KEY`, and `CHULJANG_COLLECTOR_SECRET` using
Wrangler secrets. Bootstrap migration additionally uses `CLOUD_MIGRATION_KEY`;
delete that secret after verification. Never commit any of these values.

Initialize a fresh cloud D1 with the two `drizzle/*.sql` files, followed by
`cloud/accounts-schema.sql`. The application stays closed with `MIGRATION_LOCK=1`
until the one-time migration reports completion. Back up and stop the home app
before running `cloud/migrate-from-home.mjs` inside its Docker image with the data
volume mounted. The migration preserves member password hashes, consent records,
receipt IDs, files, settings and shares; login sessions must be renewed on the
new domain. It rejects imports after completion. Keep the old image and backup
until both cloud and collector checks pass.

Home runtime: set `COLLECTOR_ONLY=1`, `CLOUD_ORIGIN` to the workers.dev origin,
and the matching `CHULJANG_COLLECTOR_SECRET`. Preserve `HOME_COLLECTOR_KEY` and
the previous data volume. Requests to the old ASUS address redirect to the cloud
app; signed `/collector` and remote-screen requests remain its TLS transport.
Keep the ASUS DNS/certificate and existing Nginx/Caddy proxy available.

The operator can access these systems and their encryption keys. Cloudflare
terminates TLS and stores app data. This is expressly disclosed in consent v2;
it does not claim encryption against the operator or Cloudflare.

Validation: `tests/cloud-production-smoke.mjs` uses two disposable accounts and
preserves the administrator's data. Supply `CHULJANG_TEST_PASSWORD` privately.
Test authenticated collection WSS separately and verify the cloud app while the
home collector is stopped. Live member receipt totals remain a separate check.
