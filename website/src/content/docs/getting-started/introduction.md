---
title: Introduction
description: What is imugi and why use it?
---

**imugi** is an AI-powered design-to-code tool with visual verification. It captures screenshots of your frontend, compares them pixel-by-pixel against your design image, and iterates until the code matches — automatically.

## The Problem

When implementing a design, developers typically:
1. Write code based on a design image
2. Eyeball the result vs the design
3. Manually tweak CSS until it "looks close enough"
4. Repeat forever

This is slow, subjective, and error-prone.

## The Solution

imugi automates this with the **Boulder Loop**:

```
Design Image → Code Generation → Screenshot → Compare → Analyze → Patch
                                                                     ↓
                                                              Score ≥ 95%? → Done!
                                                                     ↓ No
                                                                   Repeat
```

It uses **SSIM** (Structural Similarity), **pixelmatch**, and **Claude Vision** to objectively measure how close your code is to the design, then automatically patches the code to close the gap.

## Key Capabilities

| Feature | Description |
|---------|-------------|
| **Visual Comparison** | SSIM + pixel diff + AI vision with composite scoring |
| **Boulder Loop** | Automated iteration until 95%+ match |
| **MCP Server** | Native integration with Claude Code & Cursor |
| **Figma Integration** | Export frames via URL, no manual export |
| **Project Detection** | Auto-detects React, Vue, Svelte, Tailwind, etc. |
| **Smart Patching** | Full regen for low scores, surgical patches for high scores |
| **HTML Reports** | Visual comparison reports with heatmaps |
| **CI/CD** | GitHub Action for visual regression testing |

## How to Use

imugi works in two primary modes:

### MCP Server (Recommended)
Add imugi as an MCP server to your AI tool (Claude Code, Cursor). The AI calls imugi's tools directly to capture, compare, and iterate.

### CLI
Use imugi directly from the terminal for one-shot generation, comparison, or the full iterative loop.

Ready? Let's [install imugi](/getting-started/installation/).
