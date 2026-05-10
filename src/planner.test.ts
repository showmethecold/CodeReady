import { describe, expect, it } from "vitest";
import { buildClientInstallPlan } from "./planner";
import type { SystemCheckResult } from "./types";

const baseCheck: SystemCheckResult = {
  platform: "windows",
  arch: "x86_64",
  isWindows: true,
  wingetRepairUrl: "https://learn.microsoft.com/windows/package-manager/winget/",
  detections: [
    { id: "winget", name: "Windows Package Manager", installed: true, version: "1.0.0", detail: "Ready" },
    { id: "git", name: "Git for Windows", installed: false, version: null, detail: "Missing" },
    { id: "node", name: "Node.js", installed: false, version: null, detail: "Missing" },
    { id: "npm", name: "npm", installed: false, version: null, detail: "Missing" },
    { id: "claude", name: "Claude Code", installed: false, version: null, detail: "Missing" },
    { id: "codex", name: "OpenAI Codex", installed: false, version: null, detail: "Missing" },
    { id: "gemini", name: "Gemini CLI", installed: false, version: null, detail: "Missing" },
    { id: "vscode", name: "Visual Studio Code", installed: false, version: null, detail: "Missing" },
    { id: "github-desktop", name: "GitHub Desktop", installed: false, version: null, detail: "Missing" },
  ],
};

describe("buildClientInstallPlan", () => {
  it("does not install Node when only Claude is selected", () => {
    const plan = buildClientInstallPlan({ aiTools: ["claude"], optionalTools: [] }, baseCheck);
    expect(plan.steps.map((step) => step.toolId)).toEqual(["git", "claude"]);
  });

  it("installs Node before npm-based AI tools", () => {
    const plan = buildClientInstallPlan({ aiTools: ["gemini"], optionalTools: [] }, baseCheck);
    expect(plan.steps.map((step) => step.toolId)).toEqual(["git", "node", "gemini"]);
  });

  it("adds optional tools only when selected", () => {
    const plan = buildClientInstallPlan(
      { aiTools: [], optionalTools: ["vscode", "github-desktop"] },
      baseCheck,
    );
    expect(plan.steps.map((step) => step.toolId)).toEqual(["git", "vscode", "github-desktop"]);
  });

  it("blocks when winget is missing", () => {
    const check = {
      ...baseCheck,
      detections: baseCheck.detections.map((item) =>
        item.id === "winget" ? { ...item, installed: false, version: null } : item,
      ),
    };
    const plan = buildClientInstallPlan({ aiTools: ["claude"], optionalTools: [] }, check);
    expect(plan.blocked).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });
});
