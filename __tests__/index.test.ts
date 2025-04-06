// __tests__/index.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
// Keep standard imports, even though they are mocked below
import { Server } from '@modelcontextprotocol/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/stdio';
// McpError might be imported from sdk directly if needed, or mocked within sdk mock
// import { McpError } from '@modelcontextprotocol/sdk/error'; // Or '@modelcontextprotocol/sdk'
import * as allHandlers from '../src/handlers/index.js'; // Import all handlers with extension
import { ZodError } from 'zod';

// Mock the SDK components within the factory functions

vi.mock('@modelcontextprotocol/sdk', () => {
  // Define mocks inside the factory
  const mockServerInstance = {
    registerTool: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const MockServer = vi.fn().mockImplementation(() => mockServerInstance);

  const MockMcpError = class extends Error {
    code: number;
    data: any;
    constructor(message: string, code = -32000, data?: any) {
      super(message);
      this.name = 'McpError';
      this.code = code;
      this.data = data;
    }
  };

  return {
    Server: MockServer,
    McpError: MockMcpError,
  };
});

vi.mock('@modelcontextprotocol/sdk/stdio', () => {
  const mockTransportInstance = {}; // Add methods if needed
  const MockStdioServerTransport = vi
    .fn()
    .mockImplementation(() => mockTransportInstance);
  return {
    StdioServerTransport: MockStdioServerTransport,
  };
});

// Remove the separate mock for sdk/error as McpError is mocked above

// Define an interface for the expected handler structure
interface HandlerDefinition {
  name: string;
  description: string;
  schema: any; // Use a more specific type if available (e.g., ZodSchema)
  handler: (...args: any[]) => Promise<any>;
  jsonSchema?: any; // Optional JSON schema property
}

// Mock the handlers to prevent actual execution
// Iterate over values and check structure more robustly with type guard
const mockHandlers = Object.values(allHandlers).reduce<
  Record<string, HandlerDefinition & { handler: ReturnType<typeof vi.fn> }>
>((acc, handlerDef) => {
  // Type guard to check if handlerDef matches HandlerDefinition structure
  const isHandlerDefinition = (def: any): def is HandlerDefinition =>
    typeof def === 'object' &&
    def !== null &&
    typeof def.name === 'string' &&
    typeof def.handler === 'function';

  if (isHandlerDefinition(handlerDef)) {
    // Now TypeScript knows handlerDef has a 'name' property of type string
    acc[handlerDef.name] = {
      ...handlerDef, // Spread the original definition
      handler: vi.fn().mockResolvedValue({ success: true }), // Mock the handler function
    };
  }
  // Ignore exports that don't match the expected structure
  return acc;
}, {}); // Initial value for reduce

// Ensure mockHandlers is correctly typed before spreading
const typedMockHandlers: Record<string, any> = mockHandlers;

vi.mock('../src/handlers/index.js', () => ({
  // Also update path here
  ...typedMockHandlers,
}));

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});
// Adjust the type assertion for process.exit mock
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as (code?: number | string | null | undefined) => never);

describe('Server Initialization (src/index.ts)', () => {
  // Remove explicit type annotations, let TS infer from mocks
  let serverInstance: any; // Use 'any' or let it be inferred
  let transportInstance: any;

  beforeEach(async () => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Dynamically import the module to run the setup logic
    // Use .js extension consistent with module resolution
    await import('../src/index.js');

    // Get the mocked instances using vi.mocked for type safety
    serverInstance = vi.mocked(Server).mock.instances[0];
    transportInstance = vi.mocked(StdioServerTransport).mock.instances[0];
  });

  afterEach(() => {
    vi.resetModules(); // Ensure fresh import for next test
  });

  it('should create a StdioServerTransport instance', () => {
    expect(StdioServerTransport).toHaveBeenCalledTimes(1);
    expect(transportInstance).toBeDefined();
  });

  it('should create a Server instance with the transport', () => {
    expect(Server).toHaveBeenCalledTimes(1);
    expect(Server).toHaveBeenCalledWith(transportInstance);
    expect(serverInstance).toBeDefined();
  });

  it('should register all expected tools', () => {
    // Get names from the keys of the refined mockHandlers object
    const expectedToolNames = Object.keys(typedMockHandlers); // Use typedMockHandlers

    expect(serverInstance.registerTool).toHaveBeenCalledTimes(
      expectedToolNames.length,
    );

    // Check if each handler name (which is the key in mockHandlers now) was registered
    expectedToolNames.forEach((toolName) => {
      const handlerDefinition = typedMockHandlers[toolName]; // Use typedMockHandlers
      expect(serverInstance.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: handlerDefinition.name,
          description: handlerDefinition.description,
          inputSchema: expect.any(Object), // Zod schema converts to object
          handler: handlerDefinition.handler, // Check if the mocked handler was passed
        }),
      );
      // Optionally, more specific schema checks if needed
      // expect(serverInstance.registerTool).toHaveBeenCalledWith(
      //     expect.objectContaining({ name: handlerDefinition.name, inputSchema: handlerDefinition.jsonSchema })
      // );
    });
  });

  it('should call server.start()', () => {
    expect(serverInstance.start).toHaveBeenCalledTimes(1);
  });

  // Add tests for signal handling if possible/necessary
  // This might be harder to test reliably without actually sending signals
  // it('should register signal handlers for SIGINT and SIGTERM', () => {
  //   // Difficult to directly test process.on('SIGINT', ...) registration
  //   // Could potentially spy on process.on but might be fragile
  // });

  // it('should call server.stop() and process.exit() on SIGINT/SIGTERM', () => {
  //   // Simulate signal? Requires more advanced mocking or test setup
  // });
});
