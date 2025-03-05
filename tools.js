import * as BashTool from './tools/bash.js';
import * as FileReadTool from './tools/file-read.js';
import * as FileWriteTool from './tools/file-write.js';
import * as FileEditTool from './tools/file-edit.js';
import * as GrepTool from './tools/grep.js';
import * as GlobTool from './tools/glob.js';
import * as LSTool from './tools/ls.js';
import * as AgentTool from './tools/agent.js';

export const tools = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GrepTool,
  GlobTool,
  LSTool,
  AgentTool
];