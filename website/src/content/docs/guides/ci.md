---
title: CI / GitHub Action
description: Run visual regression tests in CI
---

imugi provides a GitHub Action for visual regression testing in your CI pipeline.

## GitHub Action

Add to your workflow (`.github/workflows/visual-test.yml`):

```yaml
name: Visual Regression Test
on: [push, pull_request]

jobs:
  visual-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npx imugi-ai compare ./design.png --screenshot http://localhost:3000 --threshold 0.9
```

## What It Does

The CI step will:
1. Start your dev server
2. Capture a screenshot of the specified URL
3. Compare it against your design image
4. **Fail the build** if the similarity score drops below the threshold

## Configuration

### Threshold

Set the minimum acceptable similarity score:

```bash
npx imugi-ai compare ./design.png --screenshot http://localhost:3000 --threshold 0.95
```

### Viewport

Specify the viewport size for consistent screenshots:

```bash
npx imugi-ai compare ./design.png --screenshot http://localhost:3000 --width 1440 --height 900
```

## HTML Report

Generate an HTML report for visual inspection:

```bash
npx imugi-ai compare ./design.png --screenshot http://localhost:3000 --report ./report
```

Upload the report as a CI artifact for easy review:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: visual-report
    path: ./report/
```
