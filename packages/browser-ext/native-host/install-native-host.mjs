#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");
const supportDirectory = join(
  homedir(),
  "Library",
  "Application Support",
  "Eterna",
);
const installedHostPath = join(supportDirectory, "eterna-terminal-host.mjs");
const wrapperPath = join(supportDirectory, "eterna-terminal-host");

function extensionIdForPath(path) {
  const digest = createHash("sha256").update(path).digest().subarray(0, 16);
  let id = "";
  for (const byte of digest) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  }
  return id;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function candidateExtensionIds() {
  const ids = new Set(
    process.argv.slice(2).filter((value) => EXTENSION_ID_PATTERN.test(value)),
  );
  for (const path of [extensionDirectory, join(extensionDirectory, "dist")]) {
    try {
      ids.add(extensionIdForPath(await realpath(path)));
    } catch {
      ids.add(extensionIdForPath(resolve(path)));
    }
  }
  return [...ids];
}

if (process.platform !== "darwin") {
  throw new Error("The Eterna Terminal helper currently supports macOS only.");
}

const extensionIds = await candidateExtensionIds();
await mkdir(supportDirectory, { recursive: true });
await copyFile(
  join(scriptDirectory, "eterna-terminal-host.mjs"),
  installedHostPath,
);
await writeFile(
  wrapperPath,
  `#!/bin/zsh\nexec ${shellQuote(process.execPath)} ${shellQuote(installedHostPath)}\n`,
  { mode: 0o755 },
);
await chmod(wrapperPath, 0o755);

const manifest = {
  name: "com.eterna.terminal",
  description: "Launches the fixed Eterna startup command in macOS Terminal.",
  path: wrapperPath,
  type: "stdio",
  allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
};

const browserManifestDirectories = [
  join(
    homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
  ),
  join(
    homedir(),
    "Library",
    "Application Support",
    "Chromium",
    "NativeMessagingHosts",
  ),
  join(
    homedir(),
    "Library",
    "Application Support",
    "BraveSoftware",
    "Brave-Browser",
    "NativeMessagingHosts",
  ),
];

for (const directory of browserManifestDirectories) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "com.eterna.terminal.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

process.stdout.write(
  `Installed Eterna Terminal helper for:\n${extensionIds
    .map((id) => `  chrome-extension://${id}/`)
    .join("\n")}\n`,
);
