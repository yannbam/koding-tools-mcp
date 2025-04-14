import { tools, logToolExecution } from './tools.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
// Individual tool imports are now redundant since we import from tools.js
// import * as BashTool from './tools/bash.js';
// import * as LSTool from './tools/ls.js';

// import { setOriginalCwd } from './persistent_shell.js';

// Enable server debugging
const DEBUG = process.env.DEBUG === 'true';

// Logger function that conditionally logs based on DEBUG flag
function debug(...args) {
  if (DEBUG) {
    console.error('[SERVER DEBUG]', ...args);
  }
  writeFileSync('/tmp/mcp.log', `${new Date().toISOString()}: ${args.join(' ')}\n`, { flag: 'a' });
}

// Constants for MCP protocol
const JSON_RPC_VERSION = '2.0';
const MCP_VERSION = '2024-11-05';
const SUPPORTED_VERSIONS = [MCP_VERSION];

// A buffer class for reading JSON-RPC messages from a stream
class ReadBuffer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  append(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  readMessage() {
    // Try to find a complete JSON message
    let message = null;
    let start = 0;

    // Skip any leading whitespace
    while (start < this.buffer.length && 
           (this.buffer[start] === 0x20 || // space
            this.buffer[start] === 0x09 || // tab
            this.buffer[start] === 0x0A || // LF
            this.buffer[start] === 0x0D)) { // CR
      start++;
    }

    if (start === this.buffer.length) {
      // Only whitespace, reset buffer
      this.buffer = Buffer.alloc(0);
      return null;
    }

    // Look for newline that ends a complete message
    for (let i = start; i < this.buffer.length; i++) {
      if (this.buffer[i] === 0x0A) { // LF
        try {
          const jsonStr = this.buffer.slice(start, i).toString('utf8');
          if (jsonStr.trim()) {
            message = JSON.parse(jsonStr);
          }
          // Update buffer to remove the message we just read
          this.buffer = this.buffer.slice(i + 1);
          return message;
        } catch (e) {
          debug("Error parsing JSON message:", e.message);
          // Invalid JSON, keep looking
          continue;
        }
      }
    }

    // No complete message found
    return null;
  }

  clear() {
    this.buffer = Buffer.alloc(0);
  }
}

// Serialize a message to a JSON string with a newline
function serializeMessage(message) {
  return JSON.stringify(message) + '\n';
}

// Define some basic resources
const RESOURCES = [
  {
    uri: 'koding://tools',
    name: 'Available Tools',
    description: 'List of all available tools in the system',
    mimeType: 'application/json'
  },
  {
    uri: 'koding://config',
    name: 'Configuration',
    description: 'System configuration',
    mimeType: 'application/json'
  },
  {
    uri: 'file:///package.json',
    name: 'Package Configuration',
    description: 'Node.js package configuration',
    mimeType: 'application/json'
  }
];

// Define resource templates
const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'file:///{path}',
    name: 'File Access',
    description: 'Access file contents',
    mimeType: 'application/octet-stream'
  },
  {
    uriTemplate: 'koding://tool/{name}',
    name: 'Tool Schema',
    description: 'Get schema for a specific tool',
    mimeType: 'application/json'
  }
];

class MCPServer {
  constructor() {
    debug('Starting MCP server');
    this.nextId = 1;
    this.tools = {};
    this.toolSchemas = {};
    this.initialized = false;
    this.clientCapabilities = null;
    this.serverCapabilities = {
      tools: {
        listChanged: false
      },
      resources: {
        subscribe: false,
        listChanged: false
      },
      logging: {}
    };
    this.resources = [
      {
        name: 'Available Tools',
        description: 'List of available tools',
        uri: 'mcp://tools'
      },
      {
        name: 'Configuration',
        description: 'Server configuration',
        uri: 'mcp://config'
      },
      {
        name: 'Package Configuration',
        description: 'Information about the package configuration',
        uri: 'mcp://package'
      }
    ];
    
    // Register all tools immediately during initialization
    for (const tool of tools) {
      debug(`Registering tool: ${tool.name}`);
      this.registerTool(tool);
      debug(`Tool ${tool.name} registered successfully`);
    }
  }

  registerTool(tool) {
    if (tool.schema) {
      // Create a properly formatted tool object
      const formattedTool = {
        name: tool.name,
        description: tool.schema.description || "No description provided",
        // Map parameters to input_schema if that's what's available
        input_schema: tool.schema.input_schema || tool.schema.parameters || { type: "object", properties: {} },
        handler: tool.handler
      };
      this.tools[tool.name] = formattedTool;
      this.toolSchemas[tool.name] = formattedTool.input_schema;
    } else {
      // If no schema, just register as-is
      this.tools[tool.name] = tool;
      this.toolSchemas[tool.name] = { type: "object", properties: {} };
    }
  }

  /**
   * Handle JSON-RPC requests directly
   */
  async handleRequest(request) {
    debug('Handling request:', JSON.stringify(request));

    // Check for required fields
    if (!request.jsonrpc || request.jsonrpc !== JSON_RPC_VERSION) {
      debug('Invalid JSON-RPC version:', request.jsonrpc);
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC version'
        }
      };
    }

    // Handle notifications (no id field)
    if (request.id === undefined) {
      debug('Received notification:', request.method);
      this.handleNotification(request);
      return null; // No response for notifications
    }

    // Ensure initialize is called first
    if (!this.initialized && request.method !== 'initialize' && request.method !== 'ping') {
      debug('Server not initialized, rejecting request:', request.method);
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        error: {
          code: -32001,
          message: 'Server not initialized'
        }
      };
    }

    // Handle methods
    try {
      debug('Processing method:', request.method);
      let result;

      switch (request.method) {
        case 'initialize':
          result = await this.handleInitialize(request.params);
          break;
        case 'ping':
          result = { timestamp: Date.now() };
          break;
        case 'resources/list':
          result = await this.handleResourcesList(request.params);
          break;
        case 'resources/read':
          result = await this.handleResourceRead(request.params);
          break;
        case 'resources/subscribe':
          result = await this.handleResourceSubscribe(request.params);
          break;
        case 'resources/templates/list':
          result = await this.handleResourceTemplatesList(request.params);
          break;
        case 'tools/list':
          result = await this.handleToolsList(request.params);
          break;
        case 'tools/call':
          result = await this.handleToolCall(request.params);
          break;
        default:
          debug('Unknown method:', request.method);
          return {
            jsonrpc: JSON_RPC_VERSION,
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            }
          };
      }

      debug('Request successful, returning result');
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        result
      };
    } catch (error) {
      debug('Error handling request:', error);
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        error: {
          code: -32000,
          message: `Server error: ${error.message}`
        }
      };
    }
  }

  /**
   * Handle notification messages (no response needed)
   */
  handleNotification(notification) {
    debug('Processing notification:', notification.method);
    switch (notification.method) {
      case 'notifications/initialized':
        debug('Client initialization complete');
        // Client has finished initialization, we're now in the Operation phase
        if (!this.initialized) {
          debug('Warning: Received initialized notification before successful initialization');
        } else {
          debug('MCP session fully established, entering operational phase');
          // We could emit an event or set a state flag here
        }
        break;
      case 'disconnect':
        debug('Client requested disconnect');
        // Client is disconnecting, we can shut down gracefully
        process.exit(0);
        break;
      case 'notifications/resources/list_changed':
        debug('Resources list changed notification');
        // Handle any resources list change logic
        break;
      case 'notifications/tools/list_changed':
        debug('Tools list changed notification');
        // Handle any tools list change logic
        break;
      default:
        debug('Unknown notification method:', notification.method);
        // Ignore unknown notifications
        break;
    }
  }

  /**
   * Handle initialize request (handshake)
   */
  async handleInitialize(params) {
    debug('Processing initialize with params:', params);
    
    if (this.initialized) {
      // Don't cancel handshake to allow for reconnects
      this.initialized = false;

      debug('Server reinitializing');
      // debug('Server already initialized, rejecting');
      // throw new Error('Server already initialized');
    }

    // Check protocol version
    const clientVersion = params?.protocolVersion;
    if (!clientVersion) {
      debug('No protocol version specified');
      throw {
        code: -32602,
        message: 'Missing protocol version',
        data: {
          supported: SUPPORTED_VERSIONS
        }
      };
    }
    
    // Check if we support the requested version
    if (!SUPPORTED_VERSIONS.includes(clientVersion)) {
      debug('Unsupported protocol version:', clientVersion, 'supported:', SUPPORTED_VERSIONS);
      
      // Return a supported version as per spec
      const serverVersion = SUPPORTED_VERSIONS[0]; // Use our preferred version
      debug('Using server version:', serverVersion);
      
      // Store client capabilities and mark as initialized
      this.clientCapabilities = params?.capabilities || {};
      this.initialized = true;
      
      // Return server info with our version
      return {
        protocolVersion: serverVersion,
        serverInfo: {
          name: 'mcp-js-server',
          version: '1.0.0'
        },
        capabilities: this.serverCapabilities
      };
    }

    // Client version is supported
    // Store client capabilities
    this.clientCapabilities = params?.capabilities || {};
    this.initialized = true;

    debug('Initialization successful with protocol version:', clientVersion);
    
    // Return server capabilities using the client's version
    return {
      protocolVersion: clientVersion,
      serverInfo: {
        name: 'mcp-js-server',
        version: '1.0.0'
      },
      capabilities: this.serverCapabilities // Use the capabilities defined in the constructor
    };
  }

  /**
   * Handle resources/list request
   */
  async handleResourcesList(params) {
    debug('Processing resources/list with params:', params);
    // Check capability
    if (!this.initialized) {
      debug('Server not initialized, rejecting');
      throw new Error('Server not initialized');
    }

    // Return list of resources
    const resources = Object.values(this.resources);
    debug(`Returning ${resources.length} resources`);
    return {
      resources,
      nextCursor: ""
    };
  }

  /**
   * Handle resources/read request
   */
  async handleResourceRead(params) {
    debug('Processing resources/read with params:', params);
    const { uri } = params;
    if (!uri) {
      debug('Missing URI parameter');
      throw new Error('URI is required');
    }

    // Check if resource exists
    if (!this.resources[uri]) {
      debug('Resource not found:', uri);
      throw new Error(`Resource not found: ${uri}`);
    }

    // For this example, we'll just return the resource metadata
    // In a real implementation, you'd return the actual resource content
    debug('Returning resource:', uri);
    return {
      uri,
      content: JSON.stringify(this.resources[uri])
    };
  }

  /**
   * Handle resources/templates/list request
   */
  async handleResourceTemplatesList(params) {
    debug('Processing resources/templates/list');
    // Return list of resource templates
    // In this example, we'll just return an empty list
    return {
      resourceTemplates: []
    };
  }

  /**
   * Handle resource subscribe request
   */
  async handleResourceSubscribe(params) {
    debug('Processing resources/subscribe with params:', params);
    // Not implemented in this example
    throw new Error('Resource subscription not supported');
  }

  /**
   * Handle tools/list request
   */
  handleToolsList(params = {}) {
    debug('Processing tools/list');
    
    // No need to register tools here since they're already registered in the constructor
    // Extract pagination parameters
    const limit = Number(params.limit) || 20;
    const cursor = params.cursor ? Number(params.cursor) : 0;
    
    // Get the tool names
    const toolNames = Object.keys(this.tools);
    
    // Calculate the indices for slicing the array
    const startIndex = cursor;
    const endIndex = Math.min(startIndex + limit, toolNames.length);
    
    // Create the list of tools with their descriptions and schemas
    const tools = toolNames.slice(startIndex, endIndex).map(name => {
      const result = {
        name,
        description: this.tools[name].description
      };
      
      if (this.toolSchemas[name]) {
        result.inputSchema = this.toolSchemas[name];
      }
      
      return result;
    });
    
    // Calculate the next cursor
    const nextCursor = endIndex < toolNames.length ? endIndex.toString() : "";
    
    debug(`Returning ${tools.length} tools (total: ${toolNames.length}, page: ${startIndex}-${endIndex}, nextCursor: ${nextCursor})`);
    
    return {
      tools,
      nextCursor
    };
  }

  /**
   * Handle tools/call request
   */
  async handleToolCall(params) {
    debug('Processing tools/call with params:', params);
    const { name, arguments: args } = params;
    
    if (!name) {
      debug('Missing tool name');
      throw new Error('Tool name is required');
    }

    const tool = this.tools[name];
    if (!tool) {
      debug('Tool not found:', name);
      throw new Error(`Tool not found: ${name}`);
    }

    // Call the tool with the provided arguments
    try {
      debug(`Executing tool: ${name}`);
      
      // Create a toolCall object similar to what the handler expects
      const toolCall = {
        input: args,
        abortController: new AbortController()
      };
      
      // Call the tool handler
      const result = await tool.handler(toolCall);
      debug('Tool execution successful');
      
      // Convert the result to the MCP format
      let content = [];
      
      if (result.type === 'error' || result.error) {
        // Handle error result
        const errorText = result.resultForAssistant || result.error || 'An error occurred';
        
        content.push({
          type: 'text',
          text: errorText
        });
        
        // Create client result (exactly what gets sent to client)
        const clientResult = {
          content,
          isError: true
        };
        
        // Create separate debug info (not sent to client)
        const debugInfo = {
          stderr: result.error || errorText,
          exitCode: result.code || 1  // Default to error code 1 if not specified
        };
        
        // Log both client result and debug info separately
        logToolExecution(name, args, clientResult, debugInfo);
        
        return clientResult;
      } else if (result.type === 'image') {
        content.push({
          type: 'image',
          data: result.base64,
          mimeType: result.mediaType || 'image/png'
        });
      } else {
        // Handle regular result (text)
        const text = result.resultForAssistant || JSON.stringify(result.data, null, 2);
        content.push({
          type: 'text',
          text: text
        });
      }
      
      // Create client result (exactly what gets sent to client)
      const clientResult = {
        content,
        isError: false
      };
      
      // Create separate debug info (not sent to client)
      const debugInfo = {
        stderr: result.data?.stderr,
        exitCode: result.data?.exitCode
      };
      
      // Log both client result and debug info separately
      logToolExecution(name, args, clientResult, debugInfo);
      
      return clientResult;
    } catch (error) {
      debug('Tool execution failed:', error);
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }
}

class StdioTransport {
  constructor(server) {
    this.server = server;
    this.readBuffer = new ReadBuffer();
    this.started = false;
    this.awaitingInitialized = false; // Track if we're waiting for initialized notification
  }

  async start() {
    if (this.started) {
      debug('Stdio transport already started');
      return;
    }

    this.started = true;
    debug('Starting stdio transport');

    // Set up data handling for stdin
    process.stdin.on('data', this._onData.bind(this));
    process.stdin.on('error', this._onError.bind(this));
    process.stdin.on('end', this._onEnd.bind(this));
    
    // Set up resuming stdin - important for proper protocol handling
    process.stdin.resume();

    // Set up error handling for stdout
    process.stdout.on('error', (error) => {
      debug('Error on stdout:', error);
      process.exit(1);
    });

    // Start health check for stdout
    this._startHealthCheck();
  }

  _onData(chunk) {
    this.readBuffer.append(chunk);
    this._processBuffer();
  }

  _onError(error) {
    debug('Error on stdin:', error);
    process.exit(1);
  }

  _onEnd() {
    debug('End of stdin, shutting down');
    process.exit(0);
  }

  _processBuffer() {
    let message;
  while ((message = this.readBuffer.readMessage()) !== null) {
      this._handleMessage(message);
    }
  }

  async _handleMessage(message) {
    try {
      debug('Processing message:', JSON.stringify(message));
      
      // Check for initialized notification after init
      if (this.awaitingInitialized && 
          message.method === 'notifications/initialized') {
        debug('Received initialized notification, server fully ready');
        this.awaitingInitialized = false;
      }
      
      const response = await this.server.handleRequest(message);
      
      // If this was an initialize request, we should now wait for initialized
      if (response && message.method === 'initialize') {
        this.awaitingInitialized = true;
        debug('Waiting for initialized notification');
      }
      
      if (response) {
        this.send(response);
      }
    } catch (error) {
      debug('Error handling message:', error);
      if (message.id !== undefined) {
        this.send({
          jsonrpc: JSON_RPC_VERSION,
          id: message.id,
          error: {
            code: -32603,
            message: `Internal error: ${error.message}`
          }
        });
      }
    }
  }

  send(message) {
    return new Promise((resolve) => {
      const data = serializeMessage(message);
      debug('Sending response:', data.trim());
      if (process.stdout.write(data)) {
        resolve();
      } else {
        process.stdout.once('drain', resolve);
      }
    });
  }

  _startHealthCheck() {
    const interval = setInterval(() => {
      try {
        if (!process.stdout.writable) {
          debug('Stdout is no longer writable, shutting down');
          clearInterval(interval);
          process.exit(1);
        }
      } catch (e) {
        debug('Health check error:', e);
        clearInterval(interval);
        process.exit(1);
      }
    }, 5000);

    // Ensure the interval doesn't keep the process alive
    interval.unref();
  }

  close() {
    debug('Closing stdio transport');
    process.stdin.removeListener('data', this._onData);
    process.stdin.removeListener('error', this._onError);
    process.stdin.removeListener('end', this._onEnd);
    this.readBuffer.clear();
    this.started = false;
  }
}

// Start the MCP server with stdio transport
async function main() {
  try {

    // Check for the required command-line argument
    // cwd arg is no longer required (default=/tmp)
    // const cliArgs = process.argv.slice(2);
    
    // if (cliArgs.length === 0) {
    //   console.error('Error: The first argument is required and should be the path for the bash tool.');
    //   process.exit(1);
    // }
    
    debug('Starting MCP server');
    const server = new MCPServer();
    
    // Create and start the transport
    const transport = new StdioTransport(server);
    await transport.start();
    
    debug('MCP server started and ready for requests');
    
    // Handle process termination
    process.on('SIGINT', () => {
      debug('Received SIGINT, shutting down');
      transport.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      debug('Received SIGTERM, shutting down');
      transport.close();
      process.exit(0);
    });
    
    // Keep the process alive until explicitly terminated
    // This prevents the process from exiting prematurely
    const keepAlive = setInterval(() => {
      debug('Server heartbeat');
    }, 30000);
    keepAlive.unref(); // Don't let this interval prevent process exit when requested
  } catch (error) {
    debug('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server
main().catch(error => {
  debug('Unhandled error:', error);
  process.exit(1);
});

export default MCPServer;
