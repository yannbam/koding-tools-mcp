#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Create a simple MCP client to test the server
async function main() {
  console.log('Starting MCP test client');
  
  // Start the MCP server as a child process
  const server = spawn('node', ['mcp.js'], {
    stdio: ['pipe', 'pipe', process.stderr],
    env: { ...process.env, DEBUG: 'true' }
  });
  
  // Create readline interface for reading the server's stdout
  const rl = createInterface({
    input: server.stdout,
    crlfDelay: Infinity
  });
  
  // Track message IDs
  let messageId = 0;
  
  // Function to send a JSON-RPC message to the server
  const send = (message) => {
    console.log('CLIENT SENDING:', JSON.stringify(message));
    server.stdin.write(JSON.stringify(message) + '\n');
  };
  
  // Set up event listeners
  rl.on('line', (line) => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('CLIENT RECEIVED:', JSON.stringify(response));
        
        // If this is the initialize response, send the initialized notification
        if (response.id === 0) {
          console.log('Sending initialized notification');
          // Send initialized notification immediately
          send({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          });
          
          // After initialization, immediately request the resources list
          send({
            jsonrpc: '2.0',
            id: ++messageId,
            method: 'resources/list'
          });
        }
        
        // After resources/list, immediately request the tools list
        if (response.id === 1) {
          console.log('Requesting tools list');
          send({
            jsonrpc: '2.0',
            id: ++messageId,
            method: 'tools/list',
            params: {}
          });
        }
        
        // After tools/list, immediately test calling tools
        if (response.id === 2 && response.result && response.result.tools) {
          console.log(`Found ${response.result.tools.length} tools`);
          
          // Test all available tools with basic arguments
          const tools = response.result.tools;
          
          // Start with LSTool as it's simple and reliable
          const lsTool = tools.find(tool => tool.name === 'LSTool');
          if (lsTool) {
            console.log('Testing LSTool call');
            send({
              jsonrpc: '2.0',
              id: ++messageId,
              method: 'tools/call',
              params: {
                name: 'LSTool',
                arguments: {
                  path: process.cwd()
                }
              }
            });
          }
          
          // Test BashTool with a simple echo command
          const bashTool = tools.find(tool => tool.name === 'BashTool');
          if (bashTool) {
            console.log('Testing BashTool call');
            send({
              jsonrpc: '2.0',
              id: ++messageId,
              method: 'tools/call',
              params: {
                name: 'BashTool',
                arguments: {
                  command: 'echo "Testing MCP server with BashTool"'
                }
              }
            });
          }
        }
      } catch (error) {
        console.error('Error parsing response:', error);
      }
    }
  });
  
  // Handle server process events
  server.on('error', (error) => {
    console.error('Server error:', error);
  });
  
  server.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
    process.exit(code);
  });
  
  // Send initialize request
  send({
    jsonrpc: '2.0',
    id: messageId,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: true
        },
        resources: {
          subscribe: true,
          listChanged: true
        }
      },
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  });
  
  // Keep the script running
  console.log('Test client running. Press Ctrl+C to exit.');
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 