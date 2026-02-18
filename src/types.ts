// ============================================================
// imugi — Shared Type Definitions
// ============================================================

// --- Project Context ---

export interface ProjectContext {
  framework: 'react' | 'vue' | 'svelte' | 'html' | null;
  metaFramework: 'next' | 'nuxt' | 'remix' | 'sveltekit' | null;
  version: string | null;
  language: 'typescript' | 'javascript';
  css: {
    method: 'tailwind' | 'modules' | 'styled-components' | 'css' | null;
    version: string | null;
    config: string | null;
  };
  componentPattern: 'functional' | 'class' | null;
  fileConvention: {
    naming: string;
    extension: string;
    styleExtension: string | null;
  };
  designSystem: string | null;
  stateManagement: string | null;
  devServer: {
    command: string;
    port: number;
  };
}

// --- Comparison ---

export interface ComparisonResult {
  ssim: SSIMResult;
  pixelDiff: PixelDiffResult;
  heatmapBuffer: Buffer;
  diffRegions: DiffRegion[];
  compositeScore: number;
  designDimensions: { width: number; height: number };
  screenshotBuffer: Buffer;
  cropPairs: Array<{ design: Buffer; screenshot: Buffer; region: DiffRegion }>;
}

export interface SSIMResult {
  mssim: number;
  performanceMs: number;
}

export interface PixelDiffResult {
  diffCount: number;
  totalPixels: number;
  diffPercentage: number;
  diffImageBuffer: Buffer;
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  diffIntensity: number;
  pixelCount: number;
}

// --- Analysis ---

export interface DiffReport {
  overallScore: number;
  regionCount: number;
  regions: AnalyzedRegion[];
  summary: string;
  suggestedStrategy: PatchStrategy;
}

export interface AnalyzedRegion {
  region: DiffRegion;
  classification: 'color' | 'spacing' | 'size' | 'position' | 'missing' | 'extra' | 'font' | 'unknown';
  priority: 'high' | 'medium' | 'low';
  description: string;
  cssSuggestion?: string;
}

export type PatchStrategy = 'full_regen' | 'surgical_patch';

export type StopReason = 'success' | 'max_iterations' | 'timeout' | 'converged' | 'error';

export type IterationCategory = 'first' | 'improved' | 'stalled' | 'regressed' | 'converged' | 'achieved';

export interface StrategyRecommendation {
  strategy: PatchStrategy;
  reason: string;
  shouldStop: boolean;
  stopReason?: StopReason;
  shouldRollback: boolean;
  rollbackTo?: number;
}

// --- Iteration / Loop ---

export interface IterationState {
  iteration: number;
  maxIterations: number;
  status: 'capturing' | 'comparing' | 'analyzing' | 'patching' | 'waiting_hmr' | 'done';
  score: number;
  previousScore: number | null;
  improvement: number;
  strategy: PatchStrategy;
  stopReason: StopReason | null;
  diffCount: number;
  elapsedMs: number;
  history: IterationRecord[];
}

export interface IterationRecord {
  iteration: number;
  score: number;
  strategy: PatchStrategy;
  filesModified: string[];
  elapsedMs: number;
  category: IterationCategory;
  timestamp: number;
}

export interface BoulderLoopResult {
  finalScore: number;
  totalIterations: number;
  stopReason: StopReason;
  finalCode: Map<string, string>;
  reportDir: string;
  history: IterationRecord[];
  elapsedMs: number;
}

// --- Patcher ---

export interface PatchResult {
  newCode: Map<string, string>;
  strategy: PatchStrategy;
  filesModified: string[];
  tokensUsed: number;
}

export interface FileOperation {
  filePath: string;
  content: string;
}

// --- Vision Analysis ---

export interface VisionAnalysis {
  similarityScore: number;
  differences: Array<{
    area: string;
    type: string;
    description: string;
    cssSuggestion: string;
  }>;
  overallAssessment: string;
}

// --- Auth ---

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'bearer';
  saved_at?: number;
}

// --- Conversation ---

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imagePath?: string;
  complete: boolean;
  timestamp: number;
}

// --- Agent State ---

export interface AgentState {
  phase: 'auth' | 'idle' | 'generating' | 'looping' | 'conversation' | 'error';
  user: { email: string } | null;
  projectContext: ProjectContext | null;
  currentLoop: IterationState | null;
  messages: ConversationMessage[];
  currentDesignPath: string | null;
  currentOutputPath: string | null;
  currentStreamText: string;
}
