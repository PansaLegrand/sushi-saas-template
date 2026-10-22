import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const templateRoot = fileURLToPath(
  new URL("../templates/domain/", import.meta.url),
);
export function domainFiles(name) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 48)
    throw new Error("Use a kebab-case domain name of at most 48 characters.");
  const pascal = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  const targets = {
    types: `src/types/${name}.ts`,
    config: `src/config/${name}.ts`,
    model: `src/models/${name}.ts`,
    service: `src/services/${name}.ts`,
    api: `src/api/${name}.ts`,
    route: `src/app/api/${name}/route.ts`,
    test: `tests/api/${name}.test.ts`,
    contract: `docs/domains/${name}.md`,
  };
  return Object.entries(targets).map(([template, path]) => ({
    path,
    content: readFileSync(resolve(templateRoot, `${template}.txt`), "utf8")
      .replaceAll("__DOMAIN__", name)
      .replaceAll("__PASCAL__", pascal)
      .replaceAll("__CONSTANT__", name.replaceAll("-", "_").toUpperCase()),
  }));
}

export function scaffoldDomain(root, name, dryRun = false) {
  const files = domainFiles(name);
  for (const file of files)
    if (existsSync(resolve(root, file.path)))
      throw new Error(`Refusing to overwrite ${file.path}`);
  if (dryRun) return files.map((file) => file.path);
  const created = [];
  try {
    for (const file of files) {
      const destination = resolve(root, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, { flag: "wx" });
      created.push(destination);
    }
  } catch (error) {
    for (const file of created) unlinkSync(file);
    throw error;
  }
  return files.map((file) => file.path);
}
