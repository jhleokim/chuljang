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

  const { d1, r2 } = await loadHostingConfig(process.cwd());

  // Local development uses placeholder identifiers. Set these variables before
  // `npm run build` to emit a wrangler config that deploys to your own account.
  const bindingConfig = {
    main: "vinext/server/fetch-handler",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: process.env.CHULJANG_D1_DATABASE_NAME || "site-creator-d1",
            database_id: process.env.CHULJANG_D1_DATABASE_ID || PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: process.env.CHULJANG_R2_BUCKET_NAME || "site-creator-r2",
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
