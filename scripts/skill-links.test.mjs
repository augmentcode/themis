import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../", import.meta.url);
const skillsRoot = new URL("../skills/", import.meta.url);
const docsRoot = new URL("../docs/", import.meta.url);
const packagePrefix = "@augmentcode/themis/";
const packageDocsPrefix = `${packagePrefix}docs/`;

async function collectSkillFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory.pathname, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(new URL(`file://${path}/`))));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(new URL(`file://${path}`));
    }
  }

  return files;
}

function findDocumentationReferences(content) {
  const withoutExternalUrls = content.replace(/https?:\/\/\S+/g, "");
  const references = [];
  const pattern = /(?:@augmentcode\/themis\/)?docs\/[A-Za-z0-9_-]+\.md(?:#[A-Za-z0-9_-]+)?|(?:@augmentcode\/themis\/)?README\.md|augmentcode\/themis:docs\/[A-Za-z0-9_-]+\.md(?:#[A-Za-z0-9_-]+)?/g;

  for (const match of withoutExternalUrls.matchAll(pattern)) {
    references.push(match[0]);
  }

  return references;
}

function documentationTarget(reference) {
  return reference.replace(`${packageDocsPrefix}`, "").split("#", 1)[0];
}

function findSiblingSkillReferences(content) {
  return [...content.matchAll(/(?:\.\.?\/)+[A-Za-z0-9_./*-]+SKILL\.md/g)].map((match) => match[0]);
}

function findUnquotedPackageSourceReferences(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const references = [];
  let inSources = false;

  for (const line of frontmatter.split(/\r?\n/)) {
    if (line === "sources:") {
      inSources = true;
      continue;
    }
    if (inSources && !line.trim().startsWith("-")) {
      if (line.trim() && !/^\s/.test(line)) break;
      continue;
    }
    if (!inSources) continue;

    const value = line.match(/^\s+-\s+(.+?)\s*$/)?.[1];
    if (value?.startsWith(packagePrefix) && !/^["']/.test(value)) {
      references.push(value);
    }
  }

  return references;
}

function normalizedSkillDescription(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const field = frontmatter.match(/^description:[ \t]*([^\r\n]*)((?:\r?\n(?:[ \t]+[^\r\n]*|[ \t]*))*)/m);
  if (!field) return "";

  const inline = field[1].trim();
  const text = /^[>|][+-]?$/.test(inline) ? field[2] : `${inline}${field[2]}`;
  return text.trim().replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/\s+/g, " ").trim();
}

function skillDescriptionIssue(content) {
  const description = normalizedSkillDescription(content);
  if (!description) return "description is missing or empty";
  if (description.length > 250) return `description has ${description.length} characters (maximum 250)`;
  return undefined;
}

describe("skill descriptions", () => {
  it.each(["\n", "\r\n"])("normalizes folded descriptions with %j line endings", (newline) => {
    const content = [
      "---",
      "name: fixture",
      "description: >-",
      "  First line",
      "  with   extra spacing.",
      "",
      "  Final line.",
      "type: sub-skill",
      "---",
      "Body is not part of the description.",
    ].join(newline);

    expect(normalizedSkillDescription(content)).toBe("First line with extra spacing. Final line.");
    expect(skillDescriptionIssue(content)).toBeUndefined();
  });

  it.each(["Plain summary.", '"Plain summary."', "'Plain summary.'"])("accepts inline descriptions: %s", (value) => {
    expect(normalizedSkillDescription(`---\ndescription: ${value}\n---`)).toBe("Plain summary.");
  });

  it.each([
    "description: outside frontmatter",
    "---\nname: fixture\n---\ndescription: only in the body",
    "---\nname: fixture\ndescription: >-\n  missing closing delimiter",
    "---\ndescription:\n---",
    "---\ndescription: >-\n   \n---",
    '---\ndescription: ""\n---',
    "---\ndescription: ''\n---",
  ])("rejects missing or empty descriptions: %j", (content) => {
    expect(skillDescriptionIssue(content)).toBe("description is missing or empty");
  });

  it("checks the whole folded description at the 250-character boundary", () => {
    const content = `---\ndescription: >-\n  ${"a".repeat(124)}\n  ${"b".repeat(125)}\n---`;
    expect(normalizedSkillDescription(content)).toHaveLength(250);
    expect(skillDescriptionIssue(content)).toBeUndefined();
    expect(skillDescriptionIssue(content.replace("b\n---", "bb\n---"))).toBe(
      "description has 251 characters (maximum 250)"
    );
  });

  it("keeps every packaged and local maintainer skill description nonempty and at most 250 characters", async () => {
    const packagedSkills = await collectSkillFiles(skillsRoot);
    expect(packagedSkills.length).toBeGreaterThan(0);
    const skillFiles = [...packagedSkills, new URL("../.agents/skillsUpdate/SKILL.md", import.meta.url)];
    const issues = [];

    for (const file of skillFiles) {
      const issue = skillDescriptionIssue(await readFile(file, "utf8"));
      if (issue) issues.push(`${file.pathname}: ${issue}`);
    }

    expect(issues).toEqual([]);
  });
});

describe("skill documentation references", () => {
  it("ignores sibling skill links and external documentation URLs", () => {
    expect(
      findDocumentationReferences(
        "`../core/SKILL.md` and https://example.com/docs/README.md stay local/external; use `@augmentcode/themis/docs/TESTING.md`."
      )
    ).toEqual(["@augmentcode/themis/docs/TESTING.md"]);
  });

  it("requires absolute package sources to be quoted without restricting relative or external sources", async () => {
    const unquoted = "---\nsources:\n  - @augmentcode/themis/docs/TESTING.md\n---";
    const quoted = '---\nsources:\n  - "@augmentcode/themis/docs/TESTING.md"\n---';
    const allowed = "---\nsources:\n  - ../core/SKILL.md\n  - https://example.com/docs/TESTING.md\n---";

    expect(findUnquotedPackageSourceReferences(unquoted)).toEqual([
      "@augmentcode/themis/docs/TESTING.md",
    ]);
    expect(findUnquotedPackageSourceReferences(quoted)).toEqual([]);
    expect(findUnquotedPackageSourceReferences(allowed)).toEqual([]);

    const skillFiles = await collectSkillFiles(skillsRoot);
    const invalidReferences = [];
    for (const file of skillFiles) {
      const content = await readFile(file, "utf8");
      for (const reference of findUnquotedPackageSourceReferences(content)) {
        invalidReferences.push(`${file.pathname}: ${reference}`);
      }
    }

    expect(invalidReferences).toEqual([]);
  });

  it("uses package-qualified existing package documents while preserving local skill links", async () => {
    const skillFiles = await collectSkillFiles(skillsRoot);
    const invalidReferences = [];
    const invalidSiblingReferences = [];
    const packageDocuments = new Set();

    for (const file of skillFiles) {
      const content = await readFile(file, "utf8");
      for (const reference of findSiblingSkillReferences(content)) {
        if (reference.includes("*")) continue;
        try {
          await access(new URL(reference, file));
        } catch {
          invalidSiblingReferences.push(`${file.pathname}: ${reference}`);
        }
      }
      for (const reference of findDocumentationReferences(content)) {
        if (reference === "README.md" || reference.startsWith("docs/") || reference.startsWith("augmentcode/themis:")) {
          invalidReferences.push(`${file.pathname}: ${reference}`);
        } else if (reference.startsWith(packageDocsPrefix)) {
          packageDocuments.add(documentationTarget(reference));
        } else if (reference === `${packagePrefix}README.md`) {
          packageDocuments.add("README.md");
        }
      }
    }

    expect(invalidReferences).toEqual([]);
    expect(invalidSiblingReferences).toEqual([]);

    for (const document of packageDocuments) {
      const root = document === "README.md" ? repositoryRoot : docsRoot;
      await expect(access(new URL(document, root))).resolves.toBeUndefined();
    }
  });
});