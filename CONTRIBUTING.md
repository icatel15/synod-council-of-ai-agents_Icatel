# Contributing to Council of AI Agents

Thank you for your interest in contributing! This guide will help you get set up.

## Development Setup

### Prerequisites

1. **macOS** 10.15+ or **Windows** 10+
2. **Rust** 1.77+ via [rustup](https://rustup.rs/)
3. **Node.js** 18+ from [nodejs.org](https://nodejs.org/)
4. **Tauri CLI v2**: `cargo install tauri-cli --version "^2"`
5. **macOS only**: Xcode Command Line Tools (`xcode-select --install`)

### Getting Started

```bash
git clone https://github.com/your-username/council-of-ai-agents.git
cd council-of-ai-agents
npm install
cargo tauri dev
```

### Project Layout

- `src/` - React/TypeScript frontend
- `src-tauri/src/` - Rust backend
  - `commands/` - Tauri IPC command handlers
  - `providers/` - API provider implementations (Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Together, Cohere)
  - `models/` - Shared data structures

### Platform-Specific Code

Credential storage uses conditional compilation (`#[cfg(target_os)]`):
- `commands/keychain_macos.rs` — macOS Keychain via `security-framework`
- `commands/keychain_windows.rs` — Windows Credential Manager via `keyring`
- `commands/keychain.rs` — Shared logic (API, cache, Tauri commands)

## Adding a New AI Provider

See [docs/ADDING_PROVIDERS.md](docs/ADDING_PROVIDERS.md) for a step-by-step tutorial.

## Code Style

### TypeScript
- Functional components with hooks
- Zustand for state management
- Tailwind CSS for styling (use CSS variables from `globals.css`)

### Rust
- Standard `rustfmt` formatting
- Use `anyhow::Result` for error handling
- Streaming responses via Tauri events

## Pull Request Process

1. Fork and create a feature branch from `main`
2. Make your changes
3. Ensure `cargo check` and `npx tsc --noEmit` both pass (CI runs on both macOS and Windows)
4. Write a clear PR description explaining what and why
5. Submit for review

## Reporting Issues

Use the GitHub issue templates:
- **Bug Report** - For bugs and unexpected behavior
- **Feature Request** - For new features and enhancements
