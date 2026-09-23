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

function markdownProse(content) {
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""));
  let fence;
  return body.split(/\r?\n/).map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined;
      }
      return "";
    }
    if (marker) {
      fence = marker[1];
      return "";
    }
    return line;
  }).join("\n");
}

// The catalog uses ATX headings and inline/reference links, not a full Markdown AST.
function headingAnchors(content) {
  const anchors = new Set();
  for (const match of markdownProse(content).matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)\s*$/gm)) {
    const slug = match[1]
      .replace(/[ \t]+#+$/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let anchor = slug;
    let suffix = 0;
    while (anchors.has(anchor)) anchor = `${slug}-${++suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

function findSectionReferences(content) {
  const prose = markdownProse(content);
  const patterns = [
    /\]\(\s*<?([^\s>#)]*#[^\s>)]+)>?/g,
    /^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>#]*#[^\s>]+)>?/gm,
    /`([^`\s#]*#[^`\s]+)`/g,
  ];
  return [...new Set(patterns.flatMap((pattern) => [...prose.matchAll(pattern)].map((match) => match[1])))];
}

function sectionReferenceIssue(reference, source, documents) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return undefined;
  const hashIndex = reference.indexOf("#");
  const path = reference.slice(0, hashIndex);
  if (path && !path.endsWith(".md")) return undefined;
  let fragment;
  try {
    fragment = decodeURIComponent(reference.slice(hashIndex + 1));
  } catch {
    return `invalid fragment encoding: ${reference}`;
  }
  const target = path.startsWith(packagePrefix)
    ? new URL(path.slice(packagePrefix.length), repositoryRoot)
    : path.startsWith("/")
      ? new URL(path.slice(1), repositoryRoot)
      : new URL(path || source.href, source);
  const content = documents.get(target.href);
  if (content === undefined) return `missing document: ${reference}`;
  if (!headingAnchors(content).has(fragment)) return `missing heading: ${reference}`;
  return undefined;
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

describe("skill section references", () => {
  it.each(["\n", "\r\n"])("finds formatted, Unicode, and duplicate ATX heading anchors with %j", (newline) => {
    const content = [
      "---", "description: >-", "  # Not a heading", "---",
      "# Setup — core rules", "## Fallback hook/plain-value read",
      "### `selectFoo.select()` and **signals** ###", "## [Linked title](./other.md)",
      "## Café 状態", "## Repeat", "## Repeat-1", "## Repeat",
    ].join(newline);
    expect([...headingAnchors(content)]).toEqual([
      "setup--core-rules", "fallback-hookplain-value-read", "selectfooselect-and-signals",
      "linked-title", "café-状態", "repeat", "repeat-1", "repeat-2",
    ]);
  });

  it("ignores frontmatter, fenced examples, comments, and non-heading lines", () => {
    const content = [
      "---", 'source: "other.md#metadata"', "---",
      "````md", "# Hidden", "```", "[hidden](other.md#hidden)", "````",
      "~~~md", "# Also hidden", "~~~~", "<!--", "# Comment", "-->",
      "    # Indented code", "####### Too many hashes", "#No separator",
      "## Visible", "[visible](#visible)",
    ].join("\n");
    expect([...headingAnchors(content)]).toEqual(["visible"]);
    expect(findSectionReferences(content)).toEqual(["#visible"]);
    expect([...headingAnchors("```md\n# Never closed")]).toEqual([]);
  });

  it("extracts inline, reference-style, angle-wrapped, and code-form section targets", () => {
    const content = [
      '[inline](../other/SKILL.md#call-modes "title")',
      "[angle](<../other/SKILL.md#encoded-%C3%A9>)",
      "[reference][owner]", "[owner]: ../other/SKILL.md#guardrails",
      "`@augmentcode/themis/docs/SELECTORS.md#selector-lifecycle-rules`",
      "[local](#local)", "[file only](../other/SKILL.md)",
    ].join("\n");
    expect(findSectionReferences(content)).toEqual([
      "../other/SKILL.md#call-modes", "../other/SKILL.md#encoded-%C3%A9", "#local",
      "../other/SKILL.md#guardrails", "@augmentcode/themis/docs/SELECTORS.md#selector-lifecycle-rules",
    ]);
  });

  it("resolves local, relative, root-relative, and package targets and reports missing headings", () => {
    const source = new URL("skills/fixture/SKILL.md", repositoryRoot);
    const target = new URL("skills/other/SKILL.md", repositoryRoot);
    const documents = new Map([
      [source.href, "# Local"], [target.href, "# Café\n## Repeated\n## Repeated"],
      [new URL("docs/SELECTORS.md", repositoryRoot).href, "# Selector lifecycle rules"],
    ]);
    for (const reference of [
      "#local", "../other/SKILL.md#caf%C3%A9", "/skills/other/SKILL.md#repeated-1",
      "@augmentcode/themis/docs/SELECTORS.md#selector-lifecycle-rules",
      "https://example.com/SKILL.md#remote", "//example.com/SKILL.md#remote", "./source.ts#symbol",
    ]) {
      expect(sectionReferenceIssue(reference, source, documents)).toBeUndefined();
    }
    expect(sectionReferenceIssue("../missing/SKILL.md#title", source, documents)).toMatch(/^missing document:/);
    expect(sectionReferenceIssue("../other/SKILL.md#renamed", source, documents)).toMatch(/^missing heading:/);
    expect(sectionReferenceIssue("#Local", source, documents)).toMatch(/^missing heading:/);
    expect(sectionReferenceIssue("#bad%2", source, documents)).toMatch(/^invalid fragment encoding:/);
    documents.set(target.href, "# Renamed");
    expect(sectionReferenceIssue("../other/SKILL.md#café", source, documents)).toMatch(/^missing heading:/);
  });

  it("keeps skill section links and incoming documentation links reachable", async () => {
    const skillFiles = await collectSkillFiles(skillsRoot);
    const docFiles = (await readdir(docsRoot)).filter((name) => name.endsWith(".md"));
    const files = [
      ...skillFiles, ...docFiles.map((name) => new URL(name, docsRoot)),
      new URL("README.md", repositoryRoot), new URL(".agents/skillsUpdate/SKILL.md", repositoryRoot),
    ];
    const documents = new Map(await Promise.all(files.map(async (file) => [file.href, await readFile(file, "utf8")])));
    const issues = [];
    for (const file of files) {
      for (const reference of findSectionReferences(documents.get(file.href))) {
        // Check all outgoing skill links and incoming links to skills, not unrelated docs-only links.
        if (!file.pathname.endsWith("/SKILL.md") && !reference.split("#", 1)[0].endsWith("SKILL.md")) continue;
        const issue = sectionReferenceIssue(reference, file, documents);
        if (issue) issues.push(`${file.pathname}: ${issue}`);
      }
    }
    expect(issues).toEqual([]);
  });
});