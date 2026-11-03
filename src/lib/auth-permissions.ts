import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

const statement = {
  ...defaultStatements,
  invoice: ["view", "upload", "review"],
  references: ["read", "create", "update", "import"],
  reconciliation: ["read", "resolve"],
} as const;
export const access = createAccessControl(statement);
export const adminRole = access.newRole({
  ...adminAc.statements,
  invoice: ["view", "upload", "review"],
  references: ["read", "create", "update", "import"],
  reconciliation: ["read", "resolve"],
});
export const reviewerRole = access.newRole({
  invoice: ["view", "upload", "review"],
  references: ["read"],
  reconciliation: ["read"],
});
export const viewerRole = access.newRole({
  invoice: ["view"],
  references: ["read"],
  reconciliation: ["read"],
});
