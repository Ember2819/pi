#!/usr/bin/env node
// Packs a portable, Node-only distribution of pi for legacy CPUs (AMD E2-1800 / Bobcat:
// no SSE4.x, no AVX). The official Bun-compiled binary dies with SIGILL there; this
// layout runs the same code under a baseline x86-64 Node build.
//
// Usage:  node build-portable.mjs [out-dir]
// Needs:  pi/ fork clone with `npm run build:offline` already run.

import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = join(scriptDir, "pi");
const agentDir = join(repoDir, "packages", "coding-agent");
const outDir = resolve(process.argv[2] ?? join(scriptDir, "portable"));
const version = JSON.parse(readFileSync(join(agentDir, "package.json"), "utf8")).version;
const stage = join(outDir, `pi-${version}-legacy-node`);

for (const p of [join(agentDir, "dist", "bundle", "cli.js"), join(repoDir, "node_modules", "jiti")]) {
	if (!statSync(p, { throwIfNoEntry: false })) {
		throw new Error(`missing ${p} — run: cd pi && npm ci && npm run build:offline`);
	}
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// Package root: pi resolves assets and node_modules relative to the dir containing package.json.
cpSync(join(agentDir, "package.json"), join(stage, "package.json"));
cpSync(join(agentDir, "dist"), join(stage, "dist"), { recursive: true });
rmSync(join(stage, "dist", "bun"), { recursive: true, force: true });
for (const entry of ["docs", "examples", "README.md", "CHANGELOG.md"]) {
	cpSync(join(agentDir, entry), join(stage, entry), { recursive: true });
}

// Runtime externals the esbuild bundle leaves to createRequire. Both are dependency-free.
mkdirSync(join(stage, "node_modules"), { recursive: true });
cpSync(join(repoDir, "node_modules", "@silvia-odwyer"), join(stage, "node_modules", "@silvia-odwyer"), {
	recursive: true,
});
cpSync(join(repoDir, "node_modules", "jiti"), join(stage, "node_modules", "jiti"), { recursive: true });

// Optional X11 clipboard helper (pure SSE2-era code; loaded behind try/catch).
cpSync(join(repoDir, "packages", "tui", "native", "linux"), join(stage, "native", "linux"), { recursive: true });

// Launcher.
writeFileSync(
	join(stage, "pi"),
	[
		"#!/bin/sh",
		"# pi on a legacy CPU: needs any Node >= 22.19 compiled for baseline x86-64",
		"# (e.g. `pacman -S nodejs` on Arch/Omarchy). Override with PI_NODE=/path/to/node.",
		"set -eu",
		'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
		'NODE_BIN="${PI_NODE:-node}"',
		'command -v "$NODE_BIN" >/dev/null 2>&1 || {',
		'  echo "pi: node not found. Install node (Arch: pacman -S nodejs) or set PI_NODE." >&2',
		"  exit 1",
		"}",
		'exec "$NODE_BIN" "$DIR/dist/bundle/cli.js" "$@"',
		"",
	].join("\n"),
);
chmodSync(join(stage, "pi"), 0o755);

const tarball = join(outDir, `pi-${version}-legacy-node.tar.gz`);
execFileSync("tar", ["-czf", tarball, "-C", outDir, `pi-${version}-legacy-node`]);
console.log(`staged: ${stage}`);
console.log(`tarball: ${tarball}`);
