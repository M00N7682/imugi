# imugi Promotion Drafts

> 아래 초안들을 각 플랫폼에 맞게 복사해서 사용하세요.

---

## 1. Product Hunt

**Tagline (60자):**
Give AI eyes to see your frontend

**Description:**
imugi is an open-source tool that bridges the gap between design and code — with visual proof.

It captures screenshots of your code, compares them pixel-by-pixel against the design using SSIM + Claude Vision, then automatically patches the code until it matches. We call it the Boulder Loop: capture → compare → analyze → patch → repeat.

**Key Features:**
- No API key needed: works with your existing Claude Code / Cursor subscription — zero additional cost
- Composite scoring: SSIM (structural similarity) + pixelmatch + heatmap visualization
- MCP server: plugs into Claude Code, Cursor, and any MCP-compatible AI editor
- Your AI editor provides the brain, imugi provides the eyes
- Figma integration: export frames directly from Figma URLs
- Framework auto-detection: React, Vue, Svelte, Tailwind, and more

**First Comment (게시 직후 본인이 다는 댓글):**
Hey everyone! I built imugi because I was tired of the "looks close enough" approach to design implementation.

The core idea: what if AI could actually *see* the difference between your design and your code, measure it objectively, and fix it automatically?

imugi uses SSIM (the same algorithm used in video quality assessment) combined with Claude's vision capabilities to create a composite similarity score. When the score is below threshold, it analyzes the specific diff regions — color mismatches, spacing issues, missing elements — and generates targeted patches.

The whole thing runs as an MCP server, so it plugs directly into Claude Code or Cursor. Your AI assistant can call imugi tools to verify its own work.

Would love your feedback — especially on the comparison algorithm and iteration strategy. GitHub: https://github.com/M00N7682/imugi

---

## 2. Hacker News (Show HN)

**Title:**
Show HN: imugi – Design-to-code with visual verification (SSIM + Claude Vision)

**Text:**
I built an open-source tool that gives AI a visual feedback loop for frontend development.

The problem: AI code generators produce code that "looks close" to the design, but there's no objective way to measure or improve the match. You end up manually tweaking.

imugi solves this with a multi-signal comparison:
- SSIM (structural similarity index) for luminance, contrast, and structure
- pixelmatch for pixel-level diffing and heatmap generation
- Claude Vision for semantic understanding (activated when SSIM < 0.98)

These combine into a composite score. Based on the score, imugi selects a strategy:
- Score < 0.7: full code regeneration
- Score >= 0.7: surgical patches targeting specific diff regions

It iterates automatically until the score crosses your threshold (default 95%).

The diff regions are classified (color mismatch, spacing, missing element, etc.) and prioritized by area and intensity, so the patching focuses on what matters most.

It runs as an MCP server for Claude Code/Cursor integration, or standalone via CLI. Also supports Figma frame export.

Tech: TypeScript, Playwright for screenshots, Sharp for image processing, ssim.js, pixelmatch.

GitHub: https://github.com/M00N7682/imugi
Docs: https://imugi.ddstudio.co.kr
npm: `npm install -g imugi-ai`

---

## 3. Reddit

### r/webdev

**Title:**
I built an open-source tool that measures how close your code is to the design — and auto-fixes the gaps

**Text:**
I got frustrated with the "eyeball it" approach to design implementation, so I built imugi.

It works like this:
1. You give it a design image (PNG, or directly from Figma)
2. It screenshots your running code via Playwright
3. It compares the two using SSIM + pixel diffing + AI vision
4. It identifies exactly what's different (color, spacing, missing elements, etc.)
5. It patches your code and repeats until the match score hits 95%+

The comparison produces an actual numerical score, so you know objectively how close you are. It also generates heatmaps showing exactly where the differences are.

Works as an MCP server (plugs into Claude Code / Cursor) or standalone CLI.

Open source, MIT license: https://github.com/M00N7682/imugi

Happy to answer any questions about the approach or implementation.

### r/reactjs / r/nextjs

**Title:**
Open-source design-to-code verification — auto-detects React/Next.js, compares screenshots against designs, patches until pixel-perfect

**Text:**
Built a tool called imugi that adds visual verification to AI code generation.

If you're using Claude Code or Cursor, it runs as an MCP server — your AI can call imugi to screenshot its own work, compare against the design, and fix discrepancies automatically.

It auto-detects your project setup (React, Next.js, Vue, Svelte, Tailwind, CSS modules, etc.) and generates code that fits your stack.

The comparison uses SSIM (structural similarity) + pixelmatch + Claude Vision for a composite score. It iterates until 95%+ match.

Quick setup:
```json
{
  "mcpServers": {
    "imugi": {
      "command": "npx",
      "args": ["-y", "imugi-ai", "mcp"]
    }
  }
}
```

GitHub: https://github.com/M00N7682/imugi
Docs: https://imugi.ddstudio.co.kr

---

## 4. Twitter/X Thread

**Tweet 1 (Hook):**
I built an open-source tool that gives AI eyes to see your frontend.

It compares your code against the design pixel-by-pixel, measures the match with SSIM + AI vision, and auto-patches until it's pixel-perfect.

It's called imugi. Here's how it works: 🧵

**Tweet 2 (Problem):**
The problem with AI code generation today:

AI writes code that "looks close" to the design. But there's no objective way to measure HOW close.

You end up manually tweaking CSS for hours.

**Tweet 3 (Solution):**
imugi adds a visual feedback loop:

1. Screenshots your code (Playwright)
2. Compares against the design (SSIM + pixelmatch + Claude Vision)
3. Gets a composite similarity score
4. Patches the code
5. Repeats until 95%+ match

We call it the Boulder Loop.

**Tweet 4 (Tech):**
The comparison is multi-signal:

- SSIM → structural similarity (luminance, contrast, structure)
- pixelmatch → pixel-level diff + heatmap
- Claude Vision → semantic analysis (only when SSIM < 0.98)

Score < 0.7? Full regeneration.
Score >= 0.7? Surgical patches on specific regions.

**Tweet 5 (Integration):**
It runs as an MCP server — drops right into Claude Code or Cursor.

Your AI assistant calls imugi to verify its own output. No copy-pasting, no manual checking.

```json
{
  "mcpServers": {
    "imugi": {
      "command": "npx",
      "args": ["-y", "imugi-ai", "mcp"]
    }
  }
}
```

**Tweet 6 (CTA):**
Open source, MIT license.

GitHub: https://github.com/M00N7682/imugi
Docs: https://imugi.ddstudio.co.kr
npm: npm install -g imugi-ai

Star it if this is useful. PRs welcome.

#opensource #webdev #ai #buildinpublic

---

## 5. Dev.to / Medium Blog Post

**Title:**
How I Built a Visual Verification Loop for AI Code Generation (SSIM + Claude Vision)

**Subtitle:**
Measuring design-to-code similarity with structural analysis and AI — then auto-fixing the gaps

**Content:**

### The Problem

AI code generators are impressive. Give them a design, and they'll produce working code in seconds. But here's what nobody talks about: the output is always *approximately* right. The colors are slightly off. The spacing doesn't quite match. An element is 2px too wide.

And there's no objective way to measure the gap. You just eyeball it and manually tweak until it "looks close enough."

### The Idea

What if we could measure design-to-code similarity the same way video engineers measure compression quality? That's SSIM — Structural Similarity Index. It compares two images based on luminance, contrast, and structure, producing a score from 0 to 1.

I combined SSIM with pixel-level diffing (pixelmatch) and Claude's vision capabilities to create a multi-signal comparison engine. Then I built an automated loop around it: compare, analyze, patch, repeat.

### How imugi Works

**Step 1: Capture**
Playwright launches headless Chromium, loads your dev server, and takes a screenshot. The screenshot is resized to match the design image dimensions.

**Step 2: Compare**
Three signals are computed:
- **SSIM** — structural similarity between design and screenshot
- **Pixel diff** — raw pixel comparison via pixelmatch, producing a heatmap
- **Claude Vision** — AI-powered visual assessment (only activated when SSIM < 0.98)

The composite score: `ssim * 0.4 + vision * 0.6`

**Step 3: Analyze**
Pixel differences are clustered into regions using connected component analysis. Each region is classified: color mismatch, spacing issue, missing element, font difference, etc. Regions are prioritized by area and intensity.

**Step 4: Patch**
Based on the score, a strategy is selected:
- Score < 0.7: full code regeneration — send design + screenshot + heatmap to Claude, get a complete rewrite
- Score >= 0.7: surgical patch — send cropped diff regions, get targeted fixes

**Step 5: Repeat**
The loop continues until the score exceeds the threshold (default 0.95), max iterations are reached, or the score converges (stops improving).

### MCP Integration

imugi runs as an MCP (Model Context Protocol) server. This means AI editors like Claude Code and Cursor can call imugi tools directly:

- `imugi_capture` — take a screenshot
- `imugi_compare` — compare design vs code
- `imugi_analyze` — get actionable fix suggestions
- `imugi_detect` — detect project tech stack

The AI verifies its own work in real-time. No human in the loop.

### Results

In testing, the Boulder Loop typically converges in 3-5 iterations for most designs, reaching 95%+ composite scores. The surgical patching strategy is key — instead of rewriting everything each time, it focuses on the specific regions that differ.

### Try It

```bash
npm install -g imugi-ai
imugi init
```

Open source, MIT license.
- GitHub: https://github.com/M00N7682/imugi
- Docs: https://imugi.ddstudio.co.kr

---

## 6. Anthropic Discord / AI Editor Communities

**Post:**
Built an open-source MCP server for visual design verification — works with Claude Code and Cursor.

**What it does:** Compares your frontend code against a design image using SSIM + pixelmatch + Claude Vision. Returns a composite similarity score and auto-patches the code until it matches.

**Setup (one line in MCP config):**
```json
{
  "mcpServers": {
    "imugi": {
      "command": "npx",
      "args": ["-y", "imugi-ai", "mcp"]
    }
  }
}
```

**Tools exposed:**
- `imugi_capture` — screenshot via Playwright
- `imugi_compare` — SSIM + pixel diff + vision scoring
- `imugi_analyze` — diff region classification + fix suggestions
- `imugi_detect` — project tech stack detection
- `imugi_serve` — start dev server

Your AI can call these to verify its own code output. The iteration loop (we call it Boulder Loop) runs automatically until the design match threshold is hit.

Also supports Figma URL export — pull frames directly without manual export.

GitHub: https://github.com/M00N7682/imugi
npm: `npm install -g imugi-ai`

---

## Hashtags / Keywords

**Twitter:** #opensource #webdev #ai #buildinpublic #mcp #claudecode #cursor #designtocode #frontend
**Product Hunt:** AI, Developer Tools, Open Source, Design Tools, Code Generation
**Reddit flairs:** Show /r/webdev, Project, Tool

---

## Posting Schedule (Suggested)

| Day | Platform | Notes |
|-----|----------|-------|
| Day 1 | Twitter thread | Build anticipation |
| Day 2 | Product Hunt launch | 한국시간 오전 1시 (미국 자정) |
| Day 2 | Reddit r/webdev | Product Hunt 런칭 직후 |
| Day 3 | Hacker News | Show HN |
| Day 3 | Reddit r/reactjs | |
| Day 4 | Dev.to blog post | 기술적 딥다이브 |
| Day 5 | Anthropic Discord + AI editor communities | MCP 관련 커뮤니티 |
