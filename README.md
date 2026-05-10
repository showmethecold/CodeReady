# CodeReady

CodeReady is a Windows-first setup wizard for installing AI coding tools without memorizing Node.js, npm, PATH, terminal, or package-manager commands.

The app uses a curated catalog of official install recipes. It shows the exact commands before running them, verifies the installed commands afterward, and does not store API keys or provider login credentials.

## v1 Tools

- Claude Code
- OpenAI Codex
- Gemini CLI
- VS Code, optional
- GitHub Desktop, optional

## Development

```powershell
npm install
npm run dev
npm run tauri dev
```

Run checks:

```powershell
npm test
npm run build
cd src-tauri
cargo test
```
