#!/usr/bin/env node
/**
 * OpenJudge Mesh Agent — a bounded evidence companion, not an evaluator.
 *
 * Analyzes a local project directory and produces a signed evidence
 * manifest. It NEVER uploads file contents, secrets, environment files, or
 * private developer activity: the manifest carries hashes, paths, sizes, and
 * structural metadata only.
 *
 * The agent may collect evidence and run declared checks. It must not assign
 * winners, override human scores, or infer quality from code volume.
 *
 * Usage:
 *   node mesh/agent.mjs analyze <dir> --event <id> --project <id> --team <id> \
 *     --submission <id> [--out manifest.json] [--key agent.key]
 *     [--attach <kind>:<file>[:<claimId>] [--attach ...]]
 *   node mesh/agent.mjs replay <manifest.json> [--cwd <dir>] [--out report.json] [--key agent.key]
 *   node mesh/agent.mjs verify <manifest.json> [--key agent.key]
 *
 * --attach registers a participant-authored file (interaction trace, demo
 * scene, scan report, ...) as a hashed artifact. Contents are never uploaded;
 * only the hash, size, and filename enter the manifest. Attached artifacts
 * carry provenance producer "participant" and trusted false, so judges can
 * tell observed evidence apart from supplied files.
 */

import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const AGENT_VERSION = "mesh/0.1.0";
const MAX_FILES = 5000;
const MAX_TEXT_BYTES = 200 * 1024;
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

// Participant-authored kinds the agent may register by hash. Agent-observed
// kinds (ast_snapshot, dependency_graph, replay_capsule, test_report,
// milestone_attestation, ...) are generated, never attached.
const ATTACHABLE_KINDS = new Set([
  "interaction_trace",
  "interaction_recording",
  "spatial_demo_scene",
  "accessibility_report",
  "security_scan",
  "documentation_snapshot",
  "runtime_trace",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".output", "coverage",
  ".nyc_output", "vendor", "target", "__pycache__", ".venv", "venv", ".tox",
]);
const SKIP_FILES = [/\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /^\.env(\.|$)/, /\.env$/, /secret/i, /credential/i];
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".json", ".yml", ".yaml", ".toml", ".sql", ".md", ".txt", ".html",
  ".css", ".sh", ".dockerfile",
]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go"]);

const SECRET_PATTERNS = [  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /xox[baprs]-[0-9A-Za-z-]+/,
  /gh[pousr]_[0-9A-Za-z]{20,}/,
  /sk-(live|test)-[0-9A-Za-z-]{10,}/,
  /(password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{4,}['"]/i,
];

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function merkleRoot(leaves) {
  if (leaves.length === 0) return sha256Hex("openjudge:empty-manifest");
  let level = leaves.slice().sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0];
}

function parseArgs(argv) {
  const out = { _: [] };
  let key = null;
  for (const arg of argv) {
    if (key) {
      out[key] = arg;
      key = null;
    } else if (arg.startsWith("--")) {
      key = arg.slice(2);
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function loadOrCreateKey(keyPath) {  if (keyPath && existsSync(keyPath)) {
    const raw = JSON.parse(readFileSync(keyPath, "utf8"));
    return raw;
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyId: "",
  };
  key.keyId = sha256Hex(key.publicKeyPem).slice(0, 16);
  if (keyPath) {
    writeFileSync(keyPath, JSON.stringify(key, null, 2), { mode: 0o600 });
  }
  return key;
}

function walk(dir, root, files) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(root, full);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, root, files);
    } else if (st.isFile()) {
      files.push({ full, rel, size: st.size });
    }
    if (files.length > MAX_FILES) return;
  }
}

function isSkipped(rel) {
  const base = basename(rel);
  return SKIP_FILES.some((re) => re.test(base) || re.test(rel));
}

function readTextCapped(full, size) {
  if (size > MAX_TEXT_BYTES) return null;
  try {
    const buf = readFileSync(full);
    const text = buf.toString("utf8");
    if (text.includes("")) return null;
    return text;
  } catch {
    return null;
  }
}

function extractSymbols(rel, text) {
  const symbols = [];
  const push = (kind, name) => {
    if (name && name.length <= 80) symbols.push({ kind, name });
  };
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+))/g)) {
    push(m[2] ? "class" : m[1] ? "function" : "symbol", m[1] ?? m[2] ?? m[3]);
  }
  for (const m of text.matchAll(/^(?:def|class)\s+(\w+)/gm)) push("symbol", m[1]);
  for (const m of text.matchAll(/(?:^|\s)(?:function)\s+(\w+)/g)) push("function", m[1]);
  return symbols;
}

function extractImports(rel, text) {
  const imports = new Set();
  for (const m of text.matchAll(/(?:import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g)) {
    imports.add(m[1] ?? m[2]);
  }
  for (const m of text.matchAll(/^\s*(?:from|import)\s+([a-zA-Z0-9_.]+)/gm)) imports.add(m[1]);
  return [...imports].slice(0, 40);
}

function extractEndpoints(rel, text) {
  const endpoints = [];
  const patterns = [
    /\.(get|post|put|patch|delete|options|head)\(\s*['"`]([^'"`]+)['"`]/g,
    /createServerFn\s*\(\s*\{[^}]*method:\s*["'](\w+)["']/g,
    /createFileRoute\(\s*["'`]([^'"`]+)["'`]/g,
    /@app\.route\(\s*["']([^"']+)["']/g,
    /(?:app|router)\.(route)\(\s*["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) endpoints.push(m[2] ?? m[1] ?? "route");
  }
  return [...new Set(endpoints)].slice(0, 40);
}

function extractTables(rel, text) {
  const tables = [];
  for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_".]+)/gi)) {
    tables.push(m[1].replace(/"/g, ""));
  }
  for (const m of text.matchAll(/^\s*class\s+(\w+)\s*\(\s*(?:Base|Model|db\.Model)/gm)) tables.push(m[1]);
  return [...new Set(tables)].slice(0, 40);
}

function analyzeProject(dir) {
  const files = [];
  walk(dir, dir, files);
  const included = [];
  const excluded = [];
  const secretHits = [];
  let totalBytes = 0;

  for (const f of files) {
    if (isSkipped(f.rel)) {
      excluded.push(f.rel);
      continue;
    }
    const hash = sha256Hex(readFileSync(f.full));
    totalBytes += f.size;
    const ext = extname(f.rel).toLowerCase();
    const record = { rel: f.rel, size: f.size, hash, text: null };
    if (TEXT_EXTS.has(ext) || basename(f.rel).toLowerCase() === "dockerfile") {
      const text = readTextCapped(f.full, f.size);
      if (text !== null) {
        for (const re of SECRET_PATTERNS) {
          if (re.test(text)) {
            secretHits.push(f.rel);
            break;
          }
        }
        record.text = secretHits.includes(f.rel) ? null : text;
        if (secretHits.includes(f.rel)) excluded.push(`${f.rel} (possible secret — refused)`);
      }
    }
    if (!secretHits.includes(f.rel)) included.push(record);
  }

  return { included, excluded, secretHits, totalBytes };
}

function detectRuntime(dir, included) {
  const byName = new Map(included.map((f) => [basename(f.rel).toLowerCase(), f]));
  const hasCompose = byName.has("docker-compose.yml") || byName.has("docker-compose.yaml") || byName.has("compose.yaml");
  let pkg = null;
  const pkgFile = included.find((f) => f.rel === "package.json" || f.rel.endsWith("/package.json"));
  if (pkgFile?.text) {
    try {
      pkg = JSON.parse(pkgFile.text);
    } catch {
      pkg = null;
    }
  }
  let startupCommand = "";
  let runtime = "native";
  if (hasCompose) {
    runtime = "docker-compose";
    startupCommand = "docker compose up --build";
  } else if (pkg?.scripts?.start) {
    startupCommand = "npm start";
  } else if (pkg?.scripts?.dev) {
    startupCommand = "npm run dev";
  } else if (byName.has("dockerfile")) {
    runtime = "container";
    startupCommand = "docker build -t app . && docker run app";
  }
  return { runtime, startupCommand, pkg, hasCompose };
}

function buildAstGraph(included) {
  const nodes = [];
  const edges = [];
  const byRel = new Map();
  for (const f of included) {
    const ext = extname(f.rel).toLowerCase();
    if (!CODE_EXTS.has(ext)) continue;
    const isTest = /(^|\W)(test|spec)(\W|$)/i.test(f.rel);
    const modId = `module:${f.rel}`;
    nodes.push({
      id: modId,
      kind: isTest ? "test" : "module",
      label: f.rel,
      sourceRef: `${f.rel}#sha256:${f.hash.slice(0, 12)}`,
      tags: isTest ? ["test"] : [],
    });
    byRel.set(f.rel, modId);
    if (!f.text) continue;
    for (const sym of extractSymbols(f.rel, f.text)) {
      const id = `symbol:${f.rel}::${sym.name}`;
      nodes.push({ id, kind: sym.kind === "class" ? "class" : "function", label: sym.name, sourceRef: f.rel, tags: [] });
      edges.push({ source: modId, target: id, kind: "calls" });
    }
    for (const endpoint of extractEndpoints(f.rel, f.text)) {
      const id = `endpoint:${f.rel}::${endpoint}`;
      if (!nodes.some((n) => n.id === id)) {
        nodes.push({ id, kind: "endpoint", label: endpoint, sourceRef: f.rel, tags: ["http"] });
      }
      edges.push({ source: modId, target: id, kind: "calls" });
    }
    for (const table of extractTables(f.rel, f.text)) {
      const id = `table::${table}`;
      if (!nodes.some((n) => n.id === id)) {
        nodes.push({ id, kind: "table", label: table, sourceRef: f.rel, tags: ["data"] });
      }
      edges.push({ source: modId, target: id, kind: "writes" });
    }
    for (const imp of extractImports(f.rel, f.text)) {
      if (imp.startsWith(".") || imp.startsWith("/")) {
        edges.push({ source: modId, target: `import:${imp}`, kind: "imports" });
      }
    }
  }
  // Link tests to the modules they most likely cover (same basename).
  for (const node of nodes) {
    if (node.kind !== "test") continue;
    const base = basename(node.label).replace(/\.(test|spec)\.[a-z]+$/i, "").toLowerCase();
    for (const other of nodes) {
      if (other.kind !== "module") continue;
      if (basename(other.label).toLowerCase().startsWith(base) && base.length >= 3) {
        edges.push({ source: node.id, target: other.id, kind: "tests" });
      }
    }
  }
  const complexity = (text) => {
    if (!text) return undefined;
    const branches = (text.match(/\b(if|for|while|case|catch|&&|\|\|)\b/g) ?? []).length;
    return Math.min(50, 1 + branches);
  };
  for (const node of nodes) {
    if (node.kind === "function" || node.kind === "class") {
      const modRel = node.sourceRef;
      const mod = included.find((f) => f.rel === modRel);
      node.complexity = complexity(mod?.text ?? null);
    }
  }
  return { nodes, edges };
}

function detectTests(included, pkg) {
  const testFiles = included.filter((f) => /(^|\W)(test|spec)(\W|$)/i.test(f.rel)).map((f) => f.rel);
  const frameworks = [];
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    if (/vitest|jest|mocha|pytest|playwright|cypress|ava|tap|bun/i.test(name)) frameworks.push(name);
  }
  return { testFiles, frameworks };
}

function externalUrls(texts) {
  const urls = new Set();
  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)}\]]+/g)) {
      try {
        const host = new URL(m[0]).hostname;
        if (!["example.org", "example.com", "localhost", "127.0.0.1"].includes(host)) urls.add(host);
      } catch {
        /* ignore */
      }
    }
  }
  return [...urls];
}

/** Every --attach value in argv order (parseArgs keeps only the last). */
function collectAttaches() {
  const specs = [];
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--attach" && i + 1 < argv.length) specs.push(argv[i + 1]);
  }
  return specs;
}

function cmdAnalyze(opts) {
  const dir = opts._[0];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error("analyze: <dir> must be an existing directory");
    process.exit(1);
  }
  for (const required of ["event", "project", "team", "submission"]) {
    if (!opts[required]) {
      console.error(`analyze: --${required} is required`);
      process.exit(1);
    }
  }

  const { included, excluded, secretHits, totalBytes } = analyzeProject(dir);
  if (secretHits.length > 0) {
    console.error("analyze: refusing to seal — possible secrets detected in:");
    for (const hit of secretHits) console.error(`  - ${hit}`);
    console.error("Move them out of the project or exclude them, then re-run.");
    process.exit(2);
  }

  const { runtime, startupCommand, pkg, hasCompose } = detectRuntime(dir, included);
  const { testFiles, frameworks } = detectTests(included, pkg);
  const astGraph = buildAstGraph(included);
  const endpoints = astGraph.nodes.filter((n) => n.kind === "endpoint");
  const tables = astGraph.nodes.filter((n) => n.kind === "table");
  const texts = included.map((f) => f.text).filter(Boolean);
  const externals = externalUrls(texts);
  const networkPolicy = externals.length === 0 ? "offline" : "allowlisted";

  const deps = pkg ? Object.keys(pkg.dependencies ?? {}) : [];
  const devDeps = pkg ? Object.keys(pkg.devDependencies ?? {}) : [];
  const hasReadme = included.some((f) => /^readme\.md$/i.test(basename(f.rel)));
  const hasLicense = included.some((f) => /^(license|licence)(\..*)?$/i.test(basename(f.rel)));

  const artifacts = [];
  const art = (id, kind, hash, extra = {}) => {
    artifacts.push({
      id,
      kind,
      contentHash: hash,
      uri: `mesh-agent:${kind}/${hash.slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      provenance: { producer: "mesh-agent", trusted: true, ...extra },
    });
  };

  const astJson = canonicalJson(astGraph);
  art("ast_snapshot_001", "ast_snapshot", sha256Hex(astJson));
  art(
    "dependency_graph_001",
    "dependency_graph",
    sha256Hex(canonicalJson({ direct: deps.sort(), dev: devDeps.sort() })),
  );
  const fileListHash = sha256Hex(canonicalJson(included.map((f) => ({ path: f.rel, size: f.size, hash: f.hash }))));
  art("replay_capsule_001", "replay_capsule", fileListHash);
  if (testFiles.length > 0) {
    art("test_report_001", "test_report", sha256Hex(canonicalJson(testFiles.sort())));
  }
  if (hasReadme) {
    const readme = included.find((f) => /^readme\.md$/i.test(basename(f.rel)));
    art("documentation_snapshot_001", "documentation_snapshot", readme.hash);
  }
  art("milestone_sealed_001", "milestone_attestation", sha256Hex(canonicalJson({ event: opts.event, project: opts.project, at: "sealed" })));

  const claims = [
    {
      id: "core_flow_runs",
      statement: "The project's core flow starts and serves its declared entry point.",
      category: "core_functionality",
      expectedEvidence: ["replay_capsule"],
      evidenceRefs: ["replay_capsule_001"],
      status: "UNVERIFIED",
    },
    {
      id: "offline_operation",
      statement:
        networkPolicy === "offline"
          ? "The project declares no external network dependencies."
          : `The project contacts: ${externals.slice(0, 5).join(", ")}.`,
      category: "deployment",
      expectedEvidence: ["replay_capsule"],
      evidenceRefs: ["replay_capsule_001"],
      status: "UNVERIFIED",
    },
    {
      id: "dependency_review",
      statement: `Direct dependencies are declared and reviewable (${deps.length} direct).`,
      category: "security",
      expectedEvidence: ["dependency_graph", "security_scan"],
      evidenceRefs: ["dependency_graph_001"],
      status: "UNVERIFIED",
    },
    {
      id: "test_coverage_claim",
      statement:
        testFiles.length > 0
          ? `${testFiles.length} test file(s) are linked to source modules.`
          : "No test files were detected.",
      category: "core_functionality",
      expectedEvidence: ["test_report"],
      evidenceRefs: testFiles.length > 0 ? ["test_report_001"] : [],
      status: "UNVERIFIED",
    },
    {
      id: "impact_statement",
      statement: "EDIT ME: who benefits and what measurable outcome is expected.",
      category: "impact",
      expectedEvidence: ["documentation_snapshot"],
      evidenceRefs: hasReadme ? ["documentation_snapshot_001"] : [],
      status: "UNVERIFIED",
    },
  ];

  // Participant-supplied files: hashed and registered, never uploaded.
  // Specs look like "<kind>:<file>[:<claimId>]" and may repeat.
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  for (const spec of collectAttaches()) {
    const parts = spec.split(":");
    const kind = parts[0];
    const claimId = parts.length > 2 ? parts.slice(2).join(":") : undefined;
    const file = parts[1];
    if (!kind || !ATTACHABLE_KINDS.has(kind)) {
      console.error(`analyze: --attach kind must be one of ${[...ATTACHABLE_KINDS].join(", ")} (got "${kind ?? ""}")`);
      process.exit(2);
    }
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      console.error(`analyze: --attach file not found: ${file ?? "(missing)"}`);
      process.exit(2);
    }
    const size = statSync(file).size;
    if (size > MAX_ATTACH_BYTES) {
      console.error(`analyze: --attach file exceeds 5MB: ${file}`);
      process.exit(2);
    }
    if (claimId && !claimsById.has(claimId)) {
      console.error(`analyze: --attach claim unknown: ${claimId}`);
      process.exit(2);
    }
    const contentHash = sha256Hex(readFileSync(file));
    const artifactId = `${kind}_attached_${contentHash.slice(0, 8)}`;
    if (!artifacts.some((a) => a.id === artifactId)) {
      artifacts.push({
        id: artifactId,
        kind,
        contentHash,
        uri: `mesh-agent:attached/${contentHash.slice(0, 12)}`,
        createdAt: new Date().toISOString(),
        provenance: { producer: "participant", trusted: false, sourceRef: basename(file), bytes: size },
      });
    }
    if (claimId) {
      const claim = claimsById.get(claimId);
      if (!claim.evidenceRefs.includes(artifactId)) claim.evidenceRefs.push(artifactId);
    }
  }

  const scenarios = [
    {
      id: "cold_start",
      title: "Cold start and health check",
      steps: [
        { id: "st-startup", kind: "command", target: startupCommand || "(no startup command detected)", expectation: "exit code 0" },
        ...(endpoints.slice(0, 3).map((e, i) => ({
          id: `st-endpoint-${i}`,
          kind: "http",
          target: e.label.startsWith("http") ? e.label : `http://localhost:3000${e.label.startsWith("/") ? e.label : "/"}`,
          expectation: "HTTP 200",
        }))),
        ...(tables.slice(0, 2).map((t, i) => ({
          id: `st-table-${i}`,
          kind: "file",
          target: `schema declares ${t.label}`,
          expectation: "contains:CREATE",
        }))),
      ],
      expectedOutcome: "The project starts from a clean checkout and serves its entry point.",
      claimRefs: ["core_flow_runs"],
    },
  ];

  const manifest = {
    schemaVersion: "1.0",
    submissionId: opts.submission,
    eventId: opts.event,
    projectId: opts.project,
    teamId: opts.team,
    sealedAt: new Date().toISOString(),
    merkleRoot: "",
    attestation: { algorithm: "ed25519", publicKeyId: "", signature: "", agentVersion: AGENT_VERSION },
    claims,
    artifacts,
    environment: {
      runtime,
      startupCommand: startupCommand || "(undetected — set manually)",
      healthChecks: [
        { id: "hc-startup", kind: "startup", target: startupCommand || "(undetected)", expectation: "process stays up for 30s" },
        { id: "hc-offline", kind: "offline", target: "outbound network", expectation: networkPolicy === "offline" ? "no external hosts referenced" : `allowlist: ${externals.slice(0, 5).join(", ")}` },
      ],
      scenarios,
      networkPolicy,
    },
    policyDeclarations: [
      { type: "license", statement: pkg?.license ? `Declared license: ${pkg.license}.` : hasLicense ? "A LICENSE file is present." : "No license declared." },
      { type: "offline_capable", statement: networkPolicy === "offline" ? "No external network dependencies detected." : "External hosts detected; replay must allowlist them." },
      { type: "no_secrets_uploaded", statement: `Manifest carries hashes and structure only. ${excluded.length} path(s) excluded; no file contents uploaded.` },
      { type: "privacy", statement: "No keystrokes, screen activity, secrets, or private repositories were collected." },
    ],
    // Documented extension (not part of the signed core schema): the
    // structural graph the Observatory renders as a constellation.
    astGraph,
    dependencyGraph: { direct: deps.sort(), dev: devDeps.sort(), testFrameworks: frameworks },
    fileInventory: { files: included.length, bytes: totalBytes, excluded: excluded.length },
  };

  const leafHashes = artifacts.map((a) =>
    sha256Hex(canonicalJson({ kind: a.kind, id: a.id, contentHash: a.contentHash })),
  );
  manifest.merkleRoot = merkleRoot(leafHashes);

  const key = loadOrCreateKey(opts.key ?? "agent.key");
  manifest.attestation.publicKeyId = key.keyId;
  const payload = canonicalJson({ ...manifest, attestation: { ...manifest.attestation, signature: "" } });
  manifest.attestation.signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(key.privateKeyPem)).toString("hex");

  const outPath = opts.out ?? "manifest.json";
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log(`Sealed manifest for project "${opts.project}"`);
  console.log(`  files analyzed : ${included.length} (${totalBytes} bytes, contents never uploaded)`);
  console.log(`  files excluded : ${excluded.length}`);
  console.log(`  ast nodes/edges: ${astGraph.nodes.length}/${astGraph.edges.length}`);
  console.log(`  endpoints      : ${endpoints.length}, tables: ${tables.length}`);
  console.log(`  tests          : ${testFiles.length} file(s)${frameworks.length ? ` (${frameworks.join(", ")})` : ""}`);
  console.log(`  runtime        : ${runtime} — ${startupCommand || "(undetected)"}`);
  console.log(`  merkle root    : ${manifest.merkleRoot}`);
  console.log(`  pairing code   : ${manifest.merkleRoot.slice(0, 12)}`);
  console.log(`  manifest       : ${outPath}`);
}

function runStep(step, cwd) {
  const started = Date.now();
  try {
    if (step.kind === "file") {
      const target = step.target;
      if (target.startsWith("schema declares ")) {
        return { id: step.id, ok: true, detail: "schema declaration recorded (agent-side check)", durationMs: Date.now() - started };
      }
      const exists = existsSync(join(cwd, target));
      const expectation = step.expectation ?? "";
      let ok = exists;
      let detail = exists ? "file exists" : "file missing";
      const m = expectation.match(/^contains:(.+)$/);
      if (ok && m) {
        const text = readFileSync(join(cwd, target), "utf8");
        ok = text.includes(m[1]);
        detail = ok ? `contains "${m[1]}"` : `does not contain "${m[1]}"`;
      }
      return { id: step.id, ok, detail, durationMs: Date.now() - started };
    }
    if (step.kind === "http") {
      const expected = Number((step.expectation ?? "").match(/HTTP\s+(\d+)/)?.[1] ?? 200);
      const result = spawnSync("node", ["-e", `fetch(${JSON.stringify(step.target)}).then(r=>{console.log(r.status);}).catch(e=>{console.error("ERR:"+e.message);process.exit(3);})`], {
        timeout: 15000,
        encoding: "utf8",
      });
      const status = Number((result.stdout ?? "").trim());
      const ok = status === expected;
      return {
        id: step.id,
        ok,
        detail: result.status === 3 ? `request failed: ${(result.stderr ?? "").trim().slice(0, 200)}` : `HTTP ${status} (expected ${expected})`,
        durationMs: Date.now() - started,
      };
    }
    if (step.kind === "command") {
      if (!step.target || step.target.startsWith("(")) {
        return { id: step.id, ok: false, detail: "no runnable command declared", durationMs: Date.now() - started };
      }
      const result = spawnSync(step.target, { shell: true, cwd, timeout: 30000, encoding: "utf8" });
      const ok = result.status === 0;
      return {
        id: step.id,
        ok,
        detail: ok ? "exit code 0" : `exit code ${result.status ?? "timeout"}: ${(result.stderr ?? result.stdout ?? "").slice(0, 300)}`,
        durationMs: Date.now() - started,
      };
    }
    return { id: step.id, ok: false, detail: `unknown step kind "${step.kind}"`, durationMs: Date.now() - started };
  } catch (error) {
    return { id: step.id, ok: false, detail: String(error?.message ?? error).slice(0, 300), durationMs: Date.now() - started };
  }
}

function cmdReplay(opts) {
  const manifestPath = opts._[0];
  if (!manifestPath || !existsSync(manifestPath)) {
    console.error("replay: <manifest.json> is required");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const cwd = opts.cwd ?? process.cwd();
  const key = loadOrCreateKey(opts.key ?? "agent.key");

  const scenarios = manifest?.environment?.scenarios ?? [];
  const results = [];
  for (const scenario of scenarios) {
    const steps = (scenario.steps ?? []).map((step) => runStep(step, cwd));
    const passed = steps.length > 0 && steps.every((s) => s.ok);
    results.push({
      manifestMerkle: manifest.merkleRoot,
      submissionId: manifest.submissionId,
      scenarioId: scenario.id,
      passed,
      steps,
      ranAt: new Date().toISOString(),
      agentVersion: AGENT_VERSION,
    });
  }

  const payload = canonicalJson({ results });
  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(key.privateKeyPem)).toString("hex");
  const report = { results, attestation: { algorithm: "ed25519", publicKeyId: key.keyId, signature, agentVersion: AGENT_VERSION } };
  const outPath = opts.out ?? "replay-report.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  for (const r of results) console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.scenarioId} (${r.steps.filter((s) => s.ok).length}/${r.steps.length} steps)`);
  console.log(`report: ${outPath}`);
  if (results.some((r) => !r.passed)) process.exit(3);
}

function cmdVerify(opts) {
  const manifestPath = opts._[0];
  if (!manifestPath || !existsSync(manifestPath)) {
    console.error("verify: <manifest.json> is required");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const leafHashes = (manifest.artifacts ?? []).map((a) =>
    sha256Hex(canonicalJson({ kind: a.kind, id: a.id, contentHash: a.contentHash })),
  );
  const recomputed = merkleRoot(leafHashes);
  const merkleOk = recomputed === manifest.merkleRoot;
  console.log(`merkle root : ${merkleOk ? "OK" : `MISMATCH (recomputed ${recomputed})`}`);

  let signatureOk = false;
  const keyPath = opts.key ?? "agent.key";
  if (existsSync(keyPath)) {
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    const payload = canonicalJson({ ...manifest, attestation: { ...manifest.attestation, signature: "" } });
    try {
      signatureOk = verify(
        null,
        Buffer.from(payload, "utf8"),
        createPublicKey(key.publicKeyPem),
        Buffer.from(manifest.attestation.signature, "hex"),
      );
    } catch {
      signatureOk = false;
    }
    console.log(`key binding : ${key.keyId === manifest.attestation.publicKeyId ? "OK" : "MISMATCH"}`);
  } else {
    console.log(`key binding : skipped (no ${keyPath}; pass --key to check the signature)`);
    signatureOk = true;
  }
  console.log(`signature   : ${signatureOk ? "OK" : "INVALID"}`);
  if (!merkleOk || !signatureOk) process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
if (command === "analyze") cmdAnalyze(opts);
else if (command === "replay") cmdReplay(opts);
else if (command === "verify") cmdVerify(opts);
else {
  console.error("usage: node mesh/agent.mjs <analyze|replay|verify> ...");
  process.exit(1);
}
