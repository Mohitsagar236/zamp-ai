import "dotenv/config";
import { z } from "zod";
import { assertIndependentSecrets } from "../../../packages/contracts/src/index.js";
const value = z.object({
  DATABASE_URL: z.string().url(),
  WORKFLOW_TOKEN: z.string().min(32),
  EXTRACTION_URL: z.string().url(),
  EXTRACTION_TOKEN: z.string().min(32),
  DECISION_URL: z.string().url(),
  DECISION_TOKEN: z.string().min(32),
  WORKSPACE_URL: z.string().url().default("http://127.0.0.1:3000"),
  WORKSPACE_AUTH_MODE: z
    .enum(["local", "basic", "individual"])
    .default("local"),
  WORKSPACE_USER: z.string().default("reviewer"),
  WORKSPACE_PASSWORD: z.string().default(""),
  WORKFLOW_IDENTITY_SECRET: z.string().default(""),
  STORAGE_DIR: z.string().default(".data/workflow-files"),
  MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(10),
  MAX_PAGES: z.coerce.number().int().min(1).max(25).default(10),
  APP_ENV: z.enum(["demo", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().default(4100),
  WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  HOST: z.string().default("127.0.0.1"),
  SERVICE: z.literal("workflow").default("workflow"),
});
export const config = value.parse(process.env);
if (config.APP_ENV === "production")
  assertIndependentSecrets({
    workflow: config.WORKFLOW_TOKEN,
    extraction: config.EXTRACTION_TOKEN,
    decision: config.DECISION_TOKEN,
    identity: config.WORKFLOW_IDENTITY_SECRET,
  });
if (
  config.APP_ENV === "production" &&
  config.WORKSPACE_AUTH_MODE !== "individual"
)
  throw Error("Production requires individual workspace authentication");
if (
  config.WORKSPACE_AUTH_MODE === "basic" &&
  config.WORKSPACE_PASSWORD.length < 16
)
  throw Error("WORKSPACE_PASSWORD needs at least 16 characters");
if (
  config.WORKSPACE_AUTH_MODE === "individual" &&
  config.WORKFLOW_IDENTITY_SECRET.length < 32
)
  throw Error("WORKFLOW_IDENTITY_SECRET needs at least 32 characters");
