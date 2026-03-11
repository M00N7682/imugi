---
title: MCP Server Setup
description: How to use imugi as an MCP server with Claude Code or Cursor
---

imugi includes a built-in MCP (Model Context Protocol) server that lets AI tools call imugi's visual verification tools directly.

> **No API key required.** In MCP mode, imugi only provides visual capabilities (screenshot, comparison, heatmap). Your AI editor handles the reasoning and code generation using its own model. This means zero additional API cost — just your existing Claude Code or Cursor subscription.

## Configuration

### Claude Code

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project-level):

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

### Cursor

Add to your Cursor MCP settings:

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

## Available Tools

Once connected, your AI tool has access to 6 tools:

| Tool | Description |
|------|-------------|
| `imugi_capture` | Screenshot a URL via headless Chromium |
| `imugi_compare` | Compare design vs screenshot with scoring |
| `imugi_analyze` | Analyze visual differences with fix suggestions |
| `imugi_figma_export` | Export a Figma frame as PNG |
| `imugi_detect` | Detect project tech stack |
| `imugi_serve` | Start a dev server |

## Workflow

A typical MCP workflow looks like:

1. **Detect** — AI calls `imugi_detect` to understand your project stack
2. **Serve** — AI calls `imugi_serve` to start your dev server
3. **Capture** — AI calls `imugi_capture` to screenshot the running page
4. **Compare** — AI calls `imugi_compare` to measure design vs implementation
5. **Analyze** — AI calls `imugi_analyze` to get actionable fix suggestions
6. **Iterate** — AI modifies code and repeats until the score meets the threshold

## Standalone Mode

You can also run the MCP server directly:

```bash
imugi mcp
```

This starts the server over stdio transport, which is the standard MCP communication method.
