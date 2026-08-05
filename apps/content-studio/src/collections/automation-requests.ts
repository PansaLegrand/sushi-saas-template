import type { CollectionConfig } from "payload";
import { adminsOnly } from "@/lib/authz";

export const AutomationRequests: CollectionConfig = {
  slug: "automation-requests",
  admin: { hidden: true },
  endpoints: false,
  access: {
    create: adminsOnly,
    read: adminsOnly,
    update: adminsOnly,
    delete: adminsOnly
  },
  fields: [
    { name: "idempotencyKey", type: "text", required: true, unique: true, index: true },
    { name: "requestHash", type: "text", required: true },
    { name: "operation", type: "text", required: true },
    { name: "identity", type: "text", required: true },
    { name: "statusCode", type: "number", required: true },
    { name: "response", type: "json", required: true }
  ]
};
