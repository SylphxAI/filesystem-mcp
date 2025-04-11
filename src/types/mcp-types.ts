// Core MCP types
export enum ErrorCode {
  InvalidParams = -32_602,
  InternalError = -32_603,
  InvalidRequest = -32_600,
}

export class McpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

// Request/Response types
export interface McpRequest<TInput = unknown> {
  jsonrpc?: string;
  method?: string;
  params: TInput;
}

export interface McpResponse<TOutput = unknown> {
  success?: boolean;
  output?: TOutput;
  error?: McpError | Error;
  data?: Record<string, unknown>;
  content?: Array<{
    type: 'text';
    text: string;
  }>;
}

// Tool response type
export interface McpToolResponse extends McpResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}
