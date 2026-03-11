---
title: MCP Tools
description: Reference for all imugi MCP tools
---

imugi exposes 6 tools via the Model Context Protocol.

## imugi_capture

Screenshot a webpage via headless Chromium.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | string | yes | — | URL to capture |
| `width` | number | no | 1440 | Viewport width |
| `height` | number | no | 900 | Viewport height |
| `fullPage` | boolean | no | true | Capture full page |

**Returns:** Screenshot image + metadata text.

## imugi_compare

Compare a design image against a screenshot.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `designImagePath` | string | yes* | Path to design image |
| `figmaUrl` | string | yes* | Figma URL (alternative to designImagePath) |
| `screenshotUrl` | string | yes* | URL to capture |
| `screenshotPath` | string | yes* | Path to screenshot (alternative to URL) |

*Either `designImagePath` or `figmaUrl` required. Either `screenshotUrl` or `screenshotPath` required.

**Returns:** JSON with scores (SSIM, pixel diff, composite, region count) + heatmap image.

## imugi_analyze

Analyze visual differences and suggest fixes.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `designImagePath` | string | yes | Path to design image |
| `screenshotPath` | string | yes | Path to screenshot |

**Returns:** JSON with classified diff regions, priorities, and CSS suggestions.

## imugi_figma_export

Export a Figma frame as an image.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | string | yes | — | Figma URL with node-id |
| `scale` | number | no | 2 | Export scale (1-4) |
| `format` | string | no | png | Output format: png, jpg, svg, pdf |

**Returns:** Exported image.

## imugi_detect

Detect project technology stack.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `projectDir` | string | no | `.` | Project directory path |

**Returns:** JSON with detected framework, CSS method, language, and conventions.

## imugi_serve

Start a development server.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `command` | string | yes | Dev server command (e.g., `npm run dev`) |
| `port` | number | yes | Expected port |

**Returns:** JSON with URL, PID, and command.
