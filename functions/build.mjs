import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(__dirname, "lib");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "server/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(outDir, "app.js"),
  packages: "external",
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
});

writeFileSync(
  join(outDir, "index.js"),
  `import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

process.env.VAULT_CWD = process.env.VAULT_CWD || resolve(__dirname, "..", "vault");
process.env.CMU_AGENT_RUNTIME = process.env.CMU_AGENT_RUNTIME || "cloud";
process.env.CMU_SKIP_LISTEN = "1";
process.env.NODE_ENV = "production";

const { app } = await import("./app.js");

export const cmuAssistantApi = onRequest(
  {
    timeoutSeconds: 360,
    memory: "2GiB",
    cors: true,
  },
  app
);
`
);

const vaultSrc = join(root, "vault");
const vaultDst = join(__dirname, "vault");
if (existsSync(vaultSrc)) {
  rmSync(vaultDst, { recursive: true, force: true });
  cpSync(vaultSrc, vaultDst, { recursive: true });
  console.log("copied vault → functions/vault");
}

console.log("functions build ok");
