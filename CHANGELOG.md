# Changelog

All notable changes to imugi will be documented in this file.

## [1.1.0] - 2026-02-28

### Added
- Figma integration: export Figma frames directly via URL using the Figma REST API
- New core module `src/core/figma.ts` with URL parsing, API client, and token resolution
- New MCP tool `imugi_figma_export` for exporting Figma frames as PNG/JPG/SVG/PDF
- New CLI command `imugi figma <url>` with `--compare` flag for export + compare workflow
- Added `figmaUrl` parameter to `imugi_compare` MCP tool for direct Figma-to-screenshot comparison
- Config support for `figma.token` and `figma.defaultScale` in `imugi.config.json`
- Environment variable support: `FIGMA_TOKEN` / `FIGMA_PERSONAL_ACCESS_TOKEN`
- HTML comparison report: `imugi compare --report` generates a visual side-by-side report with scores, heatmap, and diff regions
- Reusable GitHub Action (`.github/actions/visual-compare/`) for CI visual regression testing with PR comments
- Global `--verbose` CLI flag for debug output
- `imugi init` now checks for Figma token and provides setup guidance (step 5/5)
- 29 unit tests for `figma.ts` (URL parsing, token resolution, API export with retry)
- Vitest coverage configuration (`npm run test:coverage`)

### Improved
- All MCP tool handlers wrapped in try-catch — errors return structured messages instead of crashing the server
- Figma API calls retry on 429 (rate limit) and 5xx errors with exponential backoff
- `imugi_compare` now accepts `figmaUrl` as alternative to `designImagePath` (both optional)

### Changed
- Total test count: 147 → 176

## [1.0.2] - 2025-02-27

### Added
- `imugi init` one-click setup command (Playwright install + project detect + config create + auth check)
- Login page, pricing page, and dashboard examples (`examples/`)
- Demo visual for README showing the Boulder Loop flow (static PNG + animated GIF via Remotion)
- GitHub repository topics for discoverability

## [1.0.1] - 2025-02-26

### Added
- GitHub Actions CI workflow (Node 18/20/22 matrix)
- ESLint + Prettier configuration with 22 lint fixes
- GitHub Issue templates (bug report, feature request) and PR template
- Playwright install guidance in README and CONTRIBUTING.md
- Hero-section example with terminal-inspired design
- Design vs implementation comparison image in README

### Fixed
- Version hardcoding: injected from package.json at build time via tsup define
- `imugi_serve` process leak: spawned dev servers now tracked and cleaned up on exit
- Unused imports and dead code across codebase

## [1.0.0] - 2025-02-25

### Added
- Core visual comparison engine (SSIM + pixelmatch + heatmap)
- Boulder Loop: iterative code improvement until design match threshold
- MCP server with 5 tools: `imugi_capture`, `imugi_compare`, `imugi_analyze`, `imugi_detect`, `imugi_serve`
- Interactive terminal agent UI (Ink/React)
- CLI commands: `agent`, `generate`, `compare`, `mcp`, `auth`
- Project auto-detection: React/Vue/Svelte, Tailwind/modules/styled-components, TypeScript/JavaScript
- OAuth PKCE + API key authentication
- Smart patching strategy: full regen below 0.7, surgical patch above
- Configuration via `imugi.config.json`, environment variables, and CLI flags
- 147 tests (unit + e2e)
