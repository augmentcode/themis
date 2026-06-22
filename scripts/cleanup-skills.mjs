#!/usr/bin/env node

/**
 * Explicit cleanup script — removes AI skill files installed by themis
 * into the consuming project's .agents/skills/themis/ directory.
 *
 * Safety guarantees:
 *  - Manifest-driven: removes only files listed in installed-skills.yml, then the manifest itself
 *  - Preserves user-authored files that are not listed in the manifest
 *  - Also removes package-owned copies left in the legacy flat .agents/skills/ location
 *  - No-op with a clear message when no manifest exists
 *  - Never crashes — logs warnings and exits 0
 */

import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultPackageRoot,
  findConsumerProjectRoot,
  installedSkillsManifestFileName,
  readInstalledSkillsManifest,
  removeInstalledManifestFiles,
  removeLegacyFlatSkillCopies,
  skillInstallDirName,
} from "./postinstall.mjs";

export function cleanupSkillsFromProject({ packageRoot = defaultPackageRoot, projectRoot, logger = console } = {}) {
  const resolvedProjectRoot = projectRoot ?? findConsumerProjectRoot({ packageRoot });
  if (!resolvedProjectRoot) {
		logger.log(
			"[themis] cleanup-skills skipped: package is not installed under a consumer node_modules directory; no skill files were removed."
		);
    return { removed: 0, skipped: true, reason: "not-installed-dependency" };
  }

  const skillsSrc = resolve(packageRoot, "skills");
  const legacySkillsDest = resolve(resolvedProjectRoot, ".agents", "skills");
  const installDest = resolve(legacySkillsDest, skillInstallDirName);
  const manifestPath = resolve(installDest, installedSkillsManifestFileName);

  const manifest = readInstalledSkillsManifest(manifestPath, { logger });
  let removed = 0;
  let pruned = 0;

  if (manifest) {
    const refresh = removeInstalledManifestFiles({ installDest, files: manifest.files, logger });
    removed += refresh.removed;
    pruned += refresh.pruned;

    rmSync(manifestPath, { force: true });
    removed += 1;
  }

  if (existsSync(installDest) && readdirSync(installDest).length === 0) {
    rmdirSync(installDest);
    pruned += 1;
  }

  const legacy = removeLegacyFlatSkillCopies({ skillsSrc, legacySkillsDest });
  removed += legacy.removed;
  pruned += legacy.pruned;

  if (existsSync(legacySkillsDest) && readdirSync(legacySkillsDest).length === 0) {
    rmdirSync(legacySkillsDest);
    pruned += 1;
  }

  if (!manifest && removed === 0 && pruned === 0) {
    logger.log(
      `[themis] cleanup-skills found no ${installedSkillsManifestFileName} manifest in .agents/skills/themis/; no skill files were removed.`
    );
    return { removed: 0, skipped: true, reason: "missing-manifest" };
  }

  if (removed > 0 || pruned > 0) {
			logger.log(
				`[themis] cleanup-skills removed package-installed AI skills from .agents/skills/themis/ (${removed} files removed, ${pruned} empty dirs pruned).`
			);
	} else {
		logger.log("[themis] cleanup-skills found no package-installed skill files; no changes were made.");
  }

  return { removed, pruned, skipped: removed === 0 && pruned === 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    cleanupSkillsFromProject();
  } catch (err) {
    console.warn(`[themis] cleanup warning: ${err.message}`);
    process.exit(0);
  }
}