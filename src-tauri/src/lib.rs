use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command;

const WINGET_REPAIR_URL: &str = "https://learn.microsoft.com/windows/package-manager/winget/";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCheckResult {
    pub platform: String,
    pub arch: String,
    pub is_windows: bool,
    pub detections: Vec<DetectionResult>,
    pub winget_repair_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub id: String,
    pub label: String,
    pub tool_id: String,
    pub command: Vec<String>,
    pub requires_admin: bool,
    pub status: StepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub blocked: bool,
    pub block_reason: Option<String>,
    pub steps: Vec<InstallStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallEvent {
    pub step_id: String,
    pub label: String,
    pub status: StepStatus,
    pub stdout_summary: String,
    pub error_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub results: Vec<DetectionResult>,
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
}

impl StepStatus {
    fn as_event_status(success: bool) -> Self {
        if success {
            StepStatus::Success
        } else {
            StepStatus::Failed
        }
    }
}

#[tauri::command]
fn check_system() -> SystemCheckResult {
    collect_system_check()
}

#[tauri::command(rename_all = "camelCase")]
fn get_install_plan(selected_ai_tools: Vec<String>, selected_optional_tools: Vec<String>) -> InstallPlan {
    build_install_plan(&selected_ai_tools, &selected_optional_tools, &collect_system_check())
}

#[tauri::command]
fn run_install(plan: InstallPlan) -> Vec<InstallEvent> {
    if plan.blocked {
        return vec![InstallEvent {
            step_id: "blocked".to_string(),
            label: "Install blocked".to_string(),
            status: StepStatus::Failed,
            stdout_summary: String::new(),
            error_summary: plan
                .block_reason
                .unwrap_or_else(|| "CodeReady cannot run this install plan.".to_string()),
        }];
    }

    if !collect_system_check()
        .detections
        .iter()
        .any(|item| item.id == "winget" && item.installed)
    {
        return vec![InstallEvent {
            step_id: "winget-missing".to_string(),
            label: "Windows Package Manager missing".to_string(),
            status: StepStatus::Failed,
            stdout_summary: String::new(),
            error_summary: "Windows Package Manager is required before CodeReady can install tools.".to_string(),
        }];
    }

    plan.steps.iter().map(execute_step).collect()
}

#[tauri::command(rename_all = "camelCase")]
fn run_install_step(step: InstallStep) -> InstallEvent {
    if !collect_system_check()
        .detections
        .iter()
        .any(|item| item.id == "winget" && item.installed)
    {
        return InstallEvent {
            step_id: step.id,
            label: step.label,
            status: StepStatus::Failed,
            stdout_summary: String::new(),
            error_summary: "Windows Package Manager is required before CodeReady can install tools.".to_string(),
        };
    }

    execute_step(&step)
}

#[tauri::command(rename_all = "camelCase")]
fn verify_tools(selected_tools: Vec<String>) -> VerificationResult {
    let check = collect_system_check();
    let selected: HashSet<&str> = selected_tools.iter().map(String::as_str).collect();

    VerificationResult {
        results: check
            .detections
            .into_iter()
            .filter(|item| selected.contains(item.id.as_str()))
            .collect(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_system,
            get_install_plan,
            run_install,
            run_install_step,
            verify_tools
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeReady");
}

fn execute_step(step: &InstallStep) -> InstallEvent {
    let output = run_command(&step.command);

    InstallEvent {
        step_id: step.id.clone(),
        label: step.label.clone(),
        status: StepStatus::as_event_status(output.success),
        stdout_summary: summarize_output(&redact_sensitive(&output.stdout)),
        error_summary: summarize_output(&redact_sensitive(&output.stderr)),
    }
}

fn collect_system_check() -> SystemCheckResult {
    let is_windows = cfg!(windows);
    let winget = detect_command("winget", &["--version"], "Windows Package Manager");
    let has_winget = winget.installed;

    let mut detections = vec![
        winget,
        detect_command("git", &["--version"], "Git for Windows"),
        detect_command("node", &["--version"], "Node.js"),
        detect_command("npm", &["--version"], "npm"),
        detect_command("claude", &["--version"], "Claude Code"),
        detect_command("codex", &["--version"], "OpenAI Codex"),
        detect_command("gemini", &["--version"], "Gemini CLI"),
    ];

    detections.push(detect_gui_tool(
        "vscode",
        "Visual Studio Code",
        "Microsoft.VisualStudioCode",
        has_winget,
        Some(("code", &["--version"])),
    ));
    detections.push(detect_gui_tool(
        "github-desktop",
        "GitHub Desktop",
        "GitHub.GitHubDesktop",
        has_winget,
        None,
    ));

    SystemCheckResult {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_windows,
        detections,
        winget_repair_url: WINGET_REPAIR_URL.to_string(),
    }
}

fn build_install_plan(
    selected_ai_tools: &[String],
    selected_optional_tools: &[String],
    check: &SystemCheckResult,
) -> InstallPlan {
    if !check.is_windows {
        return InstallPlan {
            blocked: true,
            block_reason: Some("CodeReady v1 only supports Windows.".to_string()),
            steps: vec![],
        };
    }

    if !is_installed(check, "winget") {
        return InstallPlan {
            blocked: true,
            block_reason: Some(
                "Windows Package Manager is required before CodeReady can install tools.".to_string(),
            ),
            steps: vec![],
        };
    }

    let selected_ai: HashSet<&str> = selected_ai_tools.iter().map(String::as_str).collect();
    let selected_optional: HashSet<&str> = selected_optional_tools.iter().map(String::as_str).collect();
    let needs_node = selected_ai.contains("codex") || selected_ai.contains("gemini");
    let mut steps = vec![];

    push_if_missing(
        &mut steps,
        check,
        "git",
        "Install Git for Windows",
        vec!["winget", "install", "-e", "--id", "Git.Git"],
    );

    if needs_node {
        push_if_missing(
            &mut steps,
            check,
            "node",
            "Install Node.js LTS",
            vec!["winget", "install", "-e", "--id", "OpenJS.NodeJS.LTS"],
        );
    }

    if selected_ai.contains("claude") {
        push_if_missing(
            &mut steps,
            check,
            "claude",
            "Install Claude Code",
            vec!["winget", "install", "-e", "--id", "Anthropic.ClaudeCode"],
        );
    }

    if selected_ai.contains("codex") {
        push_if_missing(
            &mut steps,
            check,
            "codex",
            "Install OpenAI Codex",
            vec!["npm", "install", "-g", "@openai/codex"],
        );
    }

    if selected_ai.contains("gemini") {
        push_if_missing(
            &mut steps,
            check,
            "gemini",
            "Install Gemini CLI",
            vec!["npm", "install", "-g", "@google/gemini-cli"],
        );
    }

    if selected_optional.contains("vscode") {
        push_if_missing(
            &mut steps,
            check,
            "vscode",
            "Install Visual Studio Code",
            vec!["winget", "install", "-e", "--id", "Microsoft.VisualStudioCode"],
        );
    }

    if selected_optional.contains("github-desktop") {
        push_if_missing(
            &mut steps,
            check,
            "github-desktop",
            "Install GitHub Desktop",
            vec!["winget", "install", "-e", "--id", "GitHub.GitHubDesktop"],
        );
    }

    InstallPlan {
        blocked: false,
        block_reason: None,
        steps,
    }
}

fn push_if_missing(
    steps: &mut Vec<InstallStep>,
    check: &SystemCheckResult,
    tool_id: &str,
    label: &str,
    command: Vec<&str>,
) {
    if is_installed(check, tool_id) {
        return;
    }

    let step_prefix = if ["git", "node"].contains(&tool_id) {
        "prereq"
    } else {
        "tool"
    };

    steps.push(InstallStep {
        id: format!("{step_prefix}-{tool_id}"),
        label: label.to_string(),
        tool_id: tool_id.to_string(),
        command: command.into_iter().map(str::to_string).collect(),
        requires_admin: false,
        status: StepStatus::Pending,
    });
}

fn is_installed(check: &SystemCheckResult, id: &str) -> bool {
    check
        .detections
        .iter()
        .any(|item| item.id == id && item.installed)
}

fn detect_command(command: &str, args: &[&str], name: &str) -> DetectionResult {
    let output = run_command_parts(command, args);
    let combined = first_non_empty_line(&output.stdout).or_else(|| first_non_empty_line(&output.stderr));

    DetectionResult {
        id: command.to_string(),
        name: name.to_string(),
        installed: output.success,
        version: combined,
        detail: if output.success {
            "Ready".to_string()
        } else {
            "Missing or not available on PATH".to_string()
        },
    }
}

fn detect_gui_tool(
    id: &str,
    name: &str,
    winget_id: &str,
    has_winget: bool,
    command_check: Option<(&str, &[&str])>,
) -> DetectionResult {
    if let Some((command, args)) = command_check {
        let detected = detect_command(command, args, name);
        if detected.installed {
            return DetectionResult {
                id: id.to_string(),
                ..detected
            };
        }
    }

    if has_winget {
        let output = run_command_parts("winget", &["list", "-e", "--id", winget_id]);
        let installed = output.success && output.stdout.contains(winget_id);
        return DetectionResult {
            id: id.to_string(),
            name: name.to_string(),
            installed,
            version: if installed { Some("Installed".to_string()) } else { None },
            detail: if installed {
                "Ready".to_string()
            } else {
                "Missing".to_string()
            },
        };
    }

    DetectionResult {
        id: id.to_string(),
        name: name.to_string(),
        installed: false,
        version: None,
        detail: "Cannot check without Windows Package Manager".to_string(),
    }
}

#[derive(Debug, Default)]
struct CommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

fn run_command(command: &[String]) -> CommandOutput {
    if command.is_empty() {
        return CommandOutput {
            success: false,
            stdout: String::new(),
            stderr: "Empty command".to_string(),
        };
    }

    let args: Vec<&str> = command.iter().skip(1).map(String::as_str).collect();
    run_command_parts(&command[0], &args)
}

fn run_command_parts(program: &str, args: &[&str]) -> CommandOutput {
    let mut command = Command::new(program);
    command.args(args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    match command.output() {
        Ok(output) => CommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(err) => CommandOutput {
            success: false,
            stdout: String::new(),
            stderr: err.to_string(),
        },
    }
}

fn first_non_empty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(120).collect())
}

fn summarize_output(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_sensitive(value: &str) -> String {
    let mut redacted = value.to_string();
    let replacements = HashMap::from([
        ("npm_", "[redacted-npm-token]"),
        ("sk-", "[redacted-api-key]"),
        ("api_key", "[redacted-api-key]"),
        ("authorization", "[redacted-auth]"),
        ("password", "[redacted-password]"),
        ("token", "[redacted-token]"),
    ]);

    for (needle, replacement) in replacements {
        redacted = redacted.replace(needle, replacement);
        redacted = redacted.replace(&needle.to_ascii_uppercase(), replacement);
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        redacted = redacted.replace(&home, "%USERPROFILE%");
    }

    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_with(installed: &[&str]) -> SystemCheckResult {
        let ids = [
            ("winget", "Windows Package Manager"),
            ("git", "Git for Windows"),
            ("node", "Node.js"),
            ("npm", "npm"),
            ("claude", "Claude Code"),
            ("codex", "OpenAI Codex"),
            ("gemini", "Gemini CLI"),
            ("vscode", "Visual Studio Code"),
            ("github-desktop", "GitHub Desktop"),
        ];
        let installed: HashSet<&str> = installed.iter().copied().collect();

        SystemCheckResult {
            platform: "windows".to_string(),
            arch: "x86_64".to_string(),
            is_windows: true,
            winget_repair_url: WINGET_REPAIR_URL.to_string(),
            detections: ids
                .iter()
                .map(|(id, name)| DetectionResult {
                    id: id.to_string(),
                    name: name.to_string(),
                    installed: installed.contains(id),
                    version: None,
                    detail: String::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn claude_only_does_not_install_node() {
        let check = check_with(&["winget"]);
        let plan = build_install_plan(&["claude".to_string()], &[], &check);
        let tool_ids: Vec<_> = plan.steps.iter().map(|step| step.tool_id.as_str()).collect();

        assert_eq!(tool_ids, vec!["git", "claude"]);
    }

    #[test]
    fn gemini_installs_node_first() {
        let check = check_with(&["winget"]);
        let plan = build_install_plan(&["gemini".to_string()], &[], &check);
        let tool_ids: Vec<_> = plan.steps.iter().map(|step| step.tool_id.as_str()).collect();

        assert_eq!(tool_ids, vec!["git", "node", "gemini"]);
    }

    #[test]
    fn optional_tools_are_added_only_when_selected() {
        let check = check_with(&["winget"]);
        let plan = build_install_plan(&[], &["vscode".to_string(), "github-desktop".to_string()], &check);
        let tool_ids: Vec<_> = plan.steps.iter().map(|step| step.tool_id.as_str()).collect();

        assert_eq!(tool_ids, vec!["git", "vscode", "github-desktop"]);
    }

    #[test]
    fn missing_winget_blocks_install_plan() {
        let check = check_with(&[]);
        let plan = build_install_plan(&["claude".to_string()], &[], &check);

        assert!(plan.blocked);
        assert!(plan.steps.is_empty());
    }

    #[test]
    fn redacts_common_secret_words() {
        let value = redact_sensitive("token=abc\npassword=secret\nC:\\Users\\person\\file");

        assert!(value.contains("[redacted-token]"));
        assert!(value.contains("[redacted-password]"));
    }
}
