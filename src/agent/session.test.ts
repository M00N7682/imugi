import { describe, it, expect } from 'vitest';
import { agentReducer, initialState, parseUserInput } from './session.js';
import type { ProjectContext, BoulderLoopResult } from '../types.js';

describe('agentReducer', () => {
  it('AUTH_SUCCESS sets phase to idle and user email', () => {
    const state = agentReducer(initialState, {
      type: 'AUTH_SUCCESS',
      email: 'test@example.com',
    });
    expect(state.phase).toBe('idle');
    expect(state.user?.email).toBe('test@example.com');
  });

  it('PROJECT_DETECTED sets projectContext', () => {
    const projectContext: ProjectContext = {
      framework: 'react',
      metaFramework: 'next',
      version: '14.0.0',
      language: 'typescript',
      css: { method: 'tailwind', version: '3.0', config: 'tailwind.config.ts' },
      componentPattern: 'functional',
      fileConvention: { naming: 'kebab-case', extension: '.tsx', styleExtension: null },
      designSystem: null,
      stateManagement: null,
      devServer: { command: 'npm run dev', port: 3000 },
    };
    const state = agentReducer(initialState, {
      type: 'PROJECT_DETECTED',
      context: projectContext,
    });
    expect(state.projectContext).toEqual(projectContext);
  });

  it('USER_MESSAGE adds message and sets phase to generating', () => {
    const state = agentReducer(initialState, {
      type: 'USER_MESSAGE',
      text: 'make this button blue',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toBe('make this button blue');
    expect(state.phase).toBe('generating');
  });

  it('STREAMING_CHUNK appends to currentStreamText', () => {
    let state = agentReducer(initialState, {
      type: 'STREAMING_CHUNK',
      text: 'Hello ',
    });
    state = agentReducer(state, {
      type: 'STREAMING_CHUNK',
      text: 'world',
    });
    expect(state.currentStreamText).toBe('Hello world');
  });

  it('LOOP_COMPLETE resets currentLoop, sets phase to idle, adds result message', () => {
    const result: BoulderLoopResult = {
      finalScore: 0.96,
      totalIterations: 5,
      stopReason: 'success',
      finalCode: new Map([['src/app/page.tsx', 'export default function Page() {}']]),
      reportDir: '.imugi/reports/run-123',
      history: [],
      elapsedMs: 30000,
    };
    const state = agentReducer(initialState, {
      type: 'LOOP_COMPLETE',
      result,
    });
    expect(state.phase).toBe('idle');
    expect(state.currentLoop).toBeNull();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].content).toContain('0.960');
    expect(state.messages[0].content).toContain('5 iterations');
  });

  it('ERROR sets phase to error and adds error message', () => {
    const state = agentReducer(initialState, {
      type: 'ERROR',
      error: 'Something went wrong',
    });
    expect(state.phase).toBe('error');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].content).toContain('Error: Something went wrong');
  });

  it('ASSISTANT_MESSAGE adds message and sets phase to idle', () => {
    const state = agentReducer(initialState, {
      type: 'ASSISTANT_MESSAGE',
      text: 'I will help you',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].content).toBe('I will help you');
    expect(state.phase).toBe('idle');
  });
});

describe('parseUserInput', () => {
  it('regular text returns { text }', () => {
    const result = parseUserInput('make this button blue');
    expect(result.text).toBe('make this button blue');
    expect(result.imagePath).toBeUndefined();
    expect(result.command).toBeUndefined();
  });

  it('text with image path returns { text, imagePath }', () => {
    const result = parseUserInput('make this ./login.png');
    expect(result.text).toBe('make this');
    expect(result.imagePath).toBe('./login.png');
  });

  it('slash commands return { text, command }', () => {
    const result = parseUserInput('/quit');
    expect(result.text).toBe('/quit');
    expect(result.command).toBe('/quit');
  });

  it('handles multiple image extensions', () => {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    for (const ext of extensions) {
      const result = parseUserInput(`design${ext}`);
      expect(result.imagePath).toBe(`design${ext}`);
    }
  });

  it('handles case-insensitive image extensions', () => {
    const result = parseUserInput('design.PNG');
    expect(result.imagePath).toBe('design.PNG');
  });
});

describe('initialState', () => {
  it('has correct shape', () => {
    expect(initialState.phase).toBe('auth');
    expect(initialState.user).toBeNull();
    expect(initialState.projectContext).toBeNull();
    expect(initialState.currentLoop).toBeNull();
    expect(initialState.messages).toEqual([]);
    expect(initialState.currentDesignPath).toBeNull();
    expect(initialState.currentOutputPath).toBeNull();
    expect(initialState.currentStreamText).toBe('');
  });
});
