import type { ToolDefinition } from "./types";

export const AI_TOOLS: ToolDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    category: "ai",
    plainLanguageDescription:
      "An AI coding assistant from Anthropic that can read a project, make changes, and help you understand code from the terminal.",
    officialUrl: "https://code.claude.com/docs/en/setup",
    installRecipes: [
      {
        platform: "windows",
        method: "winget",
        prerequisites: ["winget", "git"],
        commands: ["winget install -e --id Anthropic.ClaudeCode"],
        priority: 1,
      },
    ],
    verifyCommand: ["claude", "--version"],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    category: "ai",
    plainLanguageDescription:
      "OpenAI's terminal coding agent for asking questions, editing files, reviewing code, and working through software tasks.",
    officialUrl: "https://github.com/openai/codex",
    installRecipes: [
      {
        platform: "windows",
        method: "npm",
        prerequisites: ["winget", "git", "node"],
        commands: ["npm install -g @openai/codex"],
        priority: 1,
      },
    ],
    verifyCommand: ["codex", "--version"],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    category: "ai",
    plainLanguageDescription:
      "Google's terminal AI agent for coding help, file changes, project explanation, and Gemini model access.",
    officialUrl: "https://github.com/google-gemini/gemini-cli",
    installRecipes: [
      {
        platform: "windows",
        method: "npm",
        prerequisites: ["winget", "git", "node"],
        commands: ["npm install -g @google/gemini-cli"],
        priority: 1,
      },
    ],
    verifyCommand: ["gemini", "--version"],
  },
];

export const OPTIONAL_TOOLS: ToolDefinition[] = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    category: "optional",
    plainLanguageDescription:
      "A code editor for opening project folders, reviewing AI changes, searching files, and editing small fixes visually.",
    officialUrl: "https://code.visualstudio.com/",
    installRecipes: [
      {
        platform: "windows",
        method: "winget",
        prerequisites: ["winget"],
        commands: ["winget install -e --id Microsoft.VisualStudioCode"],
        priority: 1,
      },
    ],
    verifyCommand: ["code", "--version"],
  },
  {
    id: "github-desktop",
    name: "GitHub Desktop",
    category: "optional",
    plainLanguageDescription:
      "A visual app for saving checkpoints, comparing changes, and uploading a project when you want to share it.",
    officialUrl: "https://desktop.github.com/",
    installRecipes: [
      {
        platform: "windows",
        method: "winget",
        prerequisites: ["winget"],
        commands: ["winget install -e --id GitHub.GitHubDesktop"],
        priority: 1,
      },
    ],
    verifyCommand: ["winget", "list", "-e", "--id", "GitHub.GitHubDesktop"],
  },
];

export const ALL_TOOLS = [...AI_TOOLS, ...OPTIONAL_TOOLS];
