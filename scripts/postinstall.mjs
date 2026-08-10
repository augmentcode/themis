#!/usr/bin/env node

/**
 * install-skills helper — copies packaged AI skills into a target project.
 *
 * Safety guarantees:
 *  - Writes only under the consumer project root's .agents/skills/themis/ directory
 *  - Creates only a compatibility link at .claude/skills/themis; never copies skill files there
 *  - Refreshes a previous install first using the installed-skills.yml manifest
 *  - Preserves user-authored files that are not listed in the manifest
 *  - Removes package-owned copies left in the legacy flat .agents/skills/ location
 *  - Excludes generated skills/_artifacts content
 *  - No-op when run outside node_modules (e.g. during the package's own npm install)
 *  - Never crashes — logs warnings and exits 0
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultPackageRoot = resolve(__dirname, "..");
export const skillInstallDirName = "themis";
export const claudeSkillsDirName = ".claude";
export const installedSkillsManifestFileName = "installed-skills.yml";
export const legacyPackageSkillNames = [
  "svelte-redux-toolkit",
  "init-svelte-redux-toolkit",
  "migrate-to-svelte-redux-toolkit",
];

export const skillInstallBundles = {
	all: undefined,
	core: ["SKILL.md", "setup", "core"],
	react: ["SKILL.md", "setup", "core", "react"],
	streaming: ["SKILL.md", "setup", "core", "streaming"],
	svelte: ["SKILL.md", "setup", "core", "svelte"],
};

export const supportedSkillInstallTargets = Object.keys(skillInstallBundles);

export function normalizeSkillInstallTarget(skillInstallTarget = "all") {
	if (supportedSkillInstallTargets.includes(skillInstallTarget)) return skillInstallTarget;
	throw new Error(`Unsupported install-skills target: ${skillInstallTarget}`);
}

export function getPackageOwnedSkillNames(skillNames, { includeLegacy = true } = {}) {
	return [...new Set(includeLegacy ? [...skillNames, ...legacyPackageSkillNames] : skillNames)];
}

export function isSameOrChild(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function hasNodeModulesSegment(path) {
  return resolve(path).split(sep).includes("node_modules");
}

function nearestNodeModulesOwner(path) {
  const segments = resolve(path).split(sep);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  return nodeModulesIndex > 0 ? segments.slice(0, nodeModulesIndex).join(sep) : undefined;
}

export function findConsumerProjectRoot({ packageRoot = defaultPackageRoot, env = process.env } = {}) {
  const resolvedPackageRoot = resolve(packageRoot);
  const initCwd = env.INIT_CWD ? resolve(env.INIT_CWD) : undefined;

  if (initCwd && isSameOrChild(initCwd, resolvedPackageRoot) && hasNodeModulesSegment(relative(initCwd, resolvedPackageRoot))) {
    return initCwd;
  }

  return nearestNodeModulesOwner(resolvedPackageRoot);
}

export function isGeneratedSkillArtifact(path, skillsRoot) {
  const relativePath = relative(skillsRoot, path);
  return relativePath === "_artifacts" || relativePath.startsWith(`_artifacts${sep}`);
}

function safeResolveChild(parent, ...segments) {
  const resolvedParent = resolve(parent);
  const child = resolve(resolvedParent, ...segments);
  if (!isSameOrChild(resolvedParent, child)) {
    throw new Error(`Refusing to write outside ${resolvedParent}`);
  }
  return child;
}

export function getPackagedSkillInventory(skillsRoot) {
  const files = new Map();
  const skillNames = [];

  function collect(currentPath) {
    if (isGeneratedSkillArtifact(currentPath, skillsRoot)) return;

    const stat = lstatSync(currentPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const entry of readdirSync(currentPath)) {
        collect(resolve(currentPath, entry));
      }
      return;
    }

    if (stat.isFile()) {
      files.set(relative(skillsRoot, currentPath), currentPath);
    }
  }

  for (const entry of readdirSync(skillsRoot)) {
    const entryPath = resolve(skillsRoot, entry);
    if (isGeneratedSkillArtifact(entryPath, skillsRoot)) continue;
    skillNames.push(entry);
    collect(entryPath);
  }

  return { files, skillNames };
}

function readPackageMetadata(packageRoot) {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    return {
      name: typeof packageJson.name === "string" ? packageJson.name : "themis",
      version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
    };
  } catch {
    return { name: "themis", version: "0.0.0" };
  }
}

function toPosixPath(relativePath) {
  return relativePath.split(sep).join("/");
}

function parseYamlScalar(value) {
  if (value.startsWith('"')) return JSON.parse(value);
  return value;
}

export function serializeInstalledSkillsManifest(manifest) {
  const lines = [
    `package: ${JSON.stringify(manifest.package)}`,
    `version: ${JSON.stringify(manifest.version)}`,
    `target: ${JSON.stringify(manifest.target)}`,
    `installedAt: ${JSON.stringify(manifest.installedAt)}`,
    "files:",
    ...manifest.files.map((relativePath) => `  - ${JSON.stringify(relativePath)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseInstalledSkillsManifest(text) {
  const manifest = { files: [] };
  let inFiles = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.trimStart().startsWith("#")) continue;

    const listItem = /^\s+-\s*(.+)$/.exec(line);
    if (inFiles && listItem) {
      const entry = parseYamlScalar(listItem[1]);
      if (typeof entry !== "string" || entry === "") throw new Error(`Invalid manifest file entry: ${line}`);
      manifest.files.push(entry);
      continue;
    }

    const keyValue = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!keyValue) throw new Error(`Invalid manifest line: ${line}`);

    const [, key, value] = keyValue;
    inFiles = key === "files" && value === "";
    if (value !== "") manifest[key] = parseYamlScalar(value);
  }

  if (!Array.isArray(manifest.files) || manifest.files.some((entry) => typeof entry !== "string")) {
    throw new Error("Manifest files list is invalid");
  }
  return manifest;
}

export function readInstalledSkillsManifest(manifestPath, { logger = console } = {}) {
  if (!existsSync(manifestPath)) return undefined;

  try {
    return parseInstalledSkillsManifest(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    logger.warn(
      `[themis] ignoring unreadable ${installedSkillsManifestFileName} manifest (${err.message}); previously installed files will not be refreshed.`
    );
    return undefined;
  }
}

function resolveFilesystemPath(path) {
  try {
    return resolve(realpathSync(path));
  } catch {
    return resolve(path);
  }
}

function pathsAreEqual(left, right) {
  const normalizedLeft = resolveFilesystemPath(left);
  const normalizedRight = resolveFilesystemPath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function linkTargetResolvesTo(linkPath, expectedTarget) {
  let linkTarget;
  try {
    linkTarget = resolve(dirname(linkPath), readlinkSync(linkPath, "utf8"));
  } catch {
    return false;
  }
  return pathsAreEqual(linkTarget, expectedTarget);
}

function removeEmptyDirectories(paths) {
  let pruned = 0;
  for (const directory of [...paths].sort((left, right) => right.length - left.length)) {
    try {
      if (lstatSync(directory).isDirectory() && readdirSync(directory).length === 0) {
        rmdirSync(directory);
        pruned += 1;
      }
    } catch {
      continue;
    }
  }
  return pruned;
}

export function ensureClaudeSkillCompatibilityLink({ projectRoot, canonicalInstall, logger = console } = {}) {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedCanonicalInstall = resolve(canonicalInstall);
  const claudeRoot = resolve(resolvedProjectRoot, claudeSkillsDirName);
  const claudeSkillsRoot = resolve(claudeRoot, "skills");
  const compatibilityPath = resolve(claudeSkillsRoot, skillInstallDirName);
  const createdDirectories = [];

  for (const directory of [claudeRoot, claudeSkillsRoot]) {
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        logger.warn(`[themis] Claude skill compatibility link skipped: ${directory} is an existing non-owned path.`);
        removeEmptyDirectories(createdDirectories);
        return { status: "collision", path: compatibilityPath, target: resolvedCanonicalInstall };
      }
    } catch {
      try {
        mkdirSync(directory);
        createdDirectories.push(directory);
      } catch (err) {
        logger.warn(`[themis] Claude skill compatibility link could not create ${directory}: ${err.message}`);
        removeEmptyDirectories(createdDirectories);
        return { status: "error", path: compatibilityPath, target: resolvedCanonicalInstall };
      }
    }
  }

  try {
    lstatSync(compatibilityPath);
    if (linkTargetResolvesTo(compatibilityPath, resolvedCanonicalInstall)) {
      logger.log("[themis] Claude skill compatibility link reused: .claude/skills/themis -> .agents/skills/themis.");
      return { status: "reused", path: compatibilityPath, target: resolvedCanonicalInstall };
    }

    logger.warn(
      `[themis] Claude skill compatibility link skipped: .claude/skills/themis is an existing non-owned path; it was preserved.`
    );
    return { status: "collision", path: compatibilityPath, target: resolvedCanonicalInstall };
  } catch {
    try {
      const linkTarget = process.platform === "win32"
        ? resolvedCanonicalInstall
        : toPosixPath(relative(claudeSkillsRoot, resolvedCanonicalInstall));
      symlinkSync(linkTarget, compatibilityPath, process.platform === "win32" ? "junction" : "dir");
      logger.log("[themis] Claude skill compatibility link created: .claude/skills/themis -> .agents/skills/themis.");
      return { status: "created", path: compatibilityPath, target: resolvedCanonicalInstall };
    } catch (err) {
      logger.warn(`[themis] Claude skill compatibility link could not be created: ${err.message}`);
      removeEmptyDirectories(createdDirectories);
      return { status: "error", path: compatibilityPath, target: resolvedCanonicalInstall };
    }
  }
}

export function removeClaudeSkillCompatibilityLink({ projectRoot, canonicalInstall, logger = console } = {}) {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedCanonicalInstall = resolve(canonicalInstall);
  const claudeRoot = resolve(resolvedProjectRoot, claudeSkillsDirName);
  const claudeSkillsRoot = resolve(claudeRoot, "skills");
  const compatibilityPath = resolve(claudeSkillsRoot, skillInstallDirName);

  for (const parent of [claudeRoot, claudeSkillsRoot]) {
    try {
      const stat = lstatSync(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        logger.warn(`[themis] cleanup-skills preserved foreign Claude compatibility parent: ${parent}.`);
        return { status: "foreign", path: compatibilityPath, removed: 0, pruned: 0 };
      }
    } catch {
      continue;
    }
  }

  try {
    const stat = lstatSync(compatibilityPath);
    if (!stat.isSymbolicLink()) {
      return { status: "collision", path: compatibilityPath, removed: 0, pruned: 0 };
    }
    if (!linkTargetResolvesTo(compatibilityPath, resolvedCanonicalInstall)) {
      logger.warn("[themis] cleanup-skills preserved foreign .claude/skills/themis link.");
      return { status: "foreign", path: compatibilityPath, removed: 0, pruned: 0 };
    }

    rmSync(compatibilityPath, { force: true });
    const pruned = removeEmptyDirectories([claudeSkillsRoot, claudeRoot]);
    logger.log(`[themis] cleanup-skills removed the owned Claude skill compatibility link (${pruned} empty dirs pruned).`);
    return { status: "removed", path: compatibilityPath, removed: 1, pruned };
  } catch {
    return { status: "absent", path: compatibilityPath, removed: 0, pruned: 0 };
  }
}

export function removeInstalledManifestFiles({ installDest, files = [], logger = console } = {}) {
  const resolvedInstallDest = resolve(installDest);
  let removed = 0;
  const candidateDirs = new Set();

  for (const relativePath of files) {
    let target;
    try {
      target = safeResolveChild(resolvedInstallDest, ...relativePath.split("/"));
    } catch {
      logger.warn(`[themis] skipping unsafe manifest entry: ${relativePath}`);
      continue;
    }
    if (target === resolvedInstallDest) continue;

    if (existsSync(target) && lstatSync(target).isFile()) {
      rmSync(target, { force: true });
      removed += 1;
    }

    for (let dir = dirname(target); dir !== resolvedInstallDest && isSameOrChild(resolvedInstallDest, dir); dir = dirname(dir)) {
      candidateDirs.add(dir);
    }
  }

  let pruned = 0;
  for (const dir of [...candidateDirs].sort((left, right) => right.length - left.length)) {
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmdirSync(dir);
      pruned += 1;
    }
  }

  return { removed, pruned };
}

export function removeLegacyFlatSkillCopies({ skillsSrc, legacySkillsDest } = {}) {
  if (!existsSync(skillsSrc) || !existsSync(legacySkillsDest)) return { removed: 0, pruned: 0 };

  const inventory = getPackagedSkillInventory(skillsSrc);
  const legacySkillNames = getPackageOwnedSkillNames(inventory.skillNames).filter(
    (skillName) => skillName !== skillInstallDirName
  );

  return removePackageOwnedSkillCopies({
    skillsDest: legacySkillsDest,
    packagedFiles: inventory.files,
    skillNames: legacySkillNames,
    removeCurrent: true,
  });
}

function isSelectedSkillPath(relativePath, skillNames) {
	return skillNames.some((skillName) => relativePath === skillName || relativePath.startsWith(`${skillName}${sep}`));
}

export function selectPackagedSkillInventory(inventory, skillInstallTarget = "all") {
	const resolvedSkillInstallTarget = normalizeSkillInstallTarget(skillInstallTarget);
	const selectedSkillNames = skillInstallBundles[resolvedSkillInstallTarget];
	if (!selectedSkillNames) return inventory;

	return {
		files: new Map([...inventory.files].filter(([relativePath]) => isSelectedSkillPath(relativePath, selectedSkillNames))),
		skillNames: inventory.skillNames.filter((skillName) => selectedSkillNames.includes(skillName)),
	};
}

function filesAreEqual(left, right) {
  if (!existsSync(right)) return false;
  const rightStat = lstatSync(right);
  if (!rightStat.isFile()) return false;
  return readFileSync(left).equals(readFileSync(right));
}

export function removePackageOwnedSkillCopies({ skillsDest, packagedFiles, skillNames, removeCurrent = false } = {}) {
  if (!existsSync(skillsDest)) return { removed: 0, pruned: 0 };

  let removed = 0;
  let pruned = 0;

  function clean(currentPath) {
    const relativePath = relative(skillsDest, currentPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) return;

    const stat = lstatSync(currentPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const entry of readdirSync(currentPath)) {
        clean(resolve(currentPath, entry));
      }

      if (readdirSync(currentPath).length === 0) {
        rmdirSync(currentPath);
        pruned += 1;
      }
      return;
    }

    if (removeCurrent || !packagedFiles.has(relativePath)) {
      rmSync(currentPath, { force: true });
      removed += 1;
    }
  }

  for (const skillName of skillNames) {
    const skillDest = safeResolveChild(skillsDest, skillName);
    if (existsSync(skillDest)) clean(skillDest);
  }

  return { removed, pruned };
}

export function copyPackagedSkillsToProject({
	packageRoot = defaultPackageRoot,
	projectRoot,
	logger = console,
	skillInstallTarget = "all",
} = {}) {
	const resolvedSkillInstallTarget = normalizeSkillInstallTarget(skillInstallTarget);
  const resolvedProjectRoot = projectRoot ?? findConsumerProjectRoot({ packageRoot });
  if (!resolvedProjectRoot) {
    logger.log(
      "[themis] install-skills skipped: package is not installed under a consumer node_modules directory; no skill files were copied."
    );
    return { installed: false, skipped: true, reason: "not-installed-dependency" };
  }

  const skillsSrc = resolve(packageRoot, "skills");
  if (!existsSync(skillsSrc)) {
    logger.log("[themis] install-skills skipped: packaged skills were not found; no skill files were copied.");
    return { installed: false, skipped: true, reason: "missing-skills", projectRoot: resolvedProjectRoot };
  }

  const legacySkillsDest = safeResolveChild(resolvedProjectRoot, ".agents", "skills");
  const installDest = safeResolveChild(legacySkillsDest, skillInstallDirName);
  const manifestPath = safeResolveChild(installDest, installedSkillsManifestFileName);
	const inventory = selectPackagedSkillInventory(getPackagedSkillInventory(skillsSrc), resolvedSkillInstallTarget);
  mkdirSync(installDest, { recursive: true });

  const nextFiles = new Set([...inventory.files.keys()].map(toPosixPath));
  const previousManifest = readInstalledSkillsManifest(manifestPath, { logger });
  const staleFiles = (previousManifest?.files ?? []).filter((relativePath) => !nextFiles.has(relativePath));
  const refresh = removeInstalledManifestFiles({ installDest, files: staleFiles, logger });
  const legacy = removeLegacyFlatSkillCopies({ skillsSrc, legacySkillsDest });

  let copied = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [relativePath, sourcePath] of inventory.files) {
    const destPath = safeResolveChild(installDest, relativePath);
    mkdirSync(dirname(destPath), { recursive: true });

    if (filesAreEqual(sourcePath, destPath)) {
      unchanged += 1;
      continue;
    }

    const existed = existsSync(destPath);
    if (existed) rmSync(destPath, { recursive: true, force: true });
    copyFileSync(sourcePath, destPath);
    if (existed) updated += 1;
    else copied += 1;
  }

  const packageMetadata = readPackageMetadata(packageRoot);
  const manifest = {
    package: packageMetadata.name,
    version: packageMetadata.version,
    target: resolvedSkillInstallTarget,
    installedAt: new Date().toISOString(),
    files: [...inventory.files.keys()].map(toPosixPath).sort(),
  };
  writeFileSync(manifestPath, serializeInstalledSkillsManifest(manifest));

  const compatibilityLink = ensureClaudeSkillCompatibilityLink({
    projectRoot: resolvedProjectRoot,
    canonicalInstall: installDest,
    logger,
  });

  const removed = refresh.removed + legacy.removed;
  const pruned = refresh.pruned + legacy.pruned;
	const commandLabel = resolvedSkillInstallTarget === "all" ? "install-skills" : `install-skills:${resolvedSkillInstallTarget}`;
	logger.log(
		`[themis] ${commandLabel} copied packaged skills to .agents/skills/themis/ (${copied} copied, ${updated} updated, ${unchanged} unchanged, ${removed} stale removed, ${pruned} empty dirs pruned; Claude link ${compatibilityLink.status}).`
	);

  return {
    installed: copied > 0 || updated > 0 || compatibilityLink.status === "created",
    skipped: copied === 0 && updated === 0 && removed === 0 && pruned === 0 && compatibilityLink.status !== "created",
    projectRoot: resolvedProjectRoot,
    destination: installDest,
    manifestPath,
    copied,
    updated,
    unchanged,
    removed,
    pruned,
		compatibilityLink,
		skillInstallTarget: resolvedSkillInstallTarget,
  };
}

export function installIntentSkillGuidance({
  packageRoot = defaultPackageRoot,
  projectRoot,
  env = process.env,
  logger = console,
	skillInstallTarget = "all",
} = {}) {
  const resolvedProjectRoot = projectRoot ?? findConsumerProjectRoot({ packageRoot, env });
	return copyPackagedSkillsToProject({ packageRoot, projectRoot: resolvedProjectRoot, logger, skillInstallTarget });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    installIntentSkillGuidance();
  } catch (err) {
    console.warn(`[themis] install-skills warning: ${err.message}`);
    process.exit(0);
  }
}

