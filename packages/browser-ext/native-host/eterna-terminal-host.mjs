#!/usr/bin/env node

import { spawn } from "node:child_process";

let input = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function launchEterna() {
  return new Promise((resolve) => {
    const script = [
      'tell application "Terminal"',
      "activate",
      'do script "eterna"',
      "end tell",
    ].join("\n");
    const child = spawn("/usr/bin/osascript", ["-e", script], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
    child.on("close", (code) => {
      resolve(
        code === 0
          ? { success: true }
          : {
              success: false,
              error: errorOutput.trim() || `osascript exited with code ${code}`,
            },
      );
    });
  });
}

async function handle(message) {
  if (message?.action !== "launch_eterna") {
    return { success: false, error: "Unsupported action." };
  }
  return launchEterna();
}

function readMessages() {
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < length + 4) return;
    const payload = input.subarray(4, length + 4);
    input = input.subarray(length + 4);
    try {
      const message = JSON.parse(payload.toString("utf8"));
      void handle(message).then(send);
    } catch {
      send({ success: false, error: "Invalid native message." });
    }
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  readMessages();
});
