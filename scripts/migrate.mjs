// drizzle/의 마이그레이션을 적용한다. 기본은 로컬 D1, --remote는 배포된 D1이다.
// 적용 기록을 D1에 남기므로 여러 번 실행해도 안전하다. Cloudflare 빌드의 배포 명령에서
// 그대로 호출할 수 있도록 만들었다.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./wrangler-env.mjs";

const LEDGER = "_chuljang_migrations";
const remote = process.argv.includes("--remote");
const config = path.join(projectRoot, "dist/server/wrangler.json");
const wrangler = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const migrations = path.join(projectRoot, "drizzle");

function execute(extra, { capture = false } = {}) {
  const args = [
    wrangler, "d1", "execute", "DB", remote ? "--remote" : "--local",
    "--config", config, "--yes", ...extra,
  ];
  if (!remote) args.push("--persist-to", path.join(projectRoot, ".wrangler/state"));

  const result = spawnSync(process.execPath, args, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

function rows(command) {
  const output = execute(["--json", "--command", command], { capture: true });
  const start = output.indexOf("[");
  if (start < 0) return [];
  const parsed = JSON.parse(output.slice(start));
  return parsed.flatMap((entry) => entry.results ?? []);
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const files = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
if (!files.length) {
  console.error("drizzle/에 적용할 마이그레이션이 없습니다.");
  process.exit(1);
}

execute([
  "--command",
  `CREATE TABLE IF NOT EXISTS ${LEDGER} (name text primary key, applied_at text not null)`,
]);

const applied = new Set(rows(`SELECT name FROM ${LEDGER}`).map((row) => row.name));

// 기록이 시작되기 전에 만들어진 데이터베이스는 첫 마이그레이션을 이미 반영한 상태다.
// 다시 실행하면 테이블 중복 생성으로 실패하므로, 적용된 것으로 기록만 남긴다.
if (!applied.size) {
  const existing = rows(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'receipts'",
  );
  if (existing.length) {
    const baseline = files[0];
    execute([
      "--command",
      `INSERT INTO ${LEDGER} (name, applied_at) VALUES (${quote(baseline)}, datetime('now'))`,
    ]);
    applied.add(baseline);
    console.log(`adopting ${baseline} (이미 반영된 스키마)`);
  }
}

const pending = files.filter((file) => !applied.has(file));
if (!pending.length) {
  console.log(`마이그레이션 최신 상태 (${remote ? "remote" : "local"}, ${files.length}개 적용됨)`);
  process.exit(0);
}

for (const file of pending) {
  console.log(`applying ${file} (${remote ? "remote" : "local"})`);
  execute(["--file", path.join(migrations, file)]);
  execute([
    "--command",
    `INSERT INTO ${LEDGER} (name, applied_at) VALUES (${quote(file)}, datetime('now'))`,
  ]);
}
console.log(`${pending.length}개 마이그레이션을 적용했습니다.`);
