import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  APP_ENV: z.enum(["demo", "production", "test"]).default("demo"),
  AUTH_MODE: z.enum(["local", "basic"]).default("local"),
  WORKSPACE_USER: z.string().default("reviewer"),
  WORKSPACE_PASSWORD: z.string().default(""),
  STORAGE_DIR: z.string().default(".data/files"),
  OCR_PROVIDER: z.enum(["tesseract", "disabled"]).default("tesseract"),
  MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(10),
  MAX_PAGES: z.coerce.number().int().min(1).max(25).default(10),
  ROUNDING_TOLERANCE_MINOR: z.coerce.number().int().min(0).max(100).default(1),
});
export const config = schema.parse(process.env);
if (
  config.AUTH_MODE === "local" &&
  (!["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(config.APP_URL).hostname,
  ) ||
    config.APP_ENV === "production")
)
  throw Error(
    "Local authentication requires a loopback APP_URL and non-production APP_ENV",
  );
if (config.AUTH_MODE === "basic" && config.WORKSPACE_PASSWORD.length < 16)
  throw Error("Set a unique WORKSPACE_PASSWORD of at least 16 characters");
export const policy = {
  version: "AP-2026.1",
  roundingMinor: config.ROUNDING_TOLERANCE_MINOR,
  balanceToleranceMinor: 0,
  reservation:
    "Ready recommendations reserve funds; rejection releases them. Review and blocked invoices reserve nothing.",
};
