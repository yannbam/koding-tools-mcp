import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { EOL } from 'os';
import { dirname, extname, isAbsolute, relative, resolve } from 'path';
import { PersistentShell } from '../persistent_shell.js';

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
  description: `Write a file to the local filesystem. Overwrites the existing file if there is one!

Before using this tool:

1. Use the ReadFileTool to understand the file's contents and context
2. Directory Verification (only applicable when creating new files):
   - Use the LSTool to verify the parent directory exists and is the correct location
3. Avoid rewriting a whole file if you are making edits. Use the FileEditTool instead for more efficiency.
4. Avoid overwriting existing files as this may cause irreversible data loss. If overwriting an existing is necessary, you MUST first read the **whole** file using FileReadTool, so you can recover the old content.`,
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

    // nb HACK: run nb_git_checkpoint only if file is in nb's root directory
    const command = `
      nb_root="\${NB_DIR:-\${HOME}/.nb}"
      nb_root=$(realpath "$nb_root" 2>/dev/null || echo "$nb_root")
      if [[ "${fullFilePath}" == "$nb_root"/* ]]; then
        /usr/local/bin/nb_git_checkpoint ${fullFilePath}
      fi
    `
    try {
      const result = await PersistentShell.getInstance().exec(
        command,
        toolCall.abortController?.signal,
        120000
      );
      
      if (result.code !== 0) {
        console.error(`nb_git_checkpoint failed with exit code ${result.code}: ${result.stderr}`);
        // Continue execution despite the error - don't fail the write
      }
    } catch (error) {
      console.error(`Error executing nb_git_checkpoint: ${error.message}`);
      // Continue execution despite the error - don't fail the write
    }

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

      // Use the existing renderResultForAssistant function for formatting
      const message = `The file ${fullFilePath} has been overwritten. Here's the result of running \`cat -n\` on a snippet of the edited file:
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
      
      return {
        type: 'result',
        data: {
          filePath: file_path,
          isUpdate: true,
          oldContent: oldContent,
          newContent: content
        },
        resultForAssistant: message
      };
    }

    const message = `File created successfully at: ${fullFilePath}`;
    
    return {
      type: 'result',
      data: {
        filePath: file_path,
        isUpdate: false,
        newContent: content
      },
      resultForAssistant: message
    };
  } catch (error) {
    return {
      type: 'error',
      error: `Error writing file: ${error.message}`,
      resultForAssistant: `Error writing file: ${error.message}`
    };
  }
};

const renderResultForAssistant = ({ filePath, content, type }) => {
  switch (type) {
    case 'create':
      return `File created successfully at: ${fullFilePath}`;
    case 'update':
      return `The file ${fullFilePath} has been overwritten. Here's the result of running \`cat -n\` on a snippet of the edited file:
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