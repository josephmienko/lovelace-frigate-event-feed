import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distPath = resolve(root, "dist", "lovelace-frigate-event-feed.js");
const source = await readFile(distPath, "utf8");

assert.match(source, /customElements\.define\(\s*"frigate-event-feed"/);
assert.match(source, /custom:frigate-event-feed/);
assert.match(source, /frigate\/events\/get/);
assert.match(source, /frigate\/event\/retain/);
assert.match(source, /frigate\/event\/delete/);
assert.match(source, /advanced-camera-card:action:execution-request/);
assert.match(source, /instance_id/);
assert.doesNotMatch(source, /crooked-sentry-m3-detection-feed|Crooked Sentry M3 Detection Feed/);
assert.doesNotMatch(source, /\bm3r[fo]:/);
