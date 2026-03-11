---
title: Comparison Algorithm
description: How imugi measures design-to-code similarity
---

imugi uses a multi-signal comparison approach to objectively measure how close your code is to the design.

## Signals

| Signal | What it measures | Weight |
|--------|-----------------|--------|
| **SSIM** | Structural similarity — luminance, contrast, structure | 0.4 (with vision) or 1.0 (alone) |
| **Pixel Diff** | Raw pixel-level comparison via pixelmatch | Used for heatmap |
| **Claude Vision** | AI-powered visual assessment | 0.6 (when available) |

## Composite Score

The composite score is calculated as:

- **SSIM only** (when vision unavailable): `score = ssim`
- **SSIM + Vision**: `score = ssim * 0.4 + vision * 0.6`

The score is clamped to [0, 1].

## When Vision is Used

Claude Vision analysis is activated when SSIM < 0.98. For very high SSIM scores, pixel-level comparison is sufficient and the API call is skipped.

## Diff Regions

Pixel differences are clustered into regions using connected component analysis. Each region gets:

- **Position** (x, y) and **size** (width, height)
- **Diff intensity** — average difference magnitude
- **Pixel count** — number of differing pixels

## Region Classification

Regions are classified by type:

| Classification | Description |
|---------------|-------------|
| `color` | Color mismatch |
| `spacing` | Margin/padding difference |
| `size` | Element size mismatch |
| `position` | Element position offset |
| `missing` | Element present in design but not in code |
| `extra` | Element in code but not in design |
| `font` | Typography difference |

## Priority Assignment

| Priority | Criteria |
|----------|----------|
| **high** | Large area, high intensity, structural differences |
| **medium** | Moderate area or intensity |
| **low** | Small area, low intensity |

## Strategy Selection

Based on the composite score, imugi selects a patching strategy:

| Score | Strategy | Description |
|-------|----------|-------------|
| < 0.7 | **Full regeneration** | Rewrite the code from scratch |
| >= 0.7 | **Surgical patch** | Targeted fixes for specific regions |

The strategy can also switch based on iteration history — if surgical patches are not improving the score, imugi may escalate to full regeneration.
