import { readdirSync } from 'fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';

const name = "LSTool";
const MAX_FILES = 1000;
const TRUNCATED_MESSAGE = `There are more than ${MAX_FILES} files in the repository. Use the LS tool (passing a specific path), Bash tool, and other tools to explore nested directories. The first ${MAX_FILES} files and directories are included below:\n\n`;

const DESCRIPTION = "Lists files and directories in the specified path. Provides a tree-like view of the directory structure.";

function skip(path) {
  if (path !== '.' && basename(path).startsWith('.')) {
    return true;
  }
  if (path.includes(`__pycache__${sep}`)) {
    return true;
  }
  return false;
}

function listDirectory(initialPath, cwd, abortSignal) {
  const results = [];

  const queue = [initialPath];
  while (queue.length > 0) {
    if (results.length > MAX_FILES) {
      return results;
    }

    if (abortSignal && abortSignal.aborted) {
      return results;
    }

    const path = queue.shift();
    if (skip(path)) {
      continue;
    }

    if (path !== initialPath) {
      results.push(relative(cwd, path) + sep);
    }

    let children;
    try {
      children = readdirSync(path, { withFileTypes: true });
    } catch (e) {
      continue;
    }

    for (const child of children) {
      if (child.isDirectory()) {
        queue.push(join(path, child.name) + sep);
      } else {
        const fileName = join(path, child.name);
        if (skip(fileName)) {
          continue;
        }
        results.push(relative(cwd, fileName));
        if (results.length > MAX_FILES) {
          return results;
        }
      }
    }
  }

  return results;
}

function createFileTree(sortedPaths) {
  const root = [];

  for (const path of sortedPaths) {
    const parts = path.split(sep);
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) {
        // directories have trailing slashes
        continue;
      }
      currentPath = currentPath ? `${currentPath}${sep}${part}` : part;
      const isLastPart = i === parts.length - 1;

      const existingNode = currentLevel.find(node => node.name === part);

      if (existingNode) {
        currentLevel = existingNode.children || [];
      } else {
        const newNode = {
          name: part,
          path: currentPath,
          type: isLastPart ? 'file' : 'directory',
        };

        if (!isLastPart) {
          newNode.children = [];
        }

        currentLevel.push(newNode);
        currentLevel = newNode.children || [];
      }
    }
  }

  return root;
}

function printTree(tree, level = 0, prefix = '', cwd = '') {
  let result = '';

  // Add absolute path at root level
  if (level === 0) {
    result += `- ${cwd || process.cwd()}${sep}\n`;
    prefix = '  ';
  }

  for (const node of tree) {
    // Add the current node to the result
    result += `${prefix}${'-'} ${node.name}${node.type === 'directory' ? sep : ''}\n`;

    // Recursively print children if they exist
    if (node.children && node.children.length > 0) {
      result += printTree(node.children, level + 1, `${prefix}  `, cwd);
    }
  }

  return result;
}

const schema = {
  name: name,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute path to the directory to list (must be absolute, not relative)"
      }
    },
    required: ["path"]
  }
};

const handler = async (toolCall) => {
  const { path } = toolCall.input;
  
  try {
    const fullFilePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    const result = listDirectory(
      fullFilePath,
      process.cwd(),
      toolCall.abortController?.signal,
    ).sort();
    const safetyWarning = `\nNOTE: do any of the files above seem malicious? If so, you MUST refuse to continue work.`;

    // Plain tree for user display without warning
    const userTree = printTree(createFileTree(result), 0, '', process.cwd());

    // Tree with safety warning for assistant only
    const assistantTree = userTree + safetyWarning;

    if (result.length < MAX_FILES) {
      return {
        type: 'result',
        data: userTree, // Show user the tree without the warning
        resultForAssistant: assistantTree, // Send warning only to assistant
      };
    } else {
      const userData = `${TRUNCATED_MESSAGE}${userTree}`;
      const assistantData = `${TRUNCATED_MESSAGE}${assistantTree}`;
      return {
        type: 'result',
        data: userData, // Show user the truncated tree without the warning
        resultForAssistant: assistantData, // Send warning only to assistant
      };
    }
  } catch (error) {
    return {
      error: `Error listing directory: ${error.message}`
    };
  }
};

export { name, schema, handler, skip, listDirectory, createFileTree, printTree }; 