import type { AgentState, IterationState, ProjectContext, BoulderLoopResult, ConversationMessage } from '../types.js';

export type AgentAction =
  | { type: 'AUTH_SUCCESS'; email: string }
  | { type: 'PROJECT_DETECTED'; context: ProjectContext }
  | { type: 'USER_MESSAGE'; text: string; imagePath?: string }
  | { type: 'LOOP_PROGRESS'; state: IterationState }
  | { type: 'LOOP_COMPLETE'; result: BoulderLoopResult }
  | { type: 'STREAMING_CHUNK'; text: string }
  | { type: 'STREAMING_DONE' }
  | { type: 'ASSISTANT_MESSAGE'; text: string }
  | { type: 'ERROR'; error: string }
  | { type: 'SET_PHASE'; phase: AgentState['phase'] };

export const initialState: AgentState = {
  phase: 'auth',
  user: null,
  projectContext: null,
  currentLoop: null,
  messages: [],
  currentDesignPath: null,
  currentOutputPath: null,
  currentStreamText: '',
};

function createMessage(role: 'user' | 'assistant', content: string, imagePath?: string): ConversationMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    imagePath,
    complete: true,
    timestamp: Date.now(),
  };
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'AUTH_SUCCESS':
      return { ...state, phase: 'idle', user: { email: action.email } };

    case 'PROJECT_DETECTED':
      return { ...state, projectContext: action.context };

    case 'USER_MESSAGE': {
      const msg = createMessage('user', action.text, action.imagePath);
      const designPath = action.imagePath ?? state.currentDesignPath;
      return {
        ...state,
        messages: [...state.messages, msg],
        currentDesignPath: designPath,
        phase: 'generating',
        currentStreamText: '',
      };
    }

    case 'STREAMING_CHUNK':
      return { ...state, currentStreamText: state.currentStreamText + action.text };

    case 'STREAMING_DONE':
      return { ...state, currentStreamText: '' };

    case 'LOOP_PROGRESS':
      return { ...state, phase: 'looping', currentLoop: action.state };

    case 'LOOP_COMPLETE': {
      const resultMsg = createMessage(
        'assistant',
        `Loop complete: score ${action.result.finalScore.toFixed(3)} after ${action.result.totalIterations} iterations (${action.result.stopReason})`,
      );
      return {
        ...state,
        phase: 'idle',
        currentLoop: null,
        messages: [...state.messages, resultMsg],
      };
    }

    case 'ASSISTANT_MESSAGE': {
      const assistantMsg = createMessage('assistant', action.text);
      return { ...state, messages: [...state.messages, assistantMsg], phase: 'idle' };
    }

    case 'ERROR': {
      const errorMsg = createMessage('assistant', `Error: ${action.error}`);
      return { ...state, phase: 'error', messages: [...state.messages, errorMsg] };
    }

    case 'SET_PHASE':
      return { ...state, phase: action.phase };

    default:
      return state;
  }
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export function parseUserInput(input: string): { text: string; imagePath?: string; command?: string; args?: string[] } {
  const trimmed = input.trim();

  if (trimmed.startsWith('/')) {
    const parts = trimmed.split(/\s+/);
    return { text: trimmed, command: parts[0], args: parts.slice(1) };
  }

  const words = trimmed.split(/\s+/);
  let imagePath: string | undefined;
  const textParts: string[] = [];

  for (const word of words) {
    if (IMAGE_EXTENSIONS.some((ext) => word.toLowerCase().endsWith(ext))) {
      imagePath = word;
    } else {
      textParts.push(word);
    }
  }

  return { text: textParts.join(' ') || trimmed, imagePath };
}
