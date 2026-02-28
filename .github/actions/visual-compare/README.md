# Imugi Visual Compare Action

A reusable GitHub Action that runs [imugi](https://github.com/M00N7682/imugi) visual comparison in CI and posts the results as a PR comment.

It captures a screenshot of a running page, compares it against a design image using SSIM and pixel-diff metrics, and reports the composite similarity score.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `design-image` | Yes | — | Path to the design image file (png/jpg/webp) |
| `url` | No | `http://localhost:3000` | URL to capture a screenshot from |
| `threshold` | No | `0.95` | Similarity threshold (0.0 - 1.0). Scores at or above this value are considered passing. |
| `fail-below` | No | `false` | Whether to fail the job if the composite score is below the threshold |

## Outputs

| Output | Description |
| --- | --- |
| `ssim` | SSIM score (0.0 - 1.0) |
| `pixel-diff` | Pixel diff percentage (0.0 - 100.0) |
| `composite-score` | Composite score (0.0 - 1.0) |
| `diff-regions` | Number of diff regions detected |
| `passed` | `true` if the composite score meets the threshold, `false` otherwise |

## Usage

### Prerequisites

Your workflow must start your application's dev server **before** invoking this action. The action captures a screenshot from the URL you provide (default `http://localhost:3000`), so the page must be accessible.

### Basic example

```yaml
name: Visual Regression
on:
  pull_request:
    branches: [main]

jobs:
  visual-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - run: npm ci

      # Start your dev server in the background
      - name: Start dev server
        run: npm run dev &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 30000

      # Run visual comparison
      - name: Visual comparison
        uses: ./.github/actions/visual-compare
        with:
          design-image: designs/homepage.png
```

### Enforcing a threshold

Set `fail-below` to `true` to fail the workflow when the composite score is below the threshold:

```yaml
      - name: Visual comparison
        uses: ./.github/actions/visual-compare
        with:
          design-image: designs/homepage.png
          threshold: '0.90'
          fail-below: 'true'
```

### Custom URL

If your dev server runs on a different port or path:

```yaml
      - name: Visual comparison
        uses: ./.github/actions/visual-compare
        with:
          design-image: designs/dashboard.png
          url: 'http://localhost:8080/dashboard'
```

### Using outputs in subsequent steps

```yaml
      - name: Visual comparison
        id: visual
        uses: ./.github/actions/visual-compare
        with:
          design-image: designs/homepage.png

      - name: Log results
        run: |
          echo "Composite score: ${{ steps.visual.outputs.composite-score }}"
          echo "SSIM: ${{ steps.visual.outputs.ssim }}"
          echo "Passed: ${{ steps.visual.outputs.passed }}"
```

### Full workflow example

A complete workflow that builds the project, starts the dev server, runs the visual comparison, and fails if the score drops below the threshold:

```yaml
name: Visual Regression

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  visual-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Start dev server
        run: npm run dev &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 30000

      - name: Run visual comparison
        id: visual
        uses: ./.github/actions/visual-compare
        with:
          design-image: designs/homepage.png
          threshold: '0.95'
          fail-below: 'true'
```

> **Note:** The workflow needs `pull-requests: write` permission for the action to post PR comments. Without it, the comparison still runs and outputs are still set, but the comment step will be skipped or fail silently.

## How it works

1. **Setup** -- Installs Node.js 20, the `imugi-ai` CLI, and Playwright Chromium.
2. **Compare** -- Runs `imugi compare <design-image> --url <url>` which captures a screenshot of the given URL and compares it against the design image.
3. **Parse** -- Extracts SSIM, pixel diff, composite score, and diff region count from the CLI output.
4. **Comment** -- On pull requests, posts (or updates) a formatted Markdown comment with a results table.
5. **Enforce** -- If `fail-below` is `true` and the composite score is below the threshold, the job fails with an error.

## PR comment

When running on a pull request, the action posts a comment like this:

> ## :white_check_mark: Imugi Visual Comparison -- PASSED
>
> | Metric | Value |
> | --- | --- |
> | **Composite Score** | `0.9712` |
> | **SSIM** | `0.9623` |
> | **Pixel Diff** | `2.41%` |
> | **Diff Regions** | `3` |
> | **Threshold** | `0.95` |

If the action runs again on the same PR (e.g., after a new push), it updates the existing comment instead of creating a new one.
