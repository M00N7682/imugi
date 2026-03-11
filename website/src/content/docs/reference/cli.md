---
title: CLI Commands
description: Complete reference for all imugi CLI commands
---

## `imugi`

Start the interactive agent with terminal UI.

```bash
imugi [options]
```

| Flag | Description |
|------|-------------|
| `--api-key <key>` | Anthropic API key |
| `--verbose` | Enable debug output |

## `imugi init`

One-click project setup.

```bash
imugi init
```

Detects your project stack, installs Playwright Chromium, and creates `imugi.config.json`.

## `imugi generate`

Generate code from a design image.

```bash
imugi generate <design-image> [options]
```

| Flag | Description |
|------|-------------|
| `--output, -o <path>` | Output file path |
| `--api-key <key>` | Anthropic API key |
| `--threshold <n>` | Similarity threshold (default: 0.95) |
| `--max-iterations <n>` | Max iterations (default: 10) |
| `--url <url>` | Dev server URL |
| `--verbose` | Enable debug output |

## `imugi compare`

Compare a design image against a screenshot or live URL.

```bash
imugi compare <design-image> [options]
```

| Flag | Description |
|------|-------------|
| `--screenshot, -s <path-or-url>` | Screenshot file path or URL to capture |
| `--threshold <n>` | Similarity threshold |
| `--width <n>` | Viewport width |
| `--height <n>` | Viewport height |
| `--report <dir>` | Generate HTML report to directory |

## `imugi figma`

Export a Figma frame.

```bash
imugi figma <url> [options]
```

| Flag | Description |
|------|-------------|
| `--output, -o <path>` | Output file path |
| `--scale, -s <n>` | Export scale 1-4 (default: 2) |
| `--compare` | Compare against dev server after export |

Requires `FIGMA_TOKEN` environment variable.

## `imugi mcp`

Start the MCP server.

```bash
imugi mcp
```

Runs over stdio transport for integration with Claude Code, Cursor, etc.

## `imugi auth`

Manage authentication.

```bash
imugi auth login     # OAuth login via browser
imugi auth logout    # Remove stored token
imugi auth status    # Show current auth status
```
