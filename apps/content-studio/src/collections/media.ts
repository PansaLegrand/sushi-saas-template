import path from "node:path";
import type { CollectionConfig } from "payload";
import { contentEditors, isStudioUser, publishersAndAdmins } from "@/lib/authz";

export const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticDir: path.resolve(process.cwd(), "media"),
    imageSizes: [
      { name: "thumbnail", width: 480, height: 320, position: "centre" },
      { name: "social", width: 1200, height: 630, position: "centre" }
    ],
    mimeTypes: ["image/*"]
  },
  admin: {
    group: "Content",
    useAsTitle: "alt",
    defaultColumns: ["filename", "alt", "updatedAt"]
  },
  access: {
    create: contentEditors,
    read: ({ req }) => (isStudioUser(req) ? true : { isPublic: { equals: true } }),
    update: contentEditors,
    delete: publishersAndAdmins
  },
  fields: [
    { name: "alt", type: "text", localized: true, required: true },
    { name: "caption", type: "textarea", localized: true },
    {
      name: "isPublic",
      type: "checkbox",
      defaultValue: false,
      admin: {
        position: "sidebar",
        description: "Enable only after this asset is ready to appear on a published page."
      }
    }
  ]
};
