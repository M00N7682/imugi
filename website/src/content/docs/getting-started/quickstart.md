---
title: Quick Start
description: Get up and running with imugi in under 2 minutes
---

## As MCP Server (Recommended)

### 1. Add to your AI tool

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

### 2. Ask your AI to implement a design

```
Implement this login page design. Here's the reference: ./login-design.png
```

The AI will use imugi's tools to:
1. Detect your project stack
2. Start your dev server
3. Capture screenshots
4. Compare against the design
5. Iterate until the code matches

## As CLI

### Generate code from a design

```bash
imugi generate ./design.png --output src/app/page.tsx
```

### Compare a design against a screenshot

```bash
imugi compare ./design.png --screenshot ./current.png
```

### Run the full Boulder Loop

```bash
export ANTHROPIC_API_KEY=sk-ant-...
imugi
```

Then describe what you want:

```
> implement this design ./login-design.png
```

### Export from Figma

```bash
# Export a Figma frame
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234"

# Export and compare against dev server
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234" --compare
```

Requires `FIGMA_TOKEN` environment variable.

## Next Steps

- [MCP Server Setup](/guides/mcp-server/) — Detailed MCP configuration
- [Figma Integration](/guides/figma/) — Connect Figma directly
- [Configuration](/guides/configuration/) — Customize thresholds, viewports, and more
