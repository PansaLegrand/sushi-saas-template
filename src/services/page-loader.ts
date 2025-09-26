import { docs as sourceDocs } from "@/.source";
import { loader } from "fumadocs-core/source";

export const { getPage, getPages, pageTree } = loader({
  source: sourceDocs.toFumadocsSource(),
  baseUrl: "/docs",
});
