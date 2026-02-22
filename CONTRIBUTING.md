# Contributing to imugi

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/M00N7682/imugi.git
cd imugi
npm install

# Playwright requires a browser binary for screenshot capture:
npx playwright install chromium

npm run build
npm test
```

## Development workflow

1. Fork the repo and create a feature branch
2. Make your changes
3. Run the checks: `npm run lint && npm run typecheck && npm test`
4. Submit a pull request

## Code style

- TypeScript strict mode
- ESM modules
- No default exports (except CLI entry)
- Formatting enforced by Prettier (`npm run format`)
- Linting enforced by ESLint (`npm run lint`)

## Running tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format

# Type check
npm run typecheck
```

## Reporting issues

Please include:
- Node.js version
- OS and version
- Steps to reproduce
- Expected vs actual behavior
