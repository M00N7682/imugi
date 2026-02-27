# Changelog

All notable changes to imugi will be documented in this file.

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
