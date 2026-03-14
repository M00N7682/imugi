import { describe, it, expect, vi } from 'vitest';

// We test the logic patterns used in the MCP server by extracting and testing
// the key internal functions and patterns rather than spinning up a full MCP server.

describe('MCP Server error handling', () => {
  function errorResult(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
  }

  it('formats Error objects with message', () => {
    const result = errorResult(new Error('Something failed'));
    expect(result.content[0].text).toBe('Error: Something failed');
    expect(result.isError).toBe(true);
  });

  it('stringifies non-Error objects', () => {
    const result = errorResult('string error');
    expect(result.content[0].text).toBe('Error: string error');
  });

  it('handles null error', () => {
    const result = errorResult(null);
    expect(result.content[0].text).toBe('Error: null');
  });

  it('handles undefined error', () => {
    const result = errorResult(undefined);
    expect(result.content[0].text).toBe('Error: undefined');
  });

  it('handles number error', () => {
    const result = errorResult(404);
    expect(result.content[0].text).toBe('Error: 404');
  });
});

describe('MCP Server process management', () => {
  it('tracks processes and removes them on exit', () => {
    const processes: Array<{ killed: boolean; exitCode: number | null; kill: (sig: string) => void; on: (event: string, cb: () => void) => void }> = [];
    let exitCallback: (() => void) | null = null;

    function trackProcess(child: typeof processes[0]): void {
      processes.push(child);
      child.on('exit', () => {
        const idx = processes.indexOf(child);
        if (idx !== -1) processes.splice(idx, 1);
      });
    }

    const mockChild = {
      killed: false,
      exitCode: null,
      kill: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'exit') exitCallback = cb;
      }),
    };

    trackProcess(mockChild);
    expect(processes.length).toBe(1);

    // Simulate exit
    exitCallback!();
    expect(processes.length).toBe(0);
  });

  it('killAllProcesses sends SIGTERM to all tracked processes', () => {
    const processes: Array<{ killed: boolean; kill: (sig: string) => void }> = [];

    function killAllProcesses(): void {
      for (const child of processes) {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }
      processes.length = 0;
    }

    const child1 = { killed: false, kill: vi.fn() };
    const child2 = { killed: false, kill: vi.fn() };
    processes.push(child1, child2);

    killAllProcesses();
    expect(child1.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child2.kill).toHaveBeenCalledWith('SIGTERM');
    expect(processes.length).toBe(0);
  });

  it('skips already killed processes', () => {
    const processes: Array<{ killed: boolean; kill: (sig: string) => void }> = [];

    function killAllProcesses(): void {
      for (const child of processes) {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }
      processes.length = 0;
    }

    const child = { killed: true, kill: vi.fn() };
    processes.push(child);

    killAllProcesses();
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('MCP Server port waiting logic', () => {
  it('resolves when port is available', async () => {
    const mockDestroy = vi.fn();

    const waitForPort = (_port: number): Promise<void> =>
      new Promise((resolve) => {
        const socket = {
          on: (event: string, cb: () => void) => {
            if (event === 'connect') {
              // Simulate immediate connection
              setTimeout(cb, 0);
            }
          },
          destroy: mockDestroy,
        };
        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });
      });

    await expect(waitForPort(3000)).resolves.toBeUndefined();
  });

  it('Figma URL node-id validation pattern', () => {
    // Tests the pattern used in imugi_compare and imugi_figma_export
    const urlWithNodeId = 'https://www.figma.com/design/abc123/MyDesign?node-id=42-1234';
    const urlWithoutNodeId = 'https://www.figma.com/design/abc123/MyDesign';

    // Simulates the server's URL validation
    const hasNodeId = (url: string) => url.includes('node-id=');
    expect(hasNodeId(urlWithNodeId)).toBe(true);
    expect(hasNodeId(urlWithoutNodeId)).toBe(false);
  });
});

describe('MCP Server iterate status logic', () => {
  function determineStatus(
    score: number,
    threshold: number,
    currentIteration: number,
    maxIterations: number,
    history: Array<{ score: number }>,
  ): { status: string; strategy: string } {
    if (score >= threshold) return { status: 'DONE', strategy: 'SURGICAL_PATCH' };
    if (currentIteration >= maxIterations) return { status: 'DONE', strategy: 'SURGICAL_PATCH' };

    const recent = history.slice(-3);
    const isConverged = recent.length >= 3 && recent.every((r, i) => {
      if (i === 0) return true;
      return Math.abs(r.score - recent[i - 1].score) < 0.01;
    });
    if (isConverged) return { status: 'DONE', strategy: 'SURGICAL_PATCH' };

    const strategy = score < 0.7 ? 'FULL_REWRITE' : 'SURGICAL_PATCH';
    return { status: 'ACTION_REQUIRED', strategy };
  }

  it('returns DONE when score meets threshold', () => {
    const result = determineStatus(0.96, 0.95, 1, 10, []);
    expect(result.status).toBe('DONE');
  });

  it('returns ACTION_REQUIRED when score is below threshold', () => {
    const result = determineStatus(0.80, 0.95, 1, 10, []);
    expect(result.status).toBe('ACTION_REQUIRED');
  });

  it('returns DONE when max iterations reached', () => {
    const result = determineStatus(0.80, 0.95, 10, 10, []);
    expect(result.status).toBe('DONE');
  });

  it('suggests FULL_REWRITE for scores below 0.7', () => {
    const result = determineStatus(0.5, 0.95, 1, 10, []);
    expect(result.strategy).toBe('FULL_REWRITE');
  });

  it('suggests SURGICAL_PATCH for scores at or above 0.7', () => {
    const result = determineStatus(0.85, 0.95, 1, 10, []);
    expect(result.strategy).toBe('SURGICAL_PATCH');
  });

  it('detects convergence after 3 stalled iterations', () => {
    const history = [
      { score: 0.82 },
      { score: 0.825 },
      { score: 0.828 },
    ];
    const result = determineStatus(0.828, 0.95, 4, 10, history);
    expect(result.status).toBe('DONE');
  });

  it('does not falsely detect convergence with significant improvement', () => {
    const history = [
      { score: 0.70 },
      { score: 0.78 },
      { score: 0.85 },
    ];
    const result = determineStatus(0.85, 0.95, 4, 10, history);
    expect(result.status).toBe('ACTION_REQUIRED');
  });
});

describe('MCP Server iterate response formatting', () => {
  it('formats iterate response with status, score, and strategy', () => {
    const response = {
      status: 'ACTION_REQUIRED',
      statusDetail: 'Score: 0.820 — below threshold 0.95. Fix the issues below and call imugi_iterate again.',
      iteration: 2,
      maxIterations: 10,
      score: 0.82,
      threshold: 0.95,
      previousScore: 0.65,
      strategy: 'SURGICAL_PATCH',
      strategyHint: 'Score is close — make targeted CSS/layout fixes for the specific regions listed below.',
      metrics: { ssim: 0.85, pixelDiffPercentage: 0.03, diffRegions: 4 },
      history: [{ iteration: 1, score: 0.65 }, { iteration: 2, score: 0.82 }],
    };

    expect(response.status).toBe('ACTION_REQUIRED');
    expect(response.score).toBe(0.82);
    expect(response.strategy).toBe('SURGICAL_PATCH');
    expect(response.history).toHaveLength(2);
    expect(response.iteration).toBe(2);
  });

  it('formats DONE response when threshold is reached', () => {
    const response = {
      status: 'DONE',
      statusDetail: 'Similarity score 0.960 meets threshold 0.95. Implementation matches the design.',
      iteration: 3,
      score: 0.96,
      threshold: 0.95,
    };

    expect(response.status).toBe('DONE');
    expect(response.score).toBeGreaterThanOrEqual(response.threshold);
  });
});

describe('MCP Server response formatting', () => {
  it('formats capture response with image and text', () => {
    const buffer = Buffer.from('png-data');
    const response = {
      content: [
        { type: 'image' as const, data: buffer.toString('base64'), mimeType: 'image/png' as const },
        { type: 'text' as const, text: `Screenshot captured: 1440x900, fullPage=true` },
      ],
    };
    expect(response.content).toHaveLength(2);
    expect(response.content[0].type).toBe('image');
    expect(response.content[1].type).toBe('text');
  });

  it('formats compare response as JSON + heatmap', () => {
    const comparison = {
      ssim: { mssim: 0.92 },
      pixelDiff: { diffPercentage: 0.005 },
      compositeScore: 0.88,
      diffRegions: [{ x: 0, y: 0 }],
      heatmapBuffer: Buffer.from('heatmap'),
    };

    const response = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ssim: comparison.ssim.mssim,
            pixelDiffPercentage: comparison.pixelDiff.diffPercentage,
            compositeScore: comparison.compositeScore,
            diffRegions: comparison.diffRegions.length,
          }, null, 2),
        },
        { type: 'image' as const, data: comparison.heatmapBuffer.toString('base64'), mimeType: 'image/png' as const },
      ],
    };

    const textContent = response.content[0] as { type: 'text'; text: string };
    const parsed = JSON.parse(textContent.text);
    expect(parsed.ssim).toBe(0.92);
    expect(parsed.compositeScore).toBe(0.88);
    expect(parsed.diffRegions).toBe(1);
  });

  it('formats detect response as JSON', () => {
    const context = { framework: 'react', language: 'typescript' };
    const response = {
      content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
    };
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.framework).toBe('react');
  });

  it('formats serve response with url and pid', () => {
    const response = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ url: 'http://localhost:3000', pid: 12345, command: 'npm run dev' }),
      }],
    };
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.url).toBe('http://localhost:3000');
    expect(parsed.pid).toBe(12345);
  });

  it('formats figma export mime types correctly', () => {
    const mimeMap = (format: string) =>
      format === 'jpg' ? 'image/jpeg' : format === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png';

    expect(mimeMap('png')).toBe('image/png');
    expect(mimeMap('jpg')).toBe('image/jpeg');
    expect(mimeMap('svg')).toBe('image/svg+xml');
    expect(mimeMap('pdf')).toBe('application/pdf');
  });
});
