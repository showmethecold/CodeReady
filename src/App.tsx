import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  Github,
  History,
  Loader2,
  MonitorCog,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AI_TOOLS, OPTIONAL_TOOLS } from "./catalog";
import { buildClientInstallPlan, summarizeDetections } from "./planner";
import type {
  DetectionResult,
  InstallEvent,
  InstallPlan,
  SystemCheckResult,
  ToolDefinition,
  ToolSelection,
  VerificationResult,
} from "./types";

type AppStep = "welcome" | "select" | "review" | "install" | "optional" | "results";
type InstallMode = "ai" | "optional";

interface StartGuide {
  id: string;
  name: string;
  command: string;
  accountTitle: string;
  accountSteps: string[];
  firstPrompt: string;
  fallback?: string;
  keyNote?: string;
  docsUrl: string;
}

const START_GUIDES: Record<string, StartGuide> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    accountTitle: "Sign in with your Claude account",
    accountSteps: [
      "Open Terminal or PowerShell.",
      "Run claude.",
      "Finish the browser sign-in that opens.",
    ],
    firstPrompt: "Explain this project and suggest one small improvement.",
    fallback: "If the browser does not open, press c in the terminal to copy the login link.",
    keyNote: "Claude also supports Console and cloud-provider sign-in, but account sign-in is the clearest first path.",
    docsUrl: "https://code.claude.com/docs/en/authentication",
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    command: "codex login",
    accountTitle: "Sign in with ChatGPT",
    accountSteps: [
      "Open Terminal or PowerShell.",
      "Run codex login.",
      "Choose Sign in with ChatGPT in the browser.",
    ],
    firstPrompt: "Explain this folder and tell me what command starts the app.",
    fallback: "If the browser cannot open, run codex login --device-auth.",
    keyNote: "API key login is available, but ChatGPT sign-in is the recommended first path.",
    docsUrl: "https://www.mintlify.com/openai/codex/cli/login",
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    accountTitle: "Log in with Google",
    accountSteps: [
      "Open Terminal or PowerShell.",
      "Run gemini.",
      "Choose Login with Google when prompted.",
    ],
    firstPrompt: "Summarize this project and list the files I should open first.",
    fallback: "Use the same Google account tied to your Gemini plan, if you have one.",
    keyNote: "API key setup is available in Gemini’s auth menu, but Google sign-in is the simplest first path.",
    docsUrl: "https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html",
  },
};

const defaultSelection: ToolSelection = {
  aiTools: [],
  optionalTools: [],
};

export default function App() {
  const [step, setStep] = useState<AppStep>("welcome");
  const [systemCheck, setSystemCheck] = useState<SystemCheckResult | null>(null);
  const [selection, setSelection] = useState<ToolSelection>(defaultSelection);
  const [installPlan, setInstallPlan] = useState<InstallPlan | null>(null);
  const [events, setEvents] = useState<InstallEvent[]>([]);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>("ai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshSystemCheck();
  }, []);

  const activeSelection = useMemo(
    () =>
      installMode === "ai"
        ? { aiTools: selection.aiTools, optionalTools: [] }
        : { aiTools: [], optionalTools: selection.optionalTools },
    [installMode, selection.aiTools, selection.optionalTools],
  );
  const localPlan = useMemo(() => buildClientInstallPlan(activeSelection, systemCheck), [activeSelection, systemCheck]);

  async function refreshSystemCheck() {
    setBusy(true);
    setError(null);

    try {
      setSystemCheck(await invoke<SystemCheckResult>("check_system"));
    } catch (err) {
      setSystemCheck(makeBrowserMockCheck());
      setError(
        "Running in browser preview mode. System checks are mocked until CodeReady is opened as a Tauri desktop app.",
      );
      console.warn(err);
    } finally {
      setBusy(false);
    }
  }

  async function loadInstallPlan(nextStep: AppStep = "review") {
    setBusy(true);
    setError(null);

    try {
      const plan = await invoke<InstallPlan>("get_install_plan", {
        selectedAiTools: activeSelection.aiTools,
        selectedOptionalTools: activeSelection.optionalTools,
      });
      setInstallPlan(plan);
      setStep(nextStep);
    } catch (err) {
      setInstallPlan(localPlan);
      setStep(nextStep);
      console.warn(err);
    } finally {
      setBusy(false);
    }
  }

  async function runInstall() {
    setBusy(true);
    setError(null);
    setEvents([]);
    setStep("install");

    try {
      const plan = installPlan ?? localPlan;

      if (plan.blocked) {
        setEvents([
          {
            stepId: "blocked",
            label: "Install blocked",
            status: "failed",
            stdoutSummary: "",
            errorSummary: plan.blockReason ?? "CodeReady cannot run this install plan.",
          },
        ]);
        const verify = await invoke<VerificationResult>("verify_tools", {
          selectedTools: installMode === "ai" ? selection.aiTools : [...selection.aiTools, ...selection.optionalTools],
        });
        setVerification(verify);
        setStep("results");
        return;
      }

      for (const step of plan.steps) {
        const runningEvent: InstallEvent = {
          stepId: step.id,
          label: step.label,
          status: "running",
          stdoutSummary: "",
          errorSummary: "",
        };
        setEvents((current) => [...current.filter((event) => event.stepId !== step.id), runningEvent]);

        const result = await invoke<InstallEvent>("run_install_step", { step });
        setEvents((current) => [...current.filter((event) => event.stepId !== step.id), result]);
      }

      const verify = await invoke<VerificationResult>("verify_tools", {
        selectedTools: installMode === "ai" ? selection.aiTools : [...selection.aiTools, ...selection.optionalTools],
      });
      setVerification(verify);
      await refreshSystemCheck();

      if (installMode === "ai") {
        setInstallPlan(null);
        setStep("results");
      } else {
        setStep("results");
      }
    } catch (err) {
      setError(String(err));
      setStep("results");
    } finally {
      setBusy(false);
    }
  }

  function toggleTool(tool: ToolDefinition) {
    const key = tool.category === "ai" ? "aiTools" : "optionalTools";
    if (tool.category === "ai" && isDetectionInstalled(systemCheck, tool.id)) {
      return;
    }

    setSelection((current) => {
      const exists = current[key].includes(tool.id);
      return {
        ...current,
        [key]: exists ? current[key].filter((id) => id !== tool.id) : [...current[key], tool.id],
      };
    });
  }

  const plan = installPlan ?? localPlan;

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Sparkles size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>CodeReady</strong>
            <span>AI coding starter</span>
          </div>
        </div>

        <nav className="steps" aria-label="Setup steps">
          <StepButton label="Start" icon={Sparkles} active={step === "welcome"} complete={step !== "welcome"} />
          <StepButton
            label="Choose tools"
            icon={Bot}
            active={step === "select"}
            complete={["review", "install", "optional", "results"].includes(step)}
          />
          <StepButton
            label="Review"
            icon={ShieldCheck}
            active={step === "review"}
            complete={["install", "optional", "results"].includes(step)}
          />
          <StepButton
            label="Install"
            icon={Terminal}
            active={step === "install"}
            complete={["optional", "results"].includes(step)}
          />
          <StepButton
            label="Extras"
            icon={MonitorCog}
            active={step === "optional"}
            complete={step === "results"}
          />
          <StepButton label="Finish" icon={Check} active={step === "results"} complete={false} />
        </nav>

        <div className="sidebarNote">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>CodeReady only runs curated official commands and shows them before install.</span>
        </div>
      </aside>

      <section className="workspace">
        {error ? (
          <div className="notice warning">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === "welcome" ? (
          <WelcomePanel
            busy={busy}
            systemCheck={systemCheck}
            onRefresh={refreshSystemCheck}
            onContinue={() => {
              setInstallMode("ai");
              setStep("select");
            }}
          />
        ) : null}

        {step === "select" ? (
          <SelectionPanel
            busy={busy}
            selection={selection}
            systemCheck={systemCheck}
            onToggle={toggleTool}
            onRefresh={refreshSystemCheck}
            onBack={() => setStep("welcome")}
            onContinue={() => {
              setInstallMode("ai");
              loadInstallPlan("review");
            }}
          />
        ) : null}

        {step === "review" ? (
          <ReviewPanel
            busy={busy}
            plan={plan}
            systemCheck={systemCheck}
            installMode={installMode}
            onBack={() => setStep(installMode === "ai" ? "select" : "optional")}
            onInstall={runInstall}
          />
        ) : null}

        {step === "install" ? <InstallPanel busy={busy} events={events} plan={plan} /> : null}

        {step === "optional" ? (
          <OptionalToolsPanel
            busy={busy}
            selection={selection}
            systemCheck={systemCheck}
            onToggle={toggleTool}
            onRefresh={refreshSystemCheck}
            onSkip={() => setStep("results")}
            onContinue={() => {
              setInstallMode("optional");
              loadInstallPlan("review");
            }}
          />
        ) : null}

        {step === "results" ? (
          <ResultsPanel
            events={events}
            verification={verification}
            selectedTools={[...selection.aiTools, ...selection.optionalTools]}
            onRetry={() => loadInstallPlan("review")}
            onOptional={() => {
              setInstallMode("optional");
              setStep("optional");
            }}
            onRefresh={refreshSystemCheck}
          />
        ) : null}
      </section>
    </main>
  );
}

function StepButton({
  label,
  icon: Icon,
  active,
  complete,
}: {
  label: string;
  icon: typeof Sparkles;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className={clsx("stepButton", active && "active", complete && "complete")}>
      <span className="stepIcon">{complete ? <Check size={16} /> : <Icon size={16} />}</span>
      <span>{label}</span>
    </div>
  );
}

function WelcomePanel({ onContinue }: { busy: boolean; systemCheck: SystemCheckResult | null; onRefresh: () => void; onContinue: () => void }) {
  return (
    <div className="panel introPanel">
      <div className="introCopy">
        <span className="eyebrow">Windows setup wizard</span>
        <h1>Start coding with AI tools without learning installer commands first.</h1>
        <p>
          CodeReady checks your computer, helps install trusted AI coding tools, and explains each step in plain
          language.
        </p>
      </div>

      <div className="actions">
        <button className="primaryButton" type="button" onClick={onContinue}>
          Choose tools
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SelectionPanel({
  busy,
  selection,
  systemCheck,
  onToggle,
  onRefresh,
  onBack,
  onContinue,
}: {
  busy: boolean;
  selection: ToolSelection;
  systemCheck: SystemCheckResult | null;
  onToggle: (tool: ToolDefinition) => void;
  onRefresh: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="panel">
      <PanelHeader
        eyebrow="Choose tools"
        title="Pick one or more AI coding tools."
        action={
          <button className="ghostButton" type="button" onClick={onRefresh}>
            {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
        }
      />

      <SectionTitle icon={Bot} title="AI coding tools" />
      <div className="toolGrid">
        {AI_TOOLS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            selected={selection.aiTools.includes(tool.id)}
            installed={isDetectionInstalled(systemCheck, tool.id)}
            hideToggle={isDetectionInstalled(systemCheck, tool.id)}
            onToggle={() => onToggle(tool)}
          />
        ))}
      </div>

      <div className="contextCheck">
        <div>
          <span className="metricLabel">Selected setup check</span>
          <strong>{systemCheck ? summarizeDetections(relevantDetections(systemCheck, selection.aiTools)) : "Checking..."}</strong>
        </div>
        <SystemGrid check={systemCheck ? filterSystemCheck(systemCheck, selection.aiTools) : null} compact />
      </div>

      <div className="actions split">
        <button className="secondaryButton" type="button" onClick={onBack}>
          Back
        </button>
        <button className="primaryButton" type="button" onClick={onContinue} disabled={selection.aiTools.length === 0}>
          Review {selection.aiTools.length} selected
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ReviewPanel({
  busy,
  plan,
  systemCheck,
  installMode,
  onBack,
  onInstall,
}: {
  busy: boolean;
  plan: InstallPlan;
  systemCheck: SystemCheckResult | null;
  installMode: InstallMode;
  onBack: () => void;
  onInstall: () => void;
}) {
  return (
    <div className="panel">
      <PanelHeader
        eyebrow="Review"
        title={
          installMode === "ai"
            ? "Check the AI tool install commands before anything runs."
            : "Check the optional tool install commands before anything runs."
        }
      />

      {plan.blocked ? (
        <div className="blockedBox">
          <CircleAlert size={22} aria-hidden="true" />
          <div>
            <strong>{plan.blockReason}</strong>
            <p>
              Install or repair Windows Package Manager, then come back to CodeReady and refresh the system check.
            </p>
            <a href={systemCheck?.wingetRepairUrl ?? "https://learn.microsoft.com/windows/package-manager/winget/"}>
              Microsoft winget guidance <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : plan.steps.length === 0 ? (
        <div className="readyBox">
          <Check size={22} aria-hidden="true" />
          <div>
            <strong>Everything selected already looks installed.</strong>
            <p>You can still verify the commands from the finish screen.</p>
          </div>
        </div>
      ) : (
        <CommandList plan={plan} />
      )}

      <div className="actions split">
        <button className="secondaryButton" type="button" onClick={onBack}>
          Back
        </button>
        <button className="primaryButton" type="button" onClick={onInstall} disabled={busy || plan.blocked}>
          {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {installMode === "ai" ? "Install AI tools" : "Install optional tools"}
        </button>
      </div>
    </div>
  );
}

function InstallPanel({ busy, events, plan }: { busy: boolean; events: InstallEvent[]; plan: InstallPlan }) {
  return (
    <div className="panel">
      <PanelHeader eyebrow="Install" title="Installing selected tools." />
      <div className="progressList">
        {plan.steps.map((step) => {
          const event = events.find((item) => item.stepId === step.id);
          const status = event?.status ?? "pending";
          return (
            <div className={clsx("progressRow", status)} key={step.id}>
              <StatusIcon status={status} />
              <div>
                <strong>{step.label}</strong>
                <code>{step.command.join(" ")}</code>
                {event?.errorSummary ? <p>{event.errorSummary}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OptionalToolsPanel({
  busy,
  selection,
  systemCheck,
  onToggle,
  onRefresh,
  onSkip,
  onContinue,
}: {
  busy: boolean;
  selection: ToolSelection;
  systemCheck: SystemCheckResult | null;
  onToggle: (tool: ToolDefinition) => void;
  onRefresh: () => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="panel">
      <PanelHeader
        eyebrow="Optional tools"
        title="Add visual tools that make AI coding easier to follow."
        action={
          <button className="ghostButton" type="button" onClick={onRefresh}>
            {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
        }
      />

      <div className="workflowMap" aria-label="Why optional tools help">
        <div className="workflowNode">
          <Terminal size={24} aria-hidden="true" />
          <strong>AI coding tool</strong>
          <span>Asks for changes and runs commands.</span>
        </div>
        <ChevronRight size={24} aria-hidden="true" />
        <div className="workflowNode">
          <Code2 size={24} aria-hidden="true" />
          <strong>VS Code</strong>
          <span>Shows files and code changes in an editor.</span>
        </div>
        <ChevronRight size={24} aria-hidden="true" />
        <div className="workflowNode">
          <GitBranch size={24} aria-hidden="true" />
          <strong>GitHub Desktop</strong>
          <span>Saves checkpoints so you can compare, share, or undo work.</span>
        </div>
      </div>

      <div className="optionalExplainers">
        <div className="explainerPanel">
          <div className="explainerCopy">
            <span className="eyebrow">VS Code</span>
            <h2>See exactly what the AI changed.</h2>
            <p>
              VS Code opens your project folder and highlights changed files. Green lines are added, red lines are
              removed, and you can review the changes before keeping them.
            </p>
          </div>
          <VsCodeChangePreview />
        </div>

        <div className="explainerPanel githubExplainer">
          <div className="explainerCopy">
            <span className="eyebrow">GitHub Desktop</span>
            <h2>Save checkpoints while you work.</h2>
            <p>
              Think of GitHub Desktop like a save-history app for a project. Before or after the AI makes changes, you
              can save a checkpoint, compare what changed, go back if needed, and upload the project when you want to
              share it.
            </p>
          </div>
          <div className="githubReasonGrid">
            <div>
              <History size={20} aria-hidden="true" />
              <strong>Keep history</strong>
              <span>Save named checkpoints instead of guessing what changed.</span>
            </div>
            <div>
              <GitBranch size={20} aria-hidden="true" />
              <strong>Compare changes</strong>
              <span>Review added, removed, and edited lines before you continue.</span>
            </div>
            <div>
              <Github size={20} aria-hidden="true" />
              <strong>Share safely</strong>
              <span>Upload your project when you are ready to back it up or share it.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="toolGrid two">
        {OPTIONAL_TOOLS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            selected={selection.optionalTools.includes(tool.id)}
            installed={isDetectionInstalled(systemCheck, tool.id)}
            hideToggle={isDetectionInstalled(systemCheck, tool.id)}
            onToggle={() => onToggle(tool)}
          />
        ))}
      </div>

      <div className="actions split">
        <button className="secondaryButton" type="button" onClick={onSkip}>
          Skip optional tools
        </button>
        <button className="primaryButton" type="button" onClick={onContinue} disabled={selection.optionalTools.length === 0}>
          Review {selection.optionalTools.length} optional
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function VsCodeChangePreview() {
  return (
    <div className="vscodePreview" aria-label="VS Code change preview mockup">
      <div className="vscodeTopBar">
        <span />
        <strong>my-app - Visual Studio Code</strong>
      </div>
      <div className="vscodeBody">
        <aside className="vscodeFiles">
          <div className="vscodeSectionTitle">Explorer</div>
          <div className="fileRow changed">
            <FileText size={14} aria-hidden="true" />
            App.tsx
          </div>
          <div className="fileRow changed">
            <FileText size={14} aria-hidden="true" />
            styles.css
          </div>
          <div className="fileRow">
            <FileText size={14} aria-hidden="true" />
            package.json
          </div>
        </aside>
        <section className="vscodeDiff">
          <div className="diffHeader">
            <strong>App.tsx</strong>
            <span>AI changes</span>
          </div>
          <div className="diffLine removed">- Install all tools by default</div>
          <div className="diffLine added">+ Let me choose which tools to install</div>
          <div className="diffLine added">+ Show optional tools after setup</div>
          <div className="diffLine neutral">  return &lt;CodeReady /&gt;;</div>
        </section>
      </div>
    </div>
  );
}

function ResultsPanel({
  events,
  verification,
  selectedTools,
  onRetry,
  onOptional,
  onRefresh,
}: {
  events: InstallEvent[];
  verification: VerificationResult | null;
  selectedTools: string[];
  onRetry: () => void;
  onOptional: () => void;
  onRefresh: () => void;
}) {
  const failed = events.filter((event) => event.status === "failed");

  return (
    <div className="panel">
      <PanelHeader
        eyebrow="Finish"
        title={failed.length > 0 ? "Some installs need another look." : "Your selected setup is ready to verify."}
      />

      {verification ? <VerificationList results={verification.results} /> : null}

      <StartGuideList selectedTools={selectedTools} />

      {failed.length > 0 ? (
        <div className="eventLog">
          <h2>Install issues</h2>
          {failed.map((event) => (
            <div className="logLine" key={event.stepId}>
              <strong>{event.label}</strong>
              <span>{event.errorSummary || "The command did not complete successfully."}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="actions split">
        <button className="secondaryButton" type="button" onClick={onRefresh}>
          <RefreshCcw size={16} />
          Refresh checks
        </button>
        <div className="actions">
          <button className="secondaryButton" type="button" onClick={onOptional}>
            Optional tools
          </button>
          <button className="primaryButton" type="button" onClick={onRetry}>
            Review again
          </button>
        </div>
      </div>
    </div>
  );
}

function StartGuideList({ selectedTools }: { selectedTools: string[] }) {
  const guides = selectedTools
    .filter((id) => id in START_GUIDES)
    .map((id) => START_GUIDES[id]);

  if (guides.length === 0) {
    return (
      <div className="nextSteps">
        <h2>Setup notes</h2>
        <p>CodeReady does not store account details, API keys, or login credentials.</p>
      </div>
    );
  }

  return (
    <div className="startGuideList">
      <div className="guideIntro">
        <span className="eyebrow">Connect and start</span>
        <h2>Open a terminal, sign in, then ask your first question.</h2>
        <p>Account sign-in is the main path. CodeReady does not store account details or API keys.</p>
      </div>

      {guides.map((guide) => (
        <StartGuideCard guide={guide} key={guide.id} />
      ))}
    </div>
  );
}

function StartGuideCard({ guide }: { guide: StartGuide }) {
  return (
    <div className="startGuideCard">
      <div className="guideCopy">
        <div>
          <span className="eyebrow">{guide.name}</span>
          <h2>{guide.accountTitle}</h2>
        </div>
        <ol>
          {guide.accountSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {guide.fallback ? <p>{guide.fallback}</p> : null}
        {guide.keyNote ? <p>{guide.keyNote}</p> : null}
        <a href={guide.docsUrl}>
          Official guide <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>

      <div className="guideVisual" aria-label={`${guide.name} start guide preview`}>
        <div className="mockWindow terminalMock">
          <div className="mockHeader">
            <span />
            <span />
            <span />
          </div>
          <div className="mockBody">
            <code>PS C:\Projects\my-app&gt; {guide.command}</code>
            <span>Opening browser sign-in...</span>
            <span>After sign-in, try:</span>
            <code>{guide.firstPrompt}</code>
          </div>
        </div>
        <div className="mockWindow browserMock">
          <div className="mockHeader wide">
            <span />
            <strong>Account sign-in</strong>
          </div>
          <div className="browserContent">
            <ShieldCheck size={24} aria-hidden="true" />
            <strong>Allow {guide.name}</strong>
            <span>Finish in your browser, then return to the terminal.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="panelHeader">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  note,
}: {
  icon: typeof Bot;
  title: string;
  note?: string;
}) {
  return (
    <div className="sectionTitle">
      <Icon size={18} aria-hidden="true" />
      <h2>{title}</h2>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

function ToolCard({
  tool,
  selected,
  installed,
  hideToggle = false,
  onToggle,
}: {
  tool: ToolDefinition;
  selected: boolean;
  installed: boolean;
  hideToggle?: boolean;
  onToggle: () => void;
}) {
  const Icon = tool.id === "github-desktop" ? Github : tool.category === "optional" ? Code2 : Terminal;
  const readOnly = hideToggle && installed;

  return (
    <button
      className={clsx("toolCard", selected && "selected", readOnly && "installedOnly")}
      type="button"
      onClick={readOnly ? undefined : onToggle}
      disabled={readOnly}
    >
      <span className="toolIcon">
        <Icon size={22} aria-hidden="true" />
      </span>
      <span className="toolContent">
        <span className="toolTitle">
          <strong>{tool.name}</strong>
          {installed ? <span className="installedBadge">Installed</span> : null}
        </span>
        <span>{tool.plainLanguageDescription}</span>
        <span className="commandPreview">{tool.installRecipes[0]?.commands[0]}</span>
      </span>
      {hideToggle ? null : (
        <span className="checkbox" aria-hidden="true">
          {selected ? <Check size={16} /> : null}
        </span>
      )}
    </button>
  );
}

function SystemGrid({ check, compact = false }: { check: SystemCheckResult | null; compact?: boolean }) {
  const detections = compact ? check?.detections.slice(0, 6) : check?.detections;

  return (
    <div className={clsx("systemGrid", compact && "compact")}>
      {(detections ?? skeletonDetections()).map((item) => (
        <div className={clsx("systemItem", item.installed && "ready")} key={item.id}>
          <StatusIcon status={item.installed ? "success" : "pending"} />
          <div>
            <strong>{item.name}</strong>
            <span>{item.version || item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandList({ plan }: { plan: InstallPlan }) {
  return (
    <div className="commandList">
      {plan.steps.map((step) => (
        <div className="commandRow" key={step.id}>
          <Wrench size={18} aria-hidden="true" />
          <div>
            <strong>{step.label}</strong>
            <code>{step.command.join(" ")}</code>
          </div>
        </div>
      ))}
    </div>
  );
}

function VerificationList({ results }: { results: DetectionResult[] }) {
  return (
    <div className="verificationList">
      {results.map((item) => (
        <div className={clsx("verifyItem", item.installed && "ready")} key={item.id}>
          <StatusIcon status={item.installed ? "success" : "failed"} />
          <div>
            <strong>{item.name}</strong>
            <span>{item.version || item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: "pending" | "running" | "success" | "failed" | "skipped" }) {
  if (status === "running") {
    return <Loader2 className="statusIcon spin" size={18} aria-hidden="true" />;
  }

  if (status === "success") {
    return <Check className="statusIcon success" size={18} aria-hidden="true" />;
  }

  if (status === "failed") {
    return <CircleAlert className="statusIcon failed" size={18} aria-hidden="true" />;
  }

  return <span className="statusDot" aria-hidden="true" />;
}

function isDetectionInstalled(check: SystemCheckResult | null, id: string) {
  return Boolean(check?.detections.find((item) => item.id === id)?.installed);
}

function filterSystemCheck(check: SystemCheckResult, selectedAiTools: string[]): SystemCheckResult {
  return {
    ...check,
    detections: relevantDetections(check, selectedAiTools),
  };
}

function relevantDetections(check: SystemCheckResult, selectedAiTools: string[]): DetectionResult[] {
  const ids = new Set(["winget", "git", ...selectedAiTools]);
  if (selectedAiTools.some((id) => id === "codex" || id === "gemini")) {
    ids.add("node");
    ids.add("npm");
  }
  return check.detections.filter((item) => ids.has(item.id));
}

function skeletonDetections(): DetectionResult[] {
  return ["winget", "git", "node", "npm", "claude", "codex"].map((id) => ({
    id,
    name: id,
    installed: false,
    version: null,
    detail: "Checking...",
  }));
}

function makeBrowserMockCheck(): SystemCheckResult {
  return {
    platform: "windows",
    arch: "x86_64",
    isWindows: true,
    wingetRepairUrl: "https://learn.microsoft.com/windows/package-manager/winget/",
    detections: [
      { id: "winget", name: "Windows Package Manager", installed: true, version: "preview", detail: "Ready" },
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
}
