# imugi

**AI-powered design-to-code tool with visual verification.**

Give AI eyes to see your frontend. imugi captures screenshots, compares them pixel-by-pixel against design images, and iterates until the code matches the design.

## How it works

```
Design Image → Code Generation → Screenshot → Compare → Analyze → Patch → Repeat
                                                                            ↑     |
                                                                            └─────┘
                                                                         until 95%+ match
```

imugi uses **SSIM** (Structural Similarity) + **pixelmatch** + **Claude Vision** to compare design images against rendered output, then automatically patches the code to close the gap.

## Features

- **Visual comparison engine** — SSIM + pixel diff + Claude Vision scoring
- **Boulder Loop** — Iterative code improvement until design match threshold is met
- **MCP Server** — Integrate with Claude Code, Cursor, or any MCP-compatible AI tool
- **Project detection** — Auto-detects framework (React/Vue/Svelte), CSS method (Tailwind/modules/styled-components), TypeScript, and more
- **Interactive agent** — Terminal UI with real-time iteration progress
- **Smart patching** — Full regeneration for low scores, surgical patches for high scores

## Install

```bash
npm install -g imugi
```

**Prerequisites:** Node.js >= 18, [Playwright browsers](https://playwright.dev/docs/browsers) will be installed automatically.

## Quick start

### As MCP Server (for Claude Code / Cursor)

```bash
imugi mcp
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "imugi": {
      "command": "npx",
      "args": ["-y", "imugi", "mcp"]
    }
  }
}
```

### As Interactive Agent

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start the agent
imugi
```

Then type a request with a design image:

```
> implement this design ./login-design.png
```

### One-shot generation

```bash
imugi generate ./design.png --output src/app/page.tsx
```

### Compare only

```bash
imugi compare ./design.png --screenshot ./current.png
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `imugi_capture` | Screenshot a URL |
| `imugi_compare` | Compare design vs screenshot (SSIM + pixel diff + heatmap) |
| `imugi_analyze` | Analyze differences with actionable fix suggestions |
| `imugi_detect` | Detect project tech stack (framework, CSS, language) |
| `imugi_serve` | Start a dev server |

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

### Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `IMUGI_API_KEY` | Alternative API key |
| `IMUGI_THRESHOLD` | Similarity threshold (0.8-0.99) |
| `IMUGI_MAX_ITERATIONS` | Max iterations (1-50) |
| `IMUGI_PORT` | Dev server port |

## Architecture

```
src/
├── cli.ts              # CLI entry point (Commander.js)
├── mcp/server.ts       # MCP server (stdio transport)
├── agent/
│   ├── auth.ts         # OAuth PKCE + API key auth
│   ├── loop.ts         # Boulder Loop — iterative improvement
│   ├── session.ts      # State management
│   └── ui.tsx          # Terminal UI (ink/React)
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

## Comparison algorithm

The composite score combines multiple signals:

- **SSIM** — Structural similarity (luminance, contrast, structure)
- **Pixel diff** — Raw pixel-level comparison via pixelmatch
- **Claude Vision** — AI-powered visual assessment (optional, for scores < 0.98)

Strategy selection based on score:
- Score < 0.7 → **Full regeneration** (rewrite the code)
- Score >= 0.7 → **Surgical patch** (targeted fixes only)

## Development

```bash
git clone https://github.com/M00N7682/imugi.git
cd imugi
npm install
npm run build
npm test
```

## License

MIT
