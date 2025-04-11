import fs from 'fs';

const LOG_FILE = '/tmp/koding-tools.log';
const SEPARATOR = '\n————————————————————————————————————————————————————————————————————————\n';

/**
 * Log final MCP formatted result to the log file
 * @param {string} toolName - Name of the tool
 * @param {object} input - Input arguments to the tool
 * @param {object} mcpResult - The MCP formatted result being sent to the client
 */
export function logFinalResult(toolName, input, mcpResult) {
  const timestamp = new Date().toISOString();
  
  // Create log entry array and add timestamp and tool
  const logEntry = [
    `Timestamp: ${timestamp}`,
    `Tool: ${toolName}`,
    `Input: ${JSON.stringify(input, null, 2)}`
  ];
  
  // Add stderr if present
  if (mcpResult.stderr) {
    logEntry.push(`\nStderr: ${mcpResult.stderr}`);
  }
  
  // Add exitCode if present
  if (mcpResult.exitCode !== undefined) {
    logEntry.push(`ExitCode: ${mcpResult.exitCode}`);
  }
  
  // Add the result
  logEntry.push(`\nResult: ${JSON.stringify(mcpResult, null, 2)}`);
  logEntry.push(SEPARATOR);
  
  // Write to log file
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
