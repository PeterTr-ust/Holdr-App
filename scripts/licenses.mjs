/**
 * Third-party license check and notice generator.
 *
 * 1. Collects every production dependency (npm and, optionally, Rust crates).
 * 2. Fails if any dependency is not available under a license from ALLOWED,
 *    i.e. one that permits commercial, closed-source distribution.
 * 3. Writes a text file with all license texts, which has to ship with the
 *    product (MIT, BSD, Apache etc. require the notices to be included).
 *
 * Usage:
 *   node scripts/licenses.mjs --npm <dir> [--cargo <dir>] [--out <file.txt>] [--json <file.json>]
 *
 * --out writes a plain text notice file, --json a structured file for a
 * rendered licenses page. At least one of them is required.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Licenses that allow use in commercial, closed-source software.
 * MPL-2.0 is file-level copyleft: unmodified use is fine, the notice file
 * points to where its sources are available.
 */
const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "CDLA-Permissive-2.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Unlicense",
  "Zlib",
]);

/** Our own packages, which are not third-party. */
const OWN_PACKAGES = new Set(["holdr", "holdr-website"]);

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((!args.out && !args.json) || (!args.npm && !args.cargo)) {
    console.error(
      "Usage: node scripts/licenses.mjs --npm <dir> [--cargo <dir>] [--out <file.txt>] [--json <file.json>]",
    );
    process.exit(2);
  }

  const packages = [
    ...(args.npm ? collectNpm(resolve(args.npm)) : []),
    ...(args.cargo ? collectCargo(resolve(args.cargo)) : []),
  ].filter((p) => !OWN_PACKAGES.has(p.name));

  const violations = packages.filter((p) => !isAllowed(p.license));
  if (violations.length > 0) {
    console.error("These dependencies have licenses that are not allowed:");
    for (const p of violations)
      console.error(`  ${p.ecosystem} ${p.name}@${p.version}: ${p.license}`);
    console.error(
      "Replace them, or add the license to ALLOWED in scripts/licenses.mjs after review.",
    );
    process.exit(1);
  }

  const notices = collectNotices(packages);
  if (args.out) write(args.out, renderText(notices));
  if (args.json) write(args.json, `${JSON.stringify(notices, null, 1)}\n`);
  console.log(
    `✓ ${packages.length} dependencies checked, notices written to ${[args.out, args.json].filter(Boolean).join(" and ")}`,
  );
}

// ---------------------------------------------------------------------------
// Collecting dependencies
// ---------------------------------------------------------------------------

function collectNpm(dir) {
  const output = execFileSync(
    "npm",
    ["ls", "--omit=dev", "--all", "--parseable"],
    {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  const paths = [...new Set(output.split(/\r?\n/).filter(Boolean))].slice(1);
  return paths.map((path) => {
    const manifest = JSON.parse(
      readFileSync(join(path, "package.json"), "utf8"),
    );
    const license =
      typeof manifest.license === "string"
        ? manifest.license
        : (manifest.licenses ?? []).map((l) => l.type ?? l).join(" OR ") ||
          "UNKNOWN";
    return {
      ecosystem: "npm",
      name: manifest.name,
      version: manifest.version,
      license,
      source:
        repositoryUrl(manifest.repository) ??
        `https://www.npmjs.com/package/${manifest.name}`,
      texts: readLicenseTexts(path),
    };
  });
}

function collectCargo(dir) {
  const output = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked"],
    {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const metadata = JSON.parse(output);
  // Only crates reachable from our own crate count, not unused optional ones.
  const used = new Set(metadata.resolve.nodes.map((n) => n.id));
  return metadata.packages
    .filter((p) => used.has(p.id))
    .map((p) => ({
      ecosystem: "crate",
      name: p.name,
      version: p.version,
      license: p.license ?? "UNKNOWN",
      source: p.repository ?? `https://crates.io/crates/${p.name}`,
      texts: readLicenseTexts(dirname(p.manifest_path)),
    }));
}

function readLicenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => LICENSE_FILE.test(entry))
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      // Some packages keep several texts in a LICENSES/ folder.
      return statSync(path).isDirectory()
        ? readdirSync(path)
            .sort()
            .map((file) => join(path, file))
            .filter((file) => statSync(file).isFile())
        : [path];
    })
    .map((file) => readFileSync(file, "utf8").trim())
    .filter(Boolean);
}

function repositoryUrl(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  return url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? null;
}

// ---------------------------------------------------------------------------
// SPDX expressions
// ---------------------------------------------------------------------------

/** Evaluates an SPDX expression such as "(MIT OR Apache-2.0) AND Unicode-3.0". */
export function isAllowed(expression) {
  // Old crates use "/" as a shorthand for OR.
  const tokens = expression
    .replace(/\s*\/\s*/g, " OR ")
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .split(/\s+/)
    .filter(Boolean);
  let position = 0;

  const parseOr = () => {
    let result = parseAnd();
    while (tokens[position] === "OR") {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  const parseAnd = () => {
    let result = parseTerm();
    while (tokens[position] === "AND") {
      position += 1;
      const right = parseTerm();
      result = result && right;
    }
    return result;
  };
  const parseTerm = () => {
    if (tokens[position] === "(") {
      position += 1;
      const result = parseOr();
      position += 1; // closing parenthesis
      return result;
    }
    let id = tokens[position++] ?? "";
    if (tokens[position] === "WITH") {
      id = `${id} WITH ${tokens[position + 1]}`;
      position += 2;
    }
    return ALLOWED.has(id);
  };

  return parseOr();
}

// ---------------------------------------------------------------------------
// Notice file
// ---------------------------------------------------------------------------

/**
 * Groups packages with their license texts. Identical texts (e.g. the Apache
 * license) are stored once and referenced by a short hash.
 */
function collectNotices(packages) {
  const sorted = [...packages].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const texts = {};
  const list = sorted.map((p) => ({
    name: p.name,
    version: p.version,
    ecosystem: p.ecosystem,
    license: p.license,
    source: p.source,
    texts: p.texts.map((text) => {
      const key = createHash("sha256").update(text).digest("hex").slice(0, 10);
      texts[key] = text;
      return key;
    }),
  }));
  return { packages: list, texts };
}

function renderText({ packages, texts }) {
  const lines = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "This product includes the following third-party components.",
    "Their license texts follow below the list.",
    "",
  ];
  for (const p of packages) {
    lines.push(`${p.name} ${p.version} (${p.ecosystem}) – ${p.license}`);
    lines.push(`  Source: ${p.source}`);
    lines.push(
      `  License text: ${p.texts.length > 0 ? p.texts.map((k) => `[${k}]`).join(" ") : "see SPDX identifier above"}`,
    );
  }
  lines.push("", "=".repeat(78), "LICENSE TEXTS", "=".repeat(78));
  for (const [key, text] of Object.entries(texts)) {
    lines.push("", `[${key}]`, "-".repeat(78), text);
  }
  return `${lines.join("\n")}\n`;
}

function write(path, content) {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2)
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  return args;
}

// Run only when executed directly, not when imported (e.g. to test isAllowed).
if (process.argv[1]?.endsWith("licenses.mjs")) {
  main();
}
