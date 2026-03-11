# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in imugi, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@imugi.dev** (or open a private security advisory via GitHub)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: As soon as possible, depending on severity

### Scope

The following are in scope:

- Code execution vulnerabilities in the CLI or MCP server
- Authentication/token handling issues
- Dependency vulnerabilities with known exploits
- Path traversal or file system access issues

### Out of scope

- Vulnerabilities in third-party dependencies without a known exploit
- Issues requiring physical access to the machine
- Social engineering attacks

## Security Best Practices for Users

- Never commit your `ANTHROPIC_API_KEY` or `FIGMA_TOKEN` to version control
- Use environment variables or `imugi.config.json` (which should be in `.gitignore`)
- Keep imugi updated to the latest version

Thank you for helping keep imugi secure.
