export type TokenUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
};

export type ToolResult = {
  type: 'bash' | 'file_edit' | 'file_write' | 'file_read' | 'search' | 'other';
  content: string;
  structured?: unknown;
  isError?: boolean;
};

export type HistoryMessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; toolName: string; toolCallId: string; args: unknown; result?: ToolResult };

export type HistoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  blocks: HistoryMessageBlock[];
};

export type NormalizedEvent =
  | { type: 'session_init'; model: string; tools: string[]; sessionId: string }
  | { type: 'message_start'; role: 'assistant' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'tool_call_start'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool_result'; toolCallId: string; result: ToolResult }
  | { type: 'message_end'; stopReason: string }
  | { type: 'turn_end'; usage: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'agent_end'; totalCost: number; totalTokens: TokenUsage }
  | { type: 'history_replay'; messages: HistoryMessage[] };
