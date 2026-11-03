import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import {
  access,
  adminRole,
  reviewerRole,
  viewerRole,
} from "@/lib/auth-permissions";

export const authClient = createAuthClient({
  plugins: [
    adminClient({
      ac: access,
      roles: { admin: adminRole, reviewer: reviewerRole, viewer: viewerRole },
    }),
  ],
});
