// @effect-diagnostics nodeBuiltinImport:off - Node unit test inspecting source & built Lightning CSS artifacts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const WEB_ROOT = NodePath.resolve(import.meta.dirname, "../../..");
const STYLES_DIR = NodePath.join(WEB_ROOT, "src/styles");
const DIST_ASSETS_DIR = NodePath.join(WEB_ROOT, "dist/assets");

const REQUIRED_SPRING_TOKENS = [
  "--spring-micro",
  "--spring-snappy",
  "--spring-fluid",
  "--spring-spatial",
  "--spring-bouncy",
  "--spring-gentle",
] as const;

const MODULAR_STYLESHEETS = [
  "motion-foundation.css",
  "chat-motion.css",
  "workspace-motion.css",
  "workspace-hubs.css",
  "desktop-linux.css",
  "shell-motion.css",
  "pairing-motion.css",
] as const;

describe("Wave 5 built CSS & modular motion stylesheet gate (C137)", () => {
  it("keeps all 7 modular motion stylesheets intact and free of hot-path backdrop-filter blur rules", () => {
    for (const file of MODULAR_STYLESHEETS) {
      const fullPath = NodePath.join(STYLES_DIR, file);
      expect(NodeFS.existsSync(fullPath), `Missing modular stylesheet ${file}`).toBe(true);
      const css = NodeFS.readFileSync(fullPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const blurMatches = Array.from(
        css.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*[^;}\n]*blur\(/gi),
        (match) => match[0],
      );
      expect(blurMatches, `Unexpected backdrop-filter blur in ${file}`).toEqual([]);
    }

    const indexCss = NodeFS.readFileSync(NodePath.join(WEB_ROOT, "src/index.css"), "utf8");
    for (const imported of [
      "./styles/motion-foundation.css",
      "./styles/chat-motion.css",
      "./styles/workspace-motion.css",
      "./styles/desktop-linux.css",
      "./styles/shell-motion.css",
    ]) {
      expect(indexCss).toContain(`@import "${imported}";`);
    }
  });

  it("verifies Tailwind 4 + Lightning CSS production bundle preserves superellipse, pill round guard, and all 6 linear() springs when built", () => {
    if (!NodeFS.existsSync(DIST_ASSETS_DIR)) {
      return;
    }
    const cssFiles = NodeFS.readdirSync(DIST_ASSETS_DIR).filter((name) => name.endsWith(".css"));
    if (cssFiles.length === 0) {
      return;
    }

    const bundledCss = cssFiles
      .map((name) => NodeFS.readFileSync(NodePath.join(DIST_ASSETS_DIR, name), "utf8"))
      .join("\n");

    expect(bundledCss).toContain("superellipse(1.25)");
    expect(bundledCss).toMatch(/corner-shape\s*:\s*round/);
    expect(bundledCss).toContain("--visible-animation-state");
    expect(bundledCss).toContain("surface-optical-chrome");

    for (const token of REQUIRED_SPRING_TOKENS) {
      expect(bundledCss, `Built Lightning CSS stripped ${token}: linear(...) declaration`).toMatch(
        new RegExp(`${token}\\s*:\\s*linear\\(`),
      );
    }
  });
});
