import type { CollectionConfig } from "payload";
import { adminsOnly, automationScopes } from "@/lib/authz";

export const ServiceAccounts: CollectionConfig = {
  slug: "service-accounts",
  auth: {
    useAPIKey: true,
    disableLocalStrategy: true
  },
  admin: {
    group: "Access",
    useAsTitle: "name",
    description: "Machine identities for keyword research, generation, and import workflows."
  },
  access: {
    admin: ({ req }) => Boolean(adminsOnly({ req })),
    create: adminsOnly,
    read: adminsOnly,
    update: adminsOnly,
    delete: adminsOnly
  },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "description", type: "textarea" },
    {
      name: "scopes",
      type: "select",
      hasMany: true,
      required: true,
      options: automationScopes.map((scope) => ({ label: scope, value: scope }))
    },
    { name: "expiresAt", type: "date" }
  ]
};
