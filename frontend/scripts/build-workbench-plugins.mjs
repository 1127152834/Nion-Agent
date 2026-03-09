import { promises as fs } from "node:fs";
import path from "node:path";

import JSZip from "jszip";

const ROOT = path.resolve(process.cwd(), "workbench-plugins-src");
const DIST = path.resolve(process.cwd(), "workbench-plugins-dist");

async function listFilesRecursive(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(abs, baseDir);
      files.push(...nested);
      continue;
    }
    const rel = path.relative(baseDir, abs).replace(/\\/g, "/");
    files.push({ abs, rel });
  }
  return files;
}

async function buildPluginPackage(pluginDirName) {
  const pluginDir = path.join(ROOT, pluginDirName);
  const manifestPath = path.join(pluginDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error(`Invalid plugin manifest in ${pluginDirName}: missing id`);
  }

  const files = await listFilesRecursive(pluginDir, pluginDir);
  const zip = new JSZip();

  for (const file of files) {
    const content = await fs.readFile(file.abs);
    zip.file(file.rel, content);
  }

  const payload = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const outputPath = path.join(DIST, `${manifest.id}.nwp`);
  await fs.writeFile(outputPath, payload);
  return outputPath;
}

async function main() {
  await fs.mkdir(DIST, { recursive: true });
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const plugins = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  if (!plugins.length) {
    console.log("No plugins found in workbench-plugins-src");
    return;
  }

  for (const plugin of plugins) {
    const outputPath = await buildPluginPackage(plugin);
    console.log(`Built ${path.basename(outputPath)} -> ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
