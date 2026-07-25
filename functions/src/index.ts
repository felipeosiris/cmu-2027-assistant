import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

// Vault shipped next to the function source.
process.env.VAULT_CWD =
  process.env.VAULT_CWD || resolve(__dirname, "..", "vault");
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
