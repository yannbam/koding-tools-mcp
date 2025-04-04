import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { EOL } from 'os';
import { dirname, extname, isAbsolute, relative, resolve } from 'path';

const MAX_LINES_TO_RENDER = 10;
const MAX_LINES_TO_RENDER_FOR_ASSISTANT = 16000;
const TRUNCATED_MESSAGE =
  '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Grep in order to find the line numbers of what you are looking for.</NOTE>';

const name = "FileWriteTool";

function detectFileEncoding(filePath) {
  // Simple implementation - in a real app, you'd use a library like jschardet
  return 'utf-8';
}

function detectLineEndings(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    if (content.includes('\r\n')) return '\r\n';
    if (content.includes('\n')) return '\n';
    if (content.includes('\r')) return '\r';
    return EOL;
  } catch (e) {
    return EOL;
  }
}

async function detectRepoLineEndings(cwd) {
  // Default to OS line endings if we can't detect from repo
  return EOL;
}

function writeTextContent(filePath, content, encoding, lineEndings) {
  // Replace line endings and write file
  const normalizedContent = content.replace(/\r\n|\r|\n/g, lineEndings);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, normalizedContent, encoding);
}

function getPatch({ filePath, fileContents, oldStr, newStr }) {
  // Simple diff implementation
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  
  // Return a simplified patch structure
  return [{
    oldStart: 1,
    oldLines: oldLines.length,
    newStart: 1,
    newLines: newLines.length,
    lines: newLines.slice(0, Math.min(10, newLines.length))
  }];
}

function addLineNumbers({ content, startLine }) {
  if (!content) {
    return '';
  }

  return content
    .split(/\r?\n/)
    .map((line, index) => {
      const lineNum = index + startLine;
      const numStr = String(lineNum);
      // Handle large numbers differently
      if (numStr.length >= 6) {
        return `${numStr}\t${line}`;
      }
      // Regular numbers get padding to 6 characters
      const n = numStr.padStart(6, ' ');
      return `${n}\t${line}`;
    })
    .join('\n');
}

const schema = {
  name: name,
  description: `Write a file to the local filesystem. Overwrites the existing file if there is one.

Before using this tool:

1. Use the ReadFile tool to understand the file's contents and context
2. Directory Verification (only applicable when creating new files):
   - Use the LS tool to verify the parent directory exists and is the correct location
3. Avoid rewriting a whole file if you are making edits. Use the FileEditTool instead for more efficiency.`,
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to write (must be absolute, not relative)"
      },
      content: {
        type: "string",
        description: "The content to write to the file"
      }
    },
    required: ["file_path", "content"]
  }
};

const handler = async (toolCall) => {
  const { file_path, content } = toolCall.input;
  
  try {
    const fullFilePath = isAbsolute(file_path)
      ? file_path
      : resolve(process.cwd(), file_path);
    
    const dir = dirname(fullFilePath);
    const oldFileExists = existsSync(fullFilePath);
    const enc = oldFileExists ? detectFileEncoding(fullFilePath) : 'utf-8';
    const oldContent = oldFileExists ? readFileSync(fullFilePath, enc) : null;

    const endings = oldFileExists
      ? detectLineEndings(fullFilePath)
      : await detectRepoLineEndings(process.cwd());

    mkdirSync(dir, { recursive: true });
    writeTextContent(fullFilePath, content, enc, endings);

    // Update read timestamp, to invalidate stale writes
    if (toolCall.readFileTimestamps) {
      toolCall.readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs;
    }

    if (oldContent) {
      const patch = getPatch({
        filePath: file_path,
        fileContents: oldContent,
        oldStr: oldContent,
        newStr: content,
      });

      const data = {
        type: 'update',
        filePath: file_path,
        content,
        structuredPatch: patch,
      };
      
      return {
        type: 'result',
        data,
        resultForAssistant: renderResultForAssistant(data),
      };
    }

    const data = {
      type: 'create',
      filePath: file_path,
      content,
      structuredPatch: [],
    };
    
    return {
      type: 'result',
      data,
      resultForAssistant: renderResultForAssistant(data),
    };
  } catch (error) {
    return {
      error: `Error writing file: ${error.message}`
    };
  }
};

const renderResultForAssistant = ({ filePath, content, type }) => {
  switch (type) {
    case 'create':
      return `File created successfully at: ${filePath}`;
    case 'update':
      return `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:
${addLineNumbers({
  content:
    content.split(/\r?\n/).length > MAX_LINES_TO_RENDER_FOR_ASSISTANT
      ? content
          .split(/\r?\n/)
          .slice(0, MAX_LINES_TO_RENDER_FOR_ASSISTANT)
          .join('\n') + TRUNCATED_MESSAGE
      : content,
  startLine: 1,
})}`;
  }
};

export { name, schema, handler }; 