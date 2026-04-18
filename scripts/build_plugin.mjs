import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "src", "frigate-event-feed.js");
const outputPath = resolve(root, "dist", "lovelace-frigate-event-feed.js");

const banner = `/**
 * Built file for the Frigate Event Feed HACS artifact.
 * Edit src/frigate-event-feed.js and rerun npm run build.
 */

`;

const source = await readFile(sourcePath, "utf8");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, banner + source.trimEnd() + "\n", "utf8");
