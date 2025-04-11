import * as BashTool from './tools/bash.js';
import * as FileReadTool from './tools/file-read.js';
import * as FileWriteTool from './tools/file-write.js';
import * as FileEditTool from './tools/file-edit.js';
import * as GrepTool from './tools/grep.js';
import * as GlobTool from './tools/glob.js';
import * as LSTool from './tools/ls.js';
// import * as AgentTool from './tools/agent.js';
// import * as ArchitectTool from './tools/architect.js';
import { createWrappedHandler, logToolExecution } from './logger.js';

// Create wrapped versions of each tool with logging functionality
export const tools = [
  {
    ...BashTool,
    handler: createWrappedHandler(BashTool.name, BashTool.handler)
  },
  {
    ...FileReadTool,
    handler: createWrappedHandler(FileReadTool.name, FileReadTool.handler)
  },
  {
    ...FileWriteTool,
    handler: createWrappedHandler(FileWriteTool.name, FileWriteTool.handler)
  },
  {
    ...FileEditTool,
    handler: createWrappedHandler(FileEditTool.name, FileEditTool.handler)
  },
  {
    ...GrepTool,
    handler: createWrappedHandler(GrepTool.name, GrepTool.handler)
  },
  {
    ...GlobTool,
    handler: createWrappedHandler(GlobTool.name, GlobTool.handler)
  },
  {
    ...LSTool,
    handler: createWrappedHandler(LSTool.name, LSTool.handler)
  }
  // Add more tools as needed
];

// Export the logging function for use in mcp.js
export { logToolExecution };