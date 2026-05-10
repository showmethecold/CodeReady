export type ToolCategory = "ai" | "optional" | "prerequisite";

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface DetectionResult {
  id: string;
  name: string;
  installed: boolean;
  version?: string | null;
  detail: string;
}

export interface SystemCheckResult {
  platform: string;
  arch: string;
  isWindows: boolean;
  detections: DetectionResult[];
  wingetRepairUrl: string;
}

export interface InstallRecipe {
  platform: string;
  method: string;
  prerequisites: string[];
  commands: string[];
  priority: number;
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategory;
  plainLanguageDescription: string;
  officialUrl: string;
  installRecipes: InstallRecipe[];
  verifyCommand: string[];
}

export interface InstallStep {
  id: string;
  label: string;
  toolId: string;
  command: string[];
  requiresAdmin: boolean;
  status: StepStatus;
}

export interface InstallPlan {
  blocked: boolean;
  blockReason?: string | null;
  steps: InstallStep[];
}

export interface InstallEvent {
  stepId: string;
  label: string;
  status: StepStatus;
  stdoutSummary: string;
  errorSummary: string;
}

export interface VerificationResult {
  results: DetectionResult[];
}

export interface ToolSelection {
  aiTools: string[];
  optionalTools: string[];
}
