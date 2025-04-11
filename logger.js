import fs from 'fs';

const LOG_FILE = '/tmp/koding-tools.log';
const SEPARATOR = '\n————————————————————————————————————————————————————————————————————————\n';

/**
 * Log tool execution with both client-facing result and debug information
 * @param {string} toolName - Name of the tool
 * @param {object} input - Input arguments to the tool
 * @param {object} clientResult - The exact result being sent to the client
 * @param {object} debugInfo - Additional debug info (not sent to client)
 */
export function logToolExecution(toolName, input, clientResult, debugInfo = {}) {
  const timestamp = new Date().toISOString();
  
  // Create log entry with clear sections
  const logEntry = [
    `Timestamp: ${timestamp}`,
    `Tool: ${toolName}`,
    `Input: ${JSON.stringify(input, null, 2)}`
  ];
  
  // Add debug sections (only for logging, not sent to client)
  if (debugInfo.stderr) {
    logEntry.push(`\nStderr: ${debugInfo.stderr}`);
  }
  
  if (debugInfo.exitCode !== undefined) {
    logEntry.push(`ExitCode: ${debugInfo.exitCode}`);
  }
  
  // Add the exact client result (what's actually sent)
  logEntry.push(`\nClientResult: ${JSON.stringify(clientResult, null, 2)}`);
  logEntry.push(SEPARATOR);
  
  fs.appendFileSync(LOG_FILE, logEntry.join('\n'));
}

/**
 * Create a wrapped handler with logging functionality
 * @param {string} toolName - Name of the tool
 * @param {function} originalHandler - The original handler function
 * @returns {function} - A new handler function with logging added
 */
export function createWrappedHandler(toolName, originalHandler) {
  return async (toolCall) => {
    try {
      // Call the original handler
      const result = await originalHandler(toolCall);
      return result;
    } catch (error) {
      // Handle errors
      const errorResult = {
        type: 'error',
        error: error.message || String(error)
      };
      
      throw error; // Re-throw to maintain original behavior
    }
  };
}
