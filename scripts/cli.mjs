#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanupSkillsFromProject } from "./cleanup-skills.mjs";
import { installIntentSkillGuidance, supportedSkillInstallTargets } from "./postinstall.mjs";

const binaryName = "themis";

function installSkillsCommandHelp() {
	return [
		"install-skills",
		"install-skills:all",
		...supportedSkillInstallTargets.filter((target) => target !== "all").map((target) => `install-skills:${target}`),
	].join(", ");
}

function getSkillInstallTarget(command) {
	if (command === "install-skills") return "all";
	if (!command.startsWith("install-skills:")) return undefined;

	const skillInstallTarget = command.slice("install-skills:".length);
	return supportedSkillInstallTargets.includes(skillInstallTarget) ? skillInstallTarget : undefined;
}

export function helpText(name = binaryName) {
  return `Usage:
  ${name} <command> [options]

Commands:
	install-skills             Copy all packaged AI skills into .agents/skills/themis/
	install-skills:all         Alias for install-skills
	install-skills:core        Copy root setup/core AI skills into .agents/skills/themis/
	install-skills:react       Copy root setup/core/react AI skills into .agents/skills/themis/
	install-skills:svelte      Copy root setup/core/svelte AI skills into .agents/skills/themis/
	install-skills:streaming   Copy root setup/core/streaming AI skills into .agents/skills/themis/
  cleanup-skills             Remove package-installed skills from .agents/skills/themis/
  help                       Show this help text

	Installed app invocation examples:
	  ./node_modules/.bin/${name} help
	  npm exec -- ${name} cleanup-skills
	  npx ${name} install-skills
	  npx ${name} install-skills:react

	Source checkout invocation:
	  node scripts/cli.mjs help

	If npm package invocation is silent, verify the installed bin exists at
	./node_modules/.bin/${name}; source checkouts are not linked automatically.
`;
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const {
    cleanup = cleanupSkillsFromProject,
    cwd = process.cwd,
    install = installIntentSkillGuidance,
    logger = console,
    stderr = process.stderr,
    stdout = process.stdout,
  } = options;
  const [command] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return 0;
  }

	const skillInstallTarget = getSkillInstallTarget(command);
	if (skillInstallTarget) {
    try {
			const installOptions = { projectRoot: cwd(), logger };
			if (skillInstallTarget !== "all") installOptions.skillInstallTarget = skillInstallTarget;
			install(installOptions);
    } catch (error) {
			logger.warn(`[themis] ${command} warning: ${error.message}`);
    }
    return 0;
  }

	if (command.startsWith("install-skills:")) {
		stderr.write(`[themis] Unknown install-skills target: ${command.slice("install-skills:".length)}\n`);
		stdout.write(`Supported install-skills commands: ${installSkillsCommandHelp()}\n\n`);
		stdout.write(helpText());
		return 1;
	}

  if (command === "cleanup-skills") {
    try {
      cleanup({ projectRoot: cwd(), logger });
    } catch (error) {
      logger.warn(`[themis] cleanup-skills warning: ${error.message}`);
    }
    return 0;
  }

  stderr.write(`[themis] Unknown command: ${command}\n\n`);
  stdout.write(helpText());
  return 1;
}

export function isCliEntrypoint(metaUrl = import.meta.url, argvPath = process.argv[1]) {
  if (!argvPath) return false;

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return metaUrl === pathToFileURL(argvPath).href;
  }
}

if (isCliEntrypoint()) {
  try {
    process.exit(await runCli());
  } catch (error) {
    console.error(`[themis] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}