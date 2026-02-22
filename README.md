<div align="center">

<img src="https://raw.githubusercontent.com/M00N7682/imugi/main/assets/hero.png" alt="imugi" width="200" />

# imugi

[![npm version](https://img.shields.io/npm/v/imugi-ai?color=cb3837&labelColor=black&style=flat-square)](https://www.npmjs.com/package/imugi-ai)
[![GitHub stars](https://img.shields.io/github/stars/M00N7682/imugi?style=flat-square&color=ffcb47&labelColor=black)](https://github.com/M00N7682/imugi/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?labelColor=black&style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?labelColor=black&style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Give AI eyes to see your frontend.**

*Design-to-code with visual verification. imugi captures screenshots, compares them pixel-by-pixel against your design, and iterates until the code matches — automatically.*

[Get Started](#quick-start) · [MCP Tools](#mcp-tools) · [Configuration](#configuration) · [Contributing](CONTRIBUTING.md)

<br />

<img src="https://raw.githubusercontent.com/M00N7682/imugi/main/assets/logo.png" alt="imugi logo" width="400" />

</div>

---

## How it works

```
Design Image → Code Generation → Screenshot → Compare → Analyze → Patch
                                                                     ↓
                                                              Score ≥ 95%? → Done!
                                                                     ↓ No
                                                                   Repeat
```

imugi uses **SSIM** (Structural Similarity) + **pixelmatch** + **Claude Vision** to compare design images against live rendered output, then automatically patches the code to close the gap. This is the **Boulder Loop** — it keeps rolling until your code matches the design.

---

## Why imugi?

| | Without imugi | With imugi |
|---|---|---|
| **Design match** | Eyeball it, hope for the best | Pixel-level verification with composite scoring |
| **Iteration** | Manual back-and-forth | Automated loop until 95%+ match |
| **Framework support** | Set up each project manually | Auto-detects React, Vue, Svelte, Tailwind, and more |
| **AI integration** | Copy-paste between tools | Native MCP server for Claude Code / Cursor |
| **Strategy** | One-size-fits-all | Smart switching: full regen for low scores, surgical patches for high scores |

---

## Quick Start

### Step 1: Install

```bash
npm install -g imugi-ai

# Playwright requires a browser binary — install Chromium:
npx playwright install chromium
```

### Step 2: Add to your AI tool

Add imugi as an MCP server in your Claude Code or Cursor config:

```json
{
  "mcpServers": {
    "imugi": {
      "command": "npx",
      "args": ["-y", "imugi-ai", "mcp"]
    }
  }
}
```

### Step 3: Build something

Ask your AI to implement a design — imugi handles the visual verification loop.

```
Implement this login page design. Here's the reference: ./login-design.png
```

That's it. imugi captures, compares, and patches until the output matches your design.

---

## Example: Design to Code

A terminal-inspired hero section — designed in Pencil, implemented by imugi.

<div align="center">
<img src="https://raw.githubusercontent.com/M00N7682/imugi/main/assets/example-comparison.png" alt="imugi — design vs implementation comparison" width="820" />
</div>

> Dark mode terminal aesthetic with JetBrains Mono, `#10B981` green accent, nav bar, hero CTA, 4-step flow diagram, MCP tools grid, and footer — pixel-perfect match from design to code.

See the full example at [`examples/hero-section/`](examples/hero-section/).

---

## Features

- **Visual Comparison Engine** — SSIM + pixel diff + Claude Vision scoring with heatmap output
- **Boulder Loop** — Iterative code improvement that keeps going until the design match threshold is met
- **MCP Server** — Drop-in integration with Claude Code, Cursor, or any MCP-compatible AI tool
- **Project Detection** — Auto-detects framework (React/Vue/Svelte), CSS method (Tailwind/modules/styled-components), language (TypeScript/JavaScript)
- **Interactive Agent** — Terminal UI with real-time iteration progress (powered by Ink)
- **Smart Patching** — Full regeneration for scores below 0.7, surgical patches for scores above 0.7

---

## Usage Modes

### As MCP Server (Recommended)

```bash
imugi mcp
```

Works with Claude Code, Cursor, and any MCP-compatible tool. The AI calls imugi tools directly.

### As Interactive Agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
imugi
```

Then describe what you want:

```
> implement this design ./login-design.png
```

### One-shot Generation

```bash
imugi generate ./design.png --output src/app/page.tsx
```

### Compare Only

```bash
imugi compare ./design.png --screenshot ./current.png
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `imugi_capture` | Screenshot a URL via headless Chromium |
| `imugi_compare` | Compare design vs screenshot — returns SSIM score, pixel diff, and heatmap |
| `imugi_analyze` | Analyze visual differences with actionable fix suggestions |
| `imugi_detect` | Detect project tech stack (framework, CSS, language) |
| `imugi_serve` | Start a dev server for the target project |

---

## Comparison Algorithm

The composite score combines multiple signals:

| Signal | What it measures |
|--------|-----------------|
| **SSIM** | Structural similarity — luminance, contrast, structure |
| **Pixel diff** | Raw pixel-level comparison via pixelmatch |
| **Claude Vision** | AI-powered visual assessment (activated for scores < 0.98) |

Strategy selection based on score:

| Score | Strategy | Description |
|-------|----------|-------------|
| < 0.7 | **Full regeneration** | Rewrite the code from scratch |
| >= 0.7 | **Surgical patch** | Targeted fixes only |

---

## Configuration

Create `imugi.config.json` in your project root:

```json
{
  "comparison": {
    "threshold": 0.95,
    "maxIterations": 10
  },
  "rendering": {
    "port": 3000,
    "viewport": { "width": 1440, "height": 900 }
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `IMUGI_API_KEY` | Alternative API key |
| `IMUGI_THRESHOLD` | Similarity threshold (0.8–0.99) |
| `IMUGI_MAX_ITERATIONS` | Max iterations (1–50) |
| `IMUGI_PORT` | Dev server port |

---

## Architecture

```
src/
├── cli.ts              # CLI entry point (Commander.js)
├── mcp/server.ts       # MCP server (stdio transport)
├── agent/
│   ├── auth.ts         # OAuth PKCE + API key auth
│   ├── loop.ts         # Boulder Loop — iterative improvement
│   ├── session.ts      # State management
│   └── ui.tsx          # Terminal UI (Ink/React)
├── core/
│   ├── comparator.ts   # SSIM + pixelmatch + heatmap
│   ├── analyzer.ts     # Diff classification + strategy
│   ├── renderer.ts     # Playwright screenshot engine
│   ├── patcher.ts      # Code generation + patching
│   └── context.ts      # Project tech stack detection
├── llm/
│   ├── client.ts       # Anthropic SDK wrapper
│   └── prompts.ts      # Prompt engineering
├── config/
│   ├── schema.ts       # Zod validation
│   ├── loader.ts       # Config loading (file + env + CLI)
│   └── defaults.ts     # Default configuration
└── types.ts            # Shared type definitions
```

---

## Development

```bash
git clone https://github.com/M00N7682/imugi.git
cd imugi
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE)
