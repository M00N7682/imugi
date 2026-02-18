# Contributing to imugi

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/M00N7682/imugi.git
cd imugi
npm install
npm run build
npm test
```

## Development workflow

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `npm run typecheck` and `npm test` to verify
4. Submit a pull request

## Code style

- TypeScript strict mode
- ESM modules
- No default exports (except CLI entry)

## Running tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck
```

## Reporting issues

Please include:
- Node.js version
- OS and version
- Steps to reproduce
- Expected vs actual behavior
