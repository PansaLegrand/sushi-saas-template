import type { CollectionConfig } from "payload";
import { adminsOnly, editorRoles, hasEditorRole, isStudioUser } from "@/lib/authz";

export const Users: CollectionConfig = {
  slug: "users",
  auth: {
    maxLoginAttempts: 8,
    lockTime: 15 * 60 * 1000
  },
  admin: {
    group: "Access",
    useAsTitle: "name",
    defaultColumns: ["name", "email", "role", "updatedAt"]
  },
  access: {
    admin: ({ req }) => isStudioUser(req),
    create: async ({ req }) => {
      const result = await req.payload.count({ collection: "users", overrideAccess: true });
      return result.totalDocs === 0 || adminsOnly({ req });
    },
    read: ({ req }) => {
      if (hasEditorRole(req, ["admin"])) return true;
      if (req.user?.collection === "users") return { id: { equals: req.user.id } };
      return false;
    },
    update: ({ req, id }) => hasEditorRole(req, ["admin"]) || req.user?.id === id,
    delete: adminsOnly
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation !== "create") return data;
        const result = await req.payload.count({ collection: "users", overrideAccess: true });
        if (result.totalDocs === 0) data.role = "admin";
        return data;
      }
    ]
  },
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "role",
      type: "select",
      required: true,
      defaultValue: "writer",
      options: editorRoles.map((role) => ({
        label: role
          .split("-")
          .map((word) => word[0].toUpperCase() + word.slice(1))
          .join(" "),
        value: role
      })),
      access: {
        update: ({ req }) => hasEditorRole(req, ["admin"])
      }
    }
  ]
};
