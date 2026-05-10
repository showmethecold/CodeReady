import type { DetectionResult, InstallPlan, InstallStep, SystemCheckResult } from "./types";

export const NODE_REQUIRED_TOOL_IDS = new Set(["codex", "gemini"]);

export function isInstalled(check: SystemCheckResult | null, id: string): boolean {
  return Boolean(check?.detections.find((item) => item.id === id)?.installed);
}

export function buildClientInstallPlan(
  selection: { aiTools: string[]; optionalTools: string[] },
  check: SystemCheckResult | null,
): InstallPlan {
  if (!check?.isWindows) {
    return {
      blocked: true,
      blockReason: "CodeReady v1 only supports Windows.",
      steps: [],
    };
  }

  if (!isInstalled(check, "winget")) {
    return {
      blocked: true,
      blockReason: "Windows Package Manager is required before CodeReady can install tools.",
      steps: [],
    };
  }

  const selected = [...selection.aiTools, ...selection.optionalTools];
  const steps: InstallStep[] = [];

  addPrerequisiteStep(steps, check, "git", "Install Git for Windows", ["winget", "install", "-e", "--id", "Git.Git"]);

  if (selection.aiTools.some((id) => NODE_REQUIRED_TOOL_IDS.has(id))) {
    addPrerequisiteStep(steps, check, "node", "Install Node.js LTS", [
      "winget",
      "install",
      "-e",
      "--id",
      "OpenJS.NodeJS.LTS",
    ]);
  }

  for (const toolId of selected) {
    if (isInstalled(check, toolId)) {
      continue;
    }

    if (toolId === "claude") {
      steps.push(makeStep("tool-claude", "Install Claude Code", "claude", [
        "winget",
        "install",
        "-e",
        "--id",
        "Anthropic.ClaudeCode",
      ]));
    }

    if (toolId === "codex") {
      steps.push(makeStep("tool-codex", "Install OpenAI Codex", "codex", [
        "npm",
        "install",
        "-g",
        "@openai/codex",
      ]));
    }

    if (toolId === "gemini") {
      steps.push(makeStep("tool-gemini", "Install Gemini CLI", "gemini", [
        "npm",
        "install",
        "-g",
        "@google/gemini-cli",
      ]));
    }

    if (toolId === "vscode") {
      steps.push(makeStep("tool-vscode", "Install Visual Studio Code", "vscode", [
        "winget",
        "install",
        "-e",
        "--id",
        "Microsoft.VisualStudioCode",
      ]));
    }

    if (toolId === "github-desktop") {
      steps.push(makeStep("tool-github-desktop", "Install GitHub Desktop", "github-desktop", [
        "winget",
        "install",
        "-e",
        "--id",
        "GitHub.GitHubDesktop",
      ]));
    }
  }

  return { blocked: false, blockReason: null, steps };
}

function addPrerequisiteStep(
  steps: InstallStep[],
  check: SystemCheckResult,
  toolId: string,
  label: string,
  command: string[],
) {
  if (!isInstalled(check, toolId)) {
    steps.push(makeStep(`prereq-${toolId}`, label, toolId, command));
  }
}

function makeStep(id: string, label: string, toolId: string, command: string[]): InstallStep {
  return {
    id,
    label,
    toolId,
    command,
    requiresAdmin: false,
    status: "pending",
  };
}

export function summarizeDetections(detections: DetectionResult[]) {
  const installed = detections.filter((item) => item.installed).length;
  return `${installed} of ${detections.length} checks are ready`;
}
