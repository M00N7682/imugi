---
title: Configuration
description: Customize imugi settings
---

imugi can be configured via a config file, environment variables, or CLI flags.

## Config File

Create `imugi.config.json` in your project root:

```json
{
  "comparison": {
    "threshold": 0.95,
    "maxIterations": 10
  },
  "rendering": {
    "port": 3000,
    "viewport": { "width": 1440, "height": 900 }
  }
}
```

## Full Schema

```json
{
  "auth": {
    "apiKey": null,
    "oauth": true
  },
  "comparison": {
    "threshold": 0.95,
    "maxIterations": 10,
    "improvementThreshold": 0.01,
    "patchSwitchThreshold": 0.7
  },
  "rendering": {
    "devServerCommand": null,
    "url": null,
    "port": 3000,
    "viewport": {
      "width": 1440,
      "height": 900
    }
  },
  "project": {
    "framework": "auto",
    "css": "auto",
    "language": "auto"
  },
  "timeouts": {
    "overall": 1800,
    "pageLoad": 15,
    "devServer": 30
  },
  "figma": {
    "token": null,
    "defaultScale": 2
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `IMUGI_API_KEY` | Alternative API key | — |
| `IMUGI_THRESHOLD` | Similarity threshold (0.8-0.99) | 0.95 |
| `IMUGI_MAX_ITERATIONS` | Max iterations (1-50) | 10 |
| `IMUGI_PORT` | Dev server port | 3000 |
| `FIGMA_TOKEN` | Figma personal access token | — |

## Priority Order

Settings are merged in this order (later overrides earlier):

1. **Defaults** — Built-in default values
2. **Config file** — `imugi.config.json`
3. **Environment variables** — `IMUGI_*`
4. **CLI flags** — `--threshold`, `--max-iterations`, etc.
