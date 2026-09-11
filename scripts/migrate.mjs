// drizzle/의 마이그레이션을 순서대로 적용한다. 기본은 로컬 D1, --remote는 배포된 D1이다.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./wrangler-env.mjs";

const remote = process.argv.includes("--remote");
const config = path.join(projectRoot, "dist/server/wrangler.json");
const files = readdirSync(path.join(projectRoot, "drizzle"))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (!files.length) {
  console.error("drizzle/에 적용할 마이그레이션이 없습니다.");
  process.exit(1);
}

for (const file of files) {
  const args = [
    path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
    "d1", "execute", "DB", remote ? "--remote" : "--local",
    "--config", config,
    "--file", path.join(projectRoot, "drizzle", file),
    "--yes",
  ];
  if (!remote) args.push("--persist-to", path.join(projectRoot, ".wrangler/state"));

  console.log(`applying ${file} (${remote ? "remote" : "local"})`);
  const applied = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (applied.error) throw applied.error;
  if (applied.status !== 0) process.exit(applied.status ?? 1);
}
