// Hosting glue for local development and builds.
// Header handling is derived from @openai/sites-vite-plugin 0.2.0 (openai/sites#9);
// see sites-vite-plugin.LICENSE for the upstream MIT license. The sign-in flow it
// used to fake now lives in the application itself (app/signin, app/api/auth/signin),
// so this plugin only keeps hosting bindings and spoofed platform headers in check.
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const PLATFORM_HEADER_PREFIX = "oai-authenticated-user-";

export type HostingConfig = { d1?: string; r2?: string; project_id?: string };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string): Promise<HostingConfig | null> {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8")) as HostingConfig;
}

// hosting.json is the source of truth. .openai/hosting.json stays readable so an
// existing ChatGPT Sites project keeps deploying while it is being migrated.
export async function loadHostingConfig(root: string): Promise<HostingConfig> {
  const own = await readJson(resolve(root, "hosting.json"));
  const platform = await readJson(resolve(root, ".openai", "hosting.json"));
  return { ...platform, ...own };
}

export function hosting(): Plugin {
  let root = process.cwd();
  let command: "build" | "serve" = "build";

  return {
    name: "chuljang-hosting",
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    configureServer(server) {
      // Only a hosting platform in front of the app may assert these headers.
      // Locally they are always removed unless the platform bridge is switched on.
      if (process.env.CHULJANG_TRUST_PLATFORM_AUTH === "1") return;

      server.middlewares.use((request, _response, next) => {
        for (const name of Object.keys(request.headers)) {
          if (name.startsWith(PLATFORM_HEADER_PREFIX)) removeHeader(request, name);
        }
        next();
      });
    },
    async closeBundle() {
      if (command !== "build") return;

      const config = await loadHostingConfig(root);
      const drizzleSource = resolve(root, "drizzle");
      const distribution = resolve(root, "dist");
      const platformOutput = resolve(distribution, ".openai");

      await rm(platformOutput, { recursive: true, force: true });
      await mkdir(distribution, { recursive: true });
      await writeFile(
        resolve(distribution, "hosting.json"),
        `${JSON.stringify(config, null, 2)}\n`,
      );
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(distribution, "drizzle"), { recursive: true });
      }

      // Mirror the layout the ChatGPT Sites control plane expects, for as long as
      // that deployment is still in use.
      if (await exists(resolve(root, ".openai", "hosting.json"))) {
        await mkdir(platformOutput, { recursive: true });
        await writeFile(
          resolve(platformOutput, "hosting.json"),
          `${JSON.stringify(config, null, 2)}\n`,
        );
        if (await exists(drizzleSource)) {
          await cp(drizzleSource, resolve(platformOutput, "drizzle"), { recursive: true });
        }
      }
    },
  };
}

function removeHeader(request: IncomingMessage, name: string): void {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders.splice(index, 2);
    }
  }
}
