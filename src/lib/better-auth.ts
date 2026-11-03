import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { assertIndependentSecrets } from "@/lib/types";
import { admin } from "better-auth/plugins";
import {
  access,
  adminRole,
  reviewerRole,
  viewerRole,
} from "@/lib/auth-permissions";

if (
  process.env.APP_ENV === "production" &&
  (process.env.AUTH_MODE !== "individual" ||
    (process.env.AUTH_SECRET ?? "").length < 32 ||
    (process.env.WORKFLOW_IDENTITY_SECRET ?? "").length < 32)
)
  throw new Error(
    "Production requires individual authentication and independent signing secrets",
  );
if (process.env.APP_ENV === "production")
  assertIndependentSecrets({
    authentication: process.env.AUTH_SECRET,
    identity: process.env.WORKFLOW_IDENTITY_SECRET,
    workflow: process.env.WORKFLOW_TOKEN,
  });

export const authDb = new Pool({
  connectionString:
    process.env.AUTH_DATABASE_URL ??
    "postgresql://auth_build:auth_build@127.0.0.1:5432/auth_build",
  max: 10,
});

export const auth = betterAuth({
  appName: "InvoiceLens",
  baseURL: process.env.APP_URL ?? "http://127.0.0.1:3000",
  secret:
    process.env.AUTH_SECRET ?? "build-only-secret-change-before-use-32chars",
  database: authDb,
  rateLimit: { storage: "database" },
  trustedOrigins: [process.env.APP_URL ?? "http://127.0.0.1:3000"],
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.AUTH_BOOTSTRAP !== "true",
    minPasswordLength: 14,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 15,
    cookieCache: { enabled: false },
  },
  plugins: [
    admin({
      ac: access,
      roles: { admin: adminRole, reviewer: reviewerRole, viewer: viewerRole },
      adminRoles: ["admin"],
      defaultRole: "viewer",
    }),
  ],
  advanced: {
    useSecureCookies: process.env.APP_URL?.startsWith("https://") ?? false,
    database: {
      validateSchema: process.env.NEXT_PHASE !== "phase-production-build",
    },
  },
});
