---
title: Installation
description: How to install imugi
---

## Requirements

- **Node.js** >= 18
- **Chromium** (installed automatically by `imugi init`)

## Install

```bash
npm install -g imugi-ai
```

## One-Click Setup

Run the init command to auto-detect your project, install Playwright's Chromium browser, and create a default config:

```bash
imugi init
```

This will:
1. Detect your framework (React, Vue, Svelte, etc.)
2. Detect your CSS method (Tailwind, CSS Modules, etc.)
3. Install Playwright Chromium for screenshot capture
4. Create `imugi.config.json` with sensible defaults

## Authentication

imugi uses Claude (Anthropic) for code generation and vision analysis. You need one of:

### Option A: API Key
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Option B: OAuth (Interactive Agent only)
```bash
imugi auth login
```

This opens a browser for OAuth authentication. Tokens are stored securely at `~/.imugi/auth.json` with restricted permissions.

## Verify Installation

```bash
imugi --version
imugi --help
```

Next: [Quick Start](/getting-started/quickstart/)
