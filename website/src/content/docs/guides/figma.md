---
title: Figma Integration
description: Export Figma frames and compare directly
---

imugi can export Figma frames directly via URL — no manual export needed.

## Setup

You need a Figma personal access token:

1. Go to [Figma Settings](https://www.figma.com/settings) > Personal Access Tokens
2. Create a new token
3. Set it as an environment variable:

```bash
export FIGMA_TOKEN=figd_...
```

Or add it to `imugi.config.json`:

```json
{
  "figma": {
    "token": "figd_..."
  }
}
```

## Usage

### Export a frame

```bash
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234"
```

### Export at higher scale

```bash
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234" -s 3
```

### Export and compare

```bash
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234" --compare
```

This exports the Figma frame, captures a screenshot of your running dev server, and runs a visual comparison.

### Custom output path

```bash
imugi figma "https://www.figma.com/design/FILE_KEY/name?node-id=42-1234" -o design.png
```

## URL Format

imugi parses standard Figma URLs. The `node-id` parameter is required to identify which frame to export.

```
https://www.figma.com/design/{FILE_KEY}/{FILE_NAME}?node-id={NODE_ID}
```

## MCP Tool

When using imugi as an MCP server, the `imugi_figma_export` tool accepts:

- `url` — Figma URL with node-id
- `scale` — Export scale (1-4, default: 2)
- `format` — Output format: png, jpg, svg, pdf (default: png)
