import vinext from "vinext";
import { defineConfig } from "vite";
import { hosting, loadHostingConfig } from "./build/hosting-vite-plugin";

const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so sandboxed previews need polling for HMR.
const isSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const config = await loadHostingConfig(process.cwd());
  const { d1, r2 } = config;
  const databaseName =
    process.env.CHULJANG_D1_DATABASE_NAME || config.d1_database_name || "site-creator-d1";
  const databaseId =
    process.env.CHULJANG_D1_DATABASE_ID || config.d1_database_id || "";
  const bucketName =
    process.env.CHULJANG_R2_BUCKET_NAME || config.r2_bucket_name || "site-creator-r2";

  // Cloudflare's git-connected builds set WORKERS_CI. Deploying with the local
  // placeholder there would publish a Worker bound to a database that does not
  // exist, so fail the build with the fix instead.
  if (d1 && !databaseId && process.env.WORKERS_CI) {
    throw new Error(
      "hosting.json의 d1_database_id가 비어 있습니다. `wrangler d1 create`가 출력한 id를 넣고 커밋하거나 CHULJANG_D1_DATABASE_ID를 설정하세요.",
    );
  }

  // Local development falls back to placeholder identifiers.
  const bindingConfig = {
    main: "vinext/server/fetch-handler",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: databaseName,
            database_id: databaseId || PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: bucketName,
          },
        ]
      : [],
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      hosting(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: bindingConfig,
      }),
    ],
  };
});
