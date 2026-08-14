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

describe("skill documentation references", () => {
  it("ignores sibling skill links and external documentation URLs", () => {
    expect(
      findDocumentationReferences(
        "`../core/SKILL.md` and https://example.com/docs/README.md stay local/external; use `@augmentcode/themis/docs/TESTING.md`."
      )
    ).toEqual(["@augmentcode/themis/docs/TESTING.md"]);
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