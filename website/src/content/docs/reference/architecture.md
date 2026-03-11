---
title: Architecture
description: imugi codebase structure
---

## Project Structure

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
│   ├── context.ts      # Project tech stack detection
│   ├── report.ts       # HTML report generation
│   └── figma.ts        # Figma URL parsing + API export
├── llm/
│   ├── client.ts       # Anthropic SDK wrapper + retry logic
│   └── prompts.ts      # Prompt engineering
├── config/
│   ├── schema.ts       # Zod validation
│   ├── loader.ts       # Config loading (file + env + CLI)
│   └── defaults.ts     # Default configuration
└── types.ts            # Shared type definitions
```

## Key Components

### Boulder Loop (`agent/loop.ts`)

The core iteration loop:

1. Read design image + extract metadata
2. Generate initial code (or use existing)
3. For each iteration:
   - Capture screenshot via Playwright
   - Compare against design (SSIM + pixel diff)
   - Run Claude Vision analysis (if SSIM < 0.98)
   - Compute composite score
   - Analyze differences and classify regions
   - Select strategy (full regen vs surgical patch)
   - Generate patched code via Claude
   - Write files to disk
4. Stop when: score >= threshold, max iterations, timeout, or convergence

### Comparator (`core/comparator.ts`)

Multi-signal image comparison:
- **SSIM** via `ssim.js` — structural similarity
- **pixelmatch** — pixel-level diff with configurable threshold
- **Heatmap** — visual diff overlay
- **Crop pairs** — zoomed-in comparison of diff regions

### Renderer (`core/renderer.ts`)

Playwright-based screenshot engine:
- Launches headless Chromium
- Captures full-page or viewport screenshots
- Supports HMR (Hot Module Reload) recapture
- Resizes screenshots to match design dimensions

### Patcher (`core/patcher.ts`)

Two patching strategies:
- **Full regeneration** — sends design + screenshot + heatmap to Claude, gets complete rewrite
- **Surgical patch** — sends cropped diff regions, gets targeted fixes merged with existing code

### MCP Server (`mcp/server.ts`)

Exposes 6 tools over stdio transport. Manages child processes (dev servers) with proper cleanup on exit.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js >= 18 |
| Build | tsup (ESM output) |
| Test | Vitest (282 tests, 51%+ coverage) |
| Lint | ESLint + Prettier |
| Screenshots | Playwright Chromium |
| Image Processing | Sharp |
| AI | Anthropic Claude API |
| CLI | Commander.js |
| Terminal UI | Ink (React) |
| MCP | @modelcontextprotocol/sdk |
