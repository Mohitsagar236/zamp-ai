import "dotenv/config";
import { z } from "zod";
import { assertIndependentSecrets } from "../../../packages/contracts/src/index.js";
const value = z.object({
  DATABASE_URL: z.string().url(),
  SERVICE_TOKEN: z.string().min(32),
  OCR_PROVIDER: z.enum(["tesseract", "disabled"]).default("tesseract"),
  MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(10),
  MAX_PAGES: z.coerce.number().int().min(1).max(25).default(10),
  OCR_CACHE_DIR: z.string().default(".data/extraction-ocr"),
  PORT: z.coerce.number().int().default(4200),
  HOST: z.string().default("127.0.0.1"),
  SERVICE: z.literal("extraction").default("extraction"),
});
export const config = value.parse(process.env);
if (process.env.APP_ENV === "production")
  assertIndependentSecrets({ service: config.SERVICE_TOKEN });
