import { mkdtemp, cp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
await mkdir("artifacts", { recursive: true });
const stage = await mkdtemp(path.join(tmpdir(), "tablight-package-"));
const { version } = JSON.parse(
  await readFile("extension/manifest.json", "utf8"),
);
const filename = `tablight-${version}.zip`;
const zip = path.resolve("artifacts", filename);
await cp("extension", stage, { recursive: true });
await cp("README.md", path.join(stage, "README.md"));
await rm(zip, { force: true });
execFileSync("/usr/bin/zip", ["-qr", zip, "."], { cwd: stage });
const hash = createHash("sha256")
  .update(await readFile(zip))
  .digest("hex");
await writeFile("artifacts/SHA256SUMS", `${hash}  ${filename}\n`);
await rm(stage, { recursive: true });
console.log(zip + "\nSHA256 " + hash);
