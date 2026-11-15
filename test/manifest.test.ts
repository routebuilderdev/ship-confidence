import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { APP_ARI } from "../src/graph/register";

/**
 * The manifest is the only place the tool surface is declared, and Forge gives no
 * compile-time check that a handler string points at a real export. This test is
 * that check: a broken handler path or a tool that references a deleted action
 * fails here instead of failing at `forge deploy`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = parse(readFileSync(resolve(root, "manifest.yml"), "utf8")) as Manifest;

interface Manifest {
  modules: {
    "rovo:mcp": Array<{ key: string; name: string; tools: string[]; resources?: unknown[] }>;
    action: Array<{
      key: string;
      name: string;
      function: string;
      actionVerb: string;
      description: string;
      inputs: Record<string, { title: string; type: string; required?: boolean; description: string }>;
    }>;
    function: Array<{ key: string; handler: string }>;
    "rovo:skill": Array<{
      key: string;
      source: { dir: string };
      dependencies?: { tools: string[] };
    }>;
    "jira:projectPage": Array<{
      key: string;
      title: string;
      resource: string;
      render?: string;
      resolver?: { function: string };
    }>;
  };
  resources: Array<{ key: string; path: string }>;
  permissions: { scopes: string[] };
  app: { id: string; runtime: { name: string } };
}

const mcp = manifest.modules["rovo:mcp"];
const actions = manifest.modules.action;
const functions = manifest.modules.function;

describe("manifest", () => {
  it("declares exactly one MCP module with a short name", () => {
    expect(mcp).toHaveLength(1);
    expect(mcp[0]!.name.length).toBeLessThanOrEqual(30);
    expect(mcp[0]!.key.length).toBeLessThanOrEqual(64);
  });

  it("only exposes tools that exist as actions", () => {
    const actionKeys = new Set(actions.map((action) => action.key));
    for (const tool of mcp[0]!.tools) {
      expect(actionKeys.has(tool), `tool ${tool} has no matching action`).toBe(true);
    }
    expect(new Set(mcp[0]!.tools).size).toBe(mcp[0]!.tools.length);
  });

  it("points every function at a real exported handler", () => {
    for (const fn of functions) {
      const [path, exportName] = fn.handler.split(".");
      expect(exportName, `${fn.key} handler needs file.export form`).toBeTruthy();

      const file = resolve(root, "src", `${path}.ts`);
      expect(existsSync(file), `${fn.key} -> missing ${file}`).toBe(true);

      const source = readFileSync(file, "utf8");
      expect(
        new RegExp(`export (const|async function|function) ${exportName}\\b`).test(source),
        `${fn.key} -> ${path}.ts does not export ${exportName}`,
      ).toBe(true);
    }
  });

  it("keeps every action wired to a declared function", () => {
    const functionKeys = new Set(functions.map((fn) => fn.key));
    for (const action of actions) {
      expect(functionKeys.has(action.function), `${action.key} -> unknown function`).toBe(true);
    }
  });

  it("respects the platform's identifier limits", () => {
    for (const fn of functions) {
      expect(fn.key.length, `${fn.key} is longer than 23 chars`).toBeLessThanOrEqual(23);
    }
    for (const action of actions) {
      expect(action.key.length).toBeLessThan(64);
      // The manifest schema caps this at 255; exceeding it fails the whole action.
      expect(action.description.length, `${action.key} description is too long`).toBeLessThanOrEqual(
        255,
      );
    }
  });

  it("keeps every tool read-only so automation can call it", () => {
    for (const action of actions) {
      expect(action.actionVerb, `${action.key} must be GET`).toBe("GET");
    }
  });

  it("documents every input for the model", () => {
    for (const action of actions) {
      for (const [name, input] of Object.entries(action.inputs)) {
        expect(["string", "integer", "number", "boolean"]).toContain(input.type);
        expect(input.title.length, `${action.key}.${name} needs a title`).toBeGreaterThan(0);
        expect(input.description.length, `${action.key}.${name} needs a description`).toBeGreaterThan(
          10,
        );
      }
    }
  });

  it("asks for read-only scopes, and nothing beyond the two documented uses", () => {
    // read:graph:* is the app; read:jira-work exists only so the project page can
    // list versions. Anything else appearing here is a scope creep bug.
    const allowed = new Set(["read:jira-work"]);
    expect(manifest.permissions.scopes.length).toBeGreaterThan(0);

    for (const scope of manifest.permissions.scopes) {
      const isGraph = scope.startsWith("read:graph:");
      expect(isGraph || allowed.has(scope), `unexpected scope ${scope}`).toBe(true);
      expect(scope.startsWith("write:") || scope.includes(":write")).toBe(false);
    }
  });

  it("runs on the supported Node runtime", () => {
    expect(manifest.app.runtime.name).toBe("nodejs24.x");
  });

  it("points the project page at a real resource and resolver function", () => {
    const pages = manifest.modules["jira:projectPage"] ?? [];
    expect(pages).toHaveLength(1);

    const page = pages[0]!;
    expect(page.render).toBe("native");
    expect(page.title.length).toBeGreaterThan(0);

    const resource = (manifest.resources ?? []).find((item) => item.key === page.resource);
    expect(resource, `page resource ${page.resource} is not declared`).toBeDefined();
    expect(existsSync(resolve(root, resource!.path)), `missing ${resource!.path}`).toBe(true);

    const functionKeys = new Set(functions.map((fn) => fn.key));
    const resolverKey = page.resolver?.function;
    expect(functionKeys.has(resolverKey ?? ""), `page resolver ${resolverKey} is undefined`).toBe(
      true,
    );
  });

  it("ships a skill whose directory and name agree", () => {
    const skills = manifest.modules["rovo:skill"] ?? [];
    expect(skills.length).toBeGreaterThan(0);

    for (const skill of skills) {
      const dirName = skill.source.dir.split("/").filter(Boolean).pop() ?? "";
      const file = resolve(root, skill.source.dir, "SKILL.md");
      expect(existsSync(file), `missing ${file}`).toBe(true);

      const text = readFileSync(file, "utf8");
      const frontmatter = text.split("---")[1] ?? "";
      const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";
      const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";

      expect(name, "skill name must match its directory").toBe(dirName);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(/^[a-z0-9-]+$/.test(name), "skill name must be lowercase and hyphenated").toBe(true);
      // Below ~50 characters the model stops selecting the skill reliably.
      expect(description.length).toBeGreaterThanOrEqual(50);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(text.split("\n").length).toBeLessThanOrEqual(500);
    }
  });

  it("only tells the skill about tools that exist", () => {
    const actionKeys = new Set(actions.map((action) => action.key));
    for (const skill of manifest.modules["rovo:skill"] ?? []) {
      for (const tool of skill.dependencies?.tools ?? []) {
        expect(actionKeys.has(tool), `skill depends on unknown tool ${tool}`).toBe(true);
      }
    }
  });
});

describe("query registration identity", () => {
  it("registers the persisted query against the app that owns the manifest", () => {
    const appId = (manifest as unknown as { app: { id: string } }).app.id;
    // A mismatch would register the query to an app that can never execute it.
    expect(appId).toBe(APP_ARI);
  });

  it("declares the object scopes the graph queries read", () => {
    const scopes = (manifest as unknown as { permissions: { scopes: string[] } }).permissions.scopes;
    for (const scope of [
      "read:graph:issue:jira",
      "read:graph:version:jira",
      "read:graph:issue-comment:jira",
      "read:graph:pull-request:external",
      "read:graph:deployment:external",
    ]) {
      // A missing scope does not error — it silently empties the result.
      expect(scopes).toContain(scope);
    }
  });
});
