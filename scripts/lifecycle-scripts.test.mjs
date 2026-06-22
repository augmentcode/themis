import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpText, runCli } from "./cli.mjs";
import { cleanupSkillsFromProject } from "./cleanup-skills.mjs";
import { findConsumerProjectRoot, installIntentSkillGuidance, parseInstalledSkillsManifest } from "./postinstall.mjs";

const tempRoots = [];

async function writeFixtureFile(path, content = path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function createInstalledPackage() {
  const root = await mkdtemp(join(tmpdir(), "srt-lifecycle-"));
  tempRoots.push(root);

  const projectRoot = join(root, "consumer");
  const packageRoot = join(projectRoot, "node_modules", "themis");

  await Promise.all([
    writeFixtureFile(join(packageRoot, "package.json"), JSON.stringify({ name: "themis", version: "9.9.9" })),
    writeFixtureFile(join(packageRoot, "skills", "SKILL.md"), "root router"),
		writeFixtureFile(join(packageRoot, "skills", "setup", "SKILL.md"), "setup skill"),
		writeFixtureFile(join(packageRoot, "skills", "react", "SKILL.md"), "react skill"),
		writeFixtureFile(join(packageRoot, "skills", "streaming", "SKILL.md"), "streaming skill"),
		writeFixtureFile(join(packageRoot, "skills", "svelte", "SKILL.md"), "svelte skill"),
    writeFixtureFile(join(packageRoot, "skills", "core", "actions", "SKILL.md"), "actions skill"),
    writeFixtureFile(join(packageRoot, "skills", "svelte/migration", "setup", "SKILL.md"), "setup skill"),
    writeFixtureFile(join(packageRoot, "skills", "_artifacts", "skill_tree.yaml"), "generated"),
  ]);

  return { packageRoot, projectRoot };
}

function installDir(projectRoot, ...segments) {
  return join(projectRoot, ".agents", "skills", "themis", ...segments);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lifecycle skill helpers", () => {
  it("detects the consuming project root from npm lifecycle INIT_CWD", async () => {
    const { packageRoot, projectRoot } = await createInstalledPackage();

    expect(findConsumerProjectRoot({ packageRoot, env: { INIT_CWD: projectRoot } })).toBe(projectRoot);
    expect(findConsumerProjectRoot({ packageRoot: join(projectRoot, "packages", "themis"), env: { INIT_CWD: projectRoot } })).toBeUndefined();
  });

  it("falls back to the node_modules owner when INIT_CWD is unavailable", async () => {
    const { packageRoot, projectRoot } = await createInstalledPackage();

    expect(findConsumerProjectRoot({ packageRoot, env: {} })).toBe(projectRoot);
  });

	it("copies packaged skills into .agents/skills/themis and writes a manifest", async () => {
    const { packageRoot, projectRoot } = await createInstalledPackage();
    const logger = { log: vi.fn(), warn: vi.fn() };

    const result = installIntentSkillGuidance({
      packageRoot,
      env: { INIT_CWD: projectRoot },
      logger,
    });

		expect(result).toEqual(expect.objectContaining({ installed: true, skipped: false, projectRoot, copied: 7, updated: 0, removed: 0 }));
	  expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("install-skills copied packaged skills to .agents/skills/themis/"));
	  await expect(readFile(installDir(projectRoot, "SKILL.md"), "utf8")).resolves.toBe("root router");
		await expect(readFile(installDir(projectRoot, "setup", "SKILL.md"), "utf8")).resolves.toBe("setup skill");
		await expect(readFile(installDir(projectRoot, "react", "SKILL.md"), "utf8")).resolves.toBe("react skill");
		await expect(readFile(installDir(projectRoot, "streaming", "SKILL.md"), "utf8")).resolves.toBe("streaming skill");
		await expect(readFile(installDir(projectRoot, "svelte", "SKILL.md"), "utf8")).resolves.toBe("svelte skill");
	  await expect(readFile(installDir(projectRoot, "core", "actions", "SKILL.md"), "utf8")).resolves.toBe("actions skill");
	  await expect(readFile(installDir(projectRoot, "svelte/migration", "setup", "SKILL.md"), "utf8")).resolves.toBe("setup skill");
	  expect(existsSync(installDir(projectRoot, "_artifacts", "skill_tree.yaml"))).toBe(false);

	  const manifest = parseInstalledSkillsManifest(await readFile(installDir(projectRoot, "installed-skills.yml"), "utf8"));
	  expect(manifest).toEqual({
	    package: "themis",
	    version: "9.9.9",
	    target: "all",
	    installedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
	    files: [
	      "SKILL.md",
	      "core/actions/SKILL.md",
	      "react/SKILL.md",
	      "setup/SKILL.md",
	      "streaming/SKILL.md",
	      "svelte/SKILL.md",
	      "svelte/migration/setup/SKILL.md",
	    ],
	  });
  });

	it("copies only the requested domain bundle and removes legacy flat package copies", async () => {
		const { packageRoot, projectRoot } = await createInstalledPackage();
		const logger = { log: vi.fn(), warn: vi.fn() };

		await Promise.all([
			writeFixtureFile(join(projectRoot, ".agents", "skills", "react", "old-topic", "SKILL.md"), "stale react"),
			writeFixtureFile(join(projectRoot, ".agents", "skills", "svelte-redux-toolkit", "SKILL.md"), "legacy svelte"),
			writeFixtureFile(join(projectRoot, ".agents", "skills", "svelte", "old-topic", "SKILL.md"), "legacy flat svelte"),
			writeFixtureFile(join(projectRoot, ".agents", "skills", "third-party", "SKILL.md"), "consumer skill"),
		]);

		const result = installIntentSkillGuidance({
			packageRoot,
			env: { INIT_CWD: projectRoot },
			logger,
			skillInstallTarget: "react",
		});

		expect(result).toEqual(expect.objectContaining({ copied: 4, removed: 3, skillInstallTarget: "react" }));
		await expect(readFile(installDir(projectRoot, "SKILL.md"), "utf8")).resolves.toBe("root router");
		await expect(readFile(installDir(projectRoot, "setup", "SKILL.md"), "utf8")).resolves.toBe("setup skill");
		await expect(readFile(installDir(projectRoot, "core", "actions", "SKILL.md"), "utf8")).resolves.toBe("actions skill");
		await expect(readFile(installDir(projectRoot, "react", "SKILL.md"), "utf8")).resolves.toBe("react skill");
		expect(existsSync(installDir(projectRoot, "streaming", "SKILL.md"))).toBe(false);
		expect(existsSync(installDir(projectRoot, "svelte", "SKILL.md"))).toBe(false);
		expect(existsSync(join(projectRoot, ".agents", "skills", "react", "old-topic", "SKILL.md"))).toBe(false);
		expect(existsSync(join(projectRoot, ".agents", "skills", "svelte-redux-toolkit", "SKILL.md"))).toBe(false);
		expect(existsSync(join(projectRoot, ".agents", "skills", "svelte", "old-topic", "SKILL.md"))).toBe(false);
		await expect(readFile(join(projectRoot, ".agents", "skills", "third-party", "SKILL.md"), "utf8")).resolves.toBe("consumer skill");
		const manifest = parseInstalledSkillsManifest(await readFile(installDir(projectRoot, "installed-skills.yml"), "utf8"));
		expect(manifest).toEqual(expect.objectContaining({ target: "react", files: ["SKILL.md", "core/actions/SKILL.md", "react/SKILL.md", "setup/SKILL.md"] }));
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("install-skills:react copied packaged skills"));
	});

	it("copies Svelte, streaming, and core bundles without unrelated domains", async () => {
		const cases = [
			{ target: "svelte", included: ["svelte"], excluded: ["react", "streaming"] },
			{ target: "streaming", included: ["streaming"], excluded: ["react", "svelte"] },
			{ target: "core", included: [], excluded: ["react", "svelte", "streaming"] },
		];

		for (const { target, included, excluded } of cases) {
			const { packageRoot, projectRoot } = await createInstalledPackage();
			const logger = { log: vi.fn(), warn: vi.fn() };

			installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger, skillInstallTarget: target });

			await expect(readFile(installDir(projectRoot, "SKILL.md"), "utf8")).resolves.toBe("root router");
			await expect(readFile(installDir(projectRoot, "setup", "SKILL.md"), "utf8")).resolves.toBe("setup skill");
			await expect(readFile(installDir(projectRoot, "core", "actions", "SKILL.md"), "utf8")).resolves.toBe("actions skill");
			for (const skillName of included) {
				await expect(readFile(installDir(projectRoot, skillName, "SKILL.md"), "utf8")).resolves.toBe(`${skillName} skill`);
			}
			for (const skillName of excluded) {
				expect(existsSync(installDir(projectRoot, skillName, "SKILL.md"))).toBe(false);
			}
		}
	});

	it("refreshes a previous install per the manifest and preserves user files without manifest entries", async () => {
	  const { packageRoot, projectRoot } = await createInstalledPackage();
	  const logger = { log: vi.fn(), warn: vi.fn() };

	  installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });
	  await writeFixtureFile(installDir(projectRoot, "svelte", "user-note.md"), "user note");

	  const result = installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger, skillInstallTarget: "react" });

		expect(result).toEqual(expect.objectContaining({ copied: 0, unchanged: 4, removed: 3, skillInstallTarget: "react" }));
	  expect(existsSync(installDir(projectRoot, "streaming", "SKILL.md"))).toBe(false);
	  expect(existsSync(installDir(projectRoot, "svelte", "SKILL.md"))).toBe(false);
	  expect(existsSync(installDir(projectRoot, "svelte", "migration"))).toBe(false);
	  await expect(readFile(installDir(projectRoot, "svelte", "user-note.md"), "utf8")).resolves.toBe("user note");
	  await expect(readFile(installDir(projectRoot, "react", "SKILL.md"), "utf8")).resolves.toBe("react skill");
		const manifest = parseInstalledSkillsManifest(await readFile(installDir(projectRoot, "installed-skills.yml"), "utf8"));
		expect(manifest).toEqual(expect.objectContaining({ target: "react", files: ["SKILL.md", "core/actions/SKILL.md", "react/SKILL.md", "setup/SKILL.md"] }));
	  expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("3 stale removed"));
	});

	it("treats a malformed manifest as absent with a warning and still installs", async () => {
	  const { packageRoot, projectRoot } = await createInstalledPackage();
	  const logger = { log: vi.fn(), warn: vi.fn() };

	  await writeFixtureFile(installDir(projectRoot, "installed-skills.yml"), "{not yaml: [");

	  const result = installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });

		expect(result).toEqual(expect.objectContaining({ installed: true, copied: 7, removed: 0 }));
	  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ignoring unreadable installed-skills.yml manifest"));
		const manifest = parseInstalledSkillsManifest(await readFile(installDir(projectRoot, "installed-skills.yml"), "utf8"));
		expect(manifest.files).toHaveLength(7);
	});

	it("prints visible no-op output when copied package-owned skills are current", async () => {
	  const { packageRoot, projectRoot } = await createInstalledPackage();
	  const logger = { log: vi.fn(), warn: vi.fn() };

	  installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });
	  const result = installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });

		expect(result).toEqual(expect.objectContaining({ installed: false, skipped: true, copied: 0, updated: 0, removed: 0, unchanged: 7 }));
		expect(logger.log).toHaveBeenLastCalledWith(expect.stringContaining("0 copied, 0 updated, 7 unchanged"));
	});

	it("prints visible skipped output when install guidance has no consumer project", () => {
		const logger = { log: vi.fn(), warn: vi.fn() };

		const result = installIntentSkillGuidance({ packageRoot: "/tmp/source-checkout", env: {}, logger });

		expect(result).toEqual({ installed: false, skipped: true, reason: "not-installed-dependency" });
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("install-skills skipped"));
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("no skill files were copied"));
	});

	it("prints visible skipped output when packaged skills are missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "srt-missing-skills-"));
		tempRoots.push(root);
		const logger = { log: vi.fn(), warn: vi.fn() };

		const result = installIntentSkillGuidance({ packageRoot: join(root, "pkg"), projectRoot: join(root, "consumer"), logger });

		expect(result).toEqual({ installed: false, skipped: true, reason: "missing-skills", projectRoot: join(root, "consumer") });
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("packaged skills were not found"));
	});

  it("removes exactly the manifest-listed files plus the manifest and preserves user files", async () => {
    const { packageRoot, projectRoot } = await createInstalledPackage();
    const logger = { log: vi.fn(), warn: vi.fn() };

    installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });
    await Promise.all([
      writeFixtureFile(installDir(projectRoot, "svelte", "user-note.md"), "user note"),
      writeFixtureFile(installDir(projectRoot, "my-skill", "SKILL.md"), "user skill"),
      writeFixtureFile(join(projectRoot, ".agents", "skills", "custom", "SKILL.md"), "consumer skill"),
    ]);

    const result = cleanupSkillsFromProject({ packageRoot, logger });

	  expect(result).toEqual(expect.objectContaining({ removed: 8, skipped: false }));
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("cleanup-skills removed package-installed AI skills from .agents/skills/themis/"));
	    expect(existsSync(installDir(projectRoot, "SKILL.md"))).toBe(false);
	    expect(existsSync(installDir(projectRoot, "installed-skills.yml"))).toBe(false);
	    expect(existsSync(installDir(projectRoot, "core"))).toBe(false);
	    expect(existsSync(installDir(projectRoot, "react"))).toBe(false);
    await expect(readFile(installDir(projectRoot, "svelte", "user-note.md"), "utf8")).resolves.toBe("user note");
    await expect(readFile(installDir(projectRoot, "my-skill", "SKILL.md"), "utf8")).resolves.toBe("user skill");
    await expect(readFile(join(projectRoot, ".agents", "skills", "custom", "SKILL.md"), "utf8")).resolves.toBe("consumer skill");
  });

  it("removes the whole install directory and legacy flat copies when nothing user-authored remains", async () => {
    const { packageRoot, projectRoot } = await createInstalledPackage();
    const logger = { log: vi.fn(), warn: vi.fn() };

    installIntentSkillGuidance({ packageRoot, env: { INIT_CWD: projectRoot }, logger });
    await Promise.all([
      writeFixtureFile(join(projectRoot, ".agents", "skills", "SKILL.md"), "legacy root router"),
      writeFixtureFile(join(projectRoot, ".agents", "skills", "svelte-redux-toolkit", "SKILL.md"), "legacy root skill"),
      writeFixtureFile(join(projectRoot, ".agents", "skills", "_artifacts", "skill_tree.yaml"), "consumer generated"),
    ]);

    const result = cleanupSkillsFromProject({ packageRoot, logger });

	  expect(result).toEqual(expect.objectContaining({ removed: 10, skipped: false }));
	    expect(existsSync(installDir(projectRoot))).toBe(false);
	    expect(existsSync(join(projectRoot, ".agents", "skills", "SKILL.md"))).toBe(false);
	    expect(existsSync(join(projectRoot, ".agents", "skills", "svelte-redux-toolkit"))).toBe(false);
    await expect(readFile(join(projectRoot, ".agents", "skills", "_artifacts", "skill_tree.yaml"), "utf8")).resolves.toBe("consumer generated");
  });

	it("prints visible no-op output when cleanup finds no manifest", async () => {
		const { packageRoot, projectRoot } = await createInstalledPackage();
		const logger = { log: vi.fn(), warn: vi.fn() };

		const result = cleanupSkillsFromProject({ packageRoot, logger });

		expect(result).toEqual({ removed: 0, skipped: true, reason: "missing-manifest" });
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("cleanup-skills found no installed-skills.yml manifest"));
		expect(projectRoot).toBeDefined();
	});
});

describe("consumer CLI", () => {
  it("prints help for no arguments and help commands", async () => {
    const stdout = { write: vi.fn() };

    await expect(runCli([], { stdout })).resolves.toBe(0);
    await expect(runCli(["help"], { stdout })).resolves.toBe(0);

    expect(stdout.write).toHaveBeenCalledWith(helpText());
    expect(stdout.write).toHaveBeenCalledTimes(2);
		expect(helpText()).toContain("install-skills:react");
		expect(helpText()).toContain("install-skills:svelte");
		expect(helpText()).toContain("install-skills:streaming");
		expect(helpText()).not.toContain("validate-architecture");
  });

  it("fails unknown commands without routing to safe commands", async () => {
    const install = vi.fn();
    const cleanup = vi.fn();
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    await expect(runCli(["wat"], { cleanup, install, stderr, stdout })).resolves.toBe(1);

    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("Unknown command: wat"));
    expect(stdout.write).toHaveBeenCalledWith(helpText());
    expect(install).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

	it("fails unknown install-skills targets with supported choices", async () => {
		const install = vi.fn();
		const stdout = { write: vi.fn() };
		const stderr = { write: vi.fn() };

		await expect(runCli(["install-skills:vue"], { install, stderr, stdout })).resolves.toBe(1);

		expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("Unknown install-skills target: vue"));
		expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("install-skills:react"));
		expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("install-skills:svelte"));
		expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("install-skills:streaming"));
		expect(install).not.toHaveBeenCalled();
	});

  it("routes skill maintenance commands to the current working project", async () => {
    const projectRoot = "/tmp/consumer-project";
    const logger = { log: vi.fn(), warn: vi.fn() };
    const install = vi.fn(() => ({ installed: true, skipped: false, projectRoot }));
    const cleanup = vi.fn(() => ({ removed: 0, skipped: true }));

    await expect(runCli(["install-skills"], { cwd: () => projectRoot, install, logger })).resolves.toBe(0);
		await expect(runCli(["install-skills:react"], { cwd: () => projectRoot, install, logger })).resolves.toBe(0);
		await expect(runCli(["install-skills:svelte"], { cwd: () => projectRoot, install, logger })).resolves.toBe(0);
		await expect(runCli(["install-skills:streaming"], { cwd: () => projectRoot, install, logger })).resolves.toBe(0);
		await expect(runCli(["install-skills:core"], { cwd: () => projectRoot, install, logger })).resolves.toBe(0);
    await expect(runCli(["cleanup-skills"], { cleanup, cwd: () => projectRoot, logger })).resolves.toBe(0);

	  expect(install).toHaveBeenCalledWith({ projectRoot, logger });
		expect(install).toHaveBeenCalledWith({ projectRoot, logger, skillInstallTarget: "react" });
		expect(install).toHaveBeenCalledWith({ projectRoot, logger, skillInstallTarget: "svelte" });
		expect(install).toHaveBeenCalledWith({ projectRoot, logger, skillInstallTarget: "streaming" });
		expect(install).toHaveBeenCalledWith({ projectRoot, logger, skillInstallTarget: "core" });
    expect(cleanup).toHaveBeenCalledWith({ projectRoot, logger });
  });

  it("rejects the removed validate-architecture command", async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    await expect(runCli(["validate-architecture"], { stderr, stdout })).resolves.toBe(1);

    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("Unknown command: validate-architecture"));
    expect(stdout.write).toHaveBeenCalledWith(helpText());
  });

	it("documents installed-bin fallback and source-checkout invocation guidance", async () => {
		const [readme, installation] = await Promise.all([
			readFile(new URL("../README.md", import.meta.url), "utf8"),
			readFile(new URL("../docs/INSTALLATION.md", import.meta.url), "utf8"),
		]);

		for (const doc of [readme, installation, helpText()]) {
			expect(doc).toContain("./node_modules/.bin/themis help");
			expect(doc).toContain("node scripts/cli.mjs help");
			expect(doc).toContain("source checkout");
		}
	});

  it("prints help when launched through a package-manager symlink path", async () => {
    const root = await mkdtemp(join(tmpdir(), "srt-bin-"));
    tempRoots.push(root);
    const binPath = join(root, "themis");

    await symlink(fileURLToPath(new URL("./cli.mjs", import.meta.url)), binPath);
    const result = spawnSync(process.execPath, [binPath, "help"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("./node_modules/.bin/themis help");
  });
});