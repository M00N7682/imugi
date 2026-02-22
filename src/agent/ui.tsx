import React, { useReducer, useEffect, useState, type FC } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { TextInput, Spinner } from '@inkjs/ui';
import type Anthropic from '@anthropic-ai/sdk';
import type { ImugiConfig } from '../config/schema.js';
import type { IterationState, ProjectContext } from '../types.js';
import { ensureAuthenticated, type AuthResult } from './auth.js';
import { createClaudeClient } from '../llm/client.js';
import { detectProjectContext } from '../core/context.js';
import { createRenderer, type Renderer } from '../core/renderer.js';
import { runBoulderLoop } from './loop.js';
import { agentReducer, initialState, parseUserInput, type AgentAction } from './session.js';

declare const __IMUGI_VERSION__: string;

const Header: FC<{ email: string | null; context: ProjectContext | null }> = ({ email, context }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color="cyan">imugi v{__IMUGI_VERSION__} — Design to Code</Text>
    <Box gap={2}>
      <Text dimColor>{email ? `Logged in: ${email}` : 'Not authenticated'}</Text>
      {context && (
        <Text dimColor>
          {context.framework ?? 'HTML'}{context.metaFramework ? ` (${context.metaFramework})` : ''} + {context.css.method ?? 'CSS'} + {context.language}
        </Text>
      )}
    </Box>
  </Box>
);

const IterationProgress: FC<{ loop: IterationState }> = ({ loop }) => {
  const statusEmoji: Record<string, string> = {
    capturing: '📸',
    comparing: '🔍',
    analyzing: '📊',
    patching: '🔧',
    waiting_hmr: '⏳',
    done: '✅',
  };

  const improvementStr = loop.previousScore !== null
    ? loop.improvement >= 0
      ? ` (+${loop.improvement.toFixed(3)} ⬆)`
      : ` (${loop.improvement.toFixed(3)} ⬇)`
    : '';

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>🔄 Iteration {loop.iteration}/{loop.maxIterations} — {statusEmoji[loop.status] ?? ''} {loop.status}</Text>
      <Text>Score: <Text bold color={loop.score >= 0.95 ? 'green' : loop.score >= 0.7 ? 'yellow' : 'red'}>{loop.score.toFixed(3)}</Text>{improvementStr}</Text>
      <Text dimColor>Strategy: {loop.strategy} | Regions: {loop.diffCount} | {(loop.elapsedMs / 1000).toFixed(1)}s</Text>
    </Box>
  );
};

const ImugiApp: FC<{ config: ImugiConfig }> = ({ config }) => {
  const [state, dispatch] = useReducer(agentReducer, initialState);
  const [inputValue, setInputValue] = useState('');
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [client, setClient] = useState<Anthropic | null>(null);
  const [rendererRef, setRendererRef] = useState<Renderer | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    const init = async () => {
      try {
        const authResult = await ensureAuthenticated(config.auth.apiKey);
        setAuth(authResult);
        const claudeClient = createClaudeClient(authResult);
        setClient(claudeClient);
        dispatch({ type: 'AUTH_SUCCESS', email: authResult.type === 'oauth' ? 'OAuth User' : 'API Key' });

        const context = await detectProjectContext(process.cwd());
        dispatch({ type: 'PROJECT_DETECTED', context });
      } catch (err) {
        dispatch({ type: 'ERROR', error: (err as Error).message });
      }
    };
    init();
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      rendererRef?.shutdown().catch(() => {});
      exit();
    }
  });

  const handleSubmit = async (value: string) => {
    if (!value.trim()) return;
    setInputValue('');

    const parsed = parseUserInput(value);

    if (parsed.command === '/quit' || parsed.command === '/exit') {
      await rendererRef?.shutdown();
      exit();
      return;
    }

    if (parsed.command === '/status') {
      dispatch({ type: 'ASSISTANT_MESSAGE', text: `Phase: ${state.phase} | Score: ${state.currentLoop?.score.toFixed(3) ?? 'N/A'}` });
      return;
    }

    if (parsed.command === '/history') {
      const hist = state.currentLoop?.history ?? [];
      const text = hist.length === 0
        ? 'No iteration history.'
        : hist.map((r) => `#${r.iteration}: ${r.score.toFixed(3)} (${r.strategy}, ${r.category})`).join('\n');
      dispatch({ type: 'ASSISTANT_MESSAGE', text });
      return;
    }

    if (!client || !state.projectContext) {
      dispatch({ type: 'ERROR', error: 'Not ready. Waiting for authentication and project detection.' });
      return;
    }

    dispatch({ type: 'USER_MESSAGE', text: parsed.text, imagePath: parsed.imagePath });

    const designPath = parsed.imagePath ?? state.currentDesignPath;
    if (!designPath) {
      dispatch({ type: 'ASSISTANT_MESSAGE', text: 'Please provide a design image path. Example: make this design ./login.png' });
      return;
    }

    try {
      let renderer = rendererRef;
      if (!renderer) {
        renderer = createRenderer(config);
        await renderer.start(state.projectContext, process.cwd());
        setRendererRef(renderer);
      }

      const result = await runBoulderLoop({
        client,
        designImagePath: designPath,
        userRequest: parsed.text,
        outputPath: state.currentOutputPath ?? 'src/app/page.tsx',
        projectDir: process.cwd(),
        config,
        projectContext: state.projectContext,
        renderer,
        onProgress: (loopState) => dispatch({ type: 'LOOP_PROGRESS', state: loopState }),
        onStream: (text) => dispatch({ type: 'STREAMING_CHUNK', text }),
      });

      dispatch({ type: 'LOOP_COMPLETE', result });
    } catch (err) {
      dispatch({ type: 'ERROR', error: (err as Error).message });
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header email={state.user?.email ?? null} context={state.projectContext} />

      {state.messages.slice(-10).map((msg) => (
        <Box key={msg.id} marginBottom={0}>
          <Text color={msg.role === 'user' ? 'blue' : 'green'} bold>{msg.role === 'user' ? '> ' : '◆ '}</Text>
          <Text>{msg.content}</Text>
        </Box>
      ))}

      {state.currentLoop && <IterationProgress loop={state.currentLoop} />}

      {state.currentStreamText && (
        <Box marginY={1}>
          <Spinner label="Generating..." />
          <Text dimColor>{state.currentStreamText.slice(-200)}</Text>
        </Box>
      )}

      {state.phase !== 'looping' && state.phase !== 'auth' && (
        <Box marginTop={1}>
          <Text bold color="cyan">&gt; </Text>
          <TextInput
            placeholder="Describe what to build, or attach a design image..."
            onSubmit={handleSubmit}
          />
        </Box>
      )}

      {state.phase === 'auth' && <Spinner label="Authenticating..." />}
    </Box>
  );
};

export function startInteractiveUI(config: ImugiConfig): void {
  render(<ImugiApp config={config} />);
}
