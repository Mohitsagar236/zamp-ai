import "dotenv/config";
import { z } from "zod";
import { assertIndependentSecrets } from "../../../packages/contracts/src/index.js";
const value = z.object({
  DATABASE_URL: z.string().url(),
  SERVICE_TOKEN: z.string().min(32),
  APP_ENV: z.enum(["demo", "production", "test"]).default("production"),
  ROUNDING_TOLERANCE_MINOR: z.coerce.number().int().min(0).max(100).default(1),
  PORT: z.coerce.number().int().default(4300),
  HOST: z.string().default("127.0.0.1"),
  SERVICE: z.literal("decision").default("decision"),
});
export const config = value.parse(process.env);
if (config.APP_ENV === "production")
  assertIndependentSecrets({ service: config.SERVICE_TOKEN });
export const policy = {
  version: "AP-2026.1",
  roundingMinor: config.ROUNDING_TOLERANCE_MINOR,
  balanceToleranceMinor: 0 as const,
  reservation:
    "Ready recommendations reserve funds; rejection releases them. Review and blocked invoices reserve nothing.",
};
