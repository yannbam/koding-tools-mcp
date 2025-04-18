import { glob } from 'glob';
import { statSync } from 'fs';

const name = 'GlobTool';

const DESCRIPTION = `
- Fast file search tool that works with any codebase size
- Finds files by name pattern using glob syntax
- Supports full glob syntax (eg. "*.js", "**/*.{ts,tsx}", "src/**/*.test.js")
- Exclude files with the exclude parameter (eg. ["node_modules/**", "dist/**"])
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name pattern
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
`;

const MAX_RESULTS = 100;
const MAX_OUTPUT_LENGTH = 30000;

const schema = {
  name: name,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "array",
        items: { type: "string" },
        description: "The glob patterns to search for files (e.g. [\"**/*.ts\", \"**/*.tsx\"])"
      },
      path: {
        type: "string",
        description: "The directory to search in. Defaults to the current working directory."
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to exclude from the search (e.g. [\"node_modules/**\", \"dist/**\"])"
      }
    },
    required: ["pattern"]
  }
};

const handler = async (toolCall) => {
  const { pattern, path = '.', exclude } = toolCall.input;
  const start = Date.now();
  
  try {
    // First, check if the path exists and is accessible
    try {
      const stats = statSync(path);
      if (!stats.isDirectory()) {
        return {
          type: 'error',
          error: `Path is not a directory: ${path}`,
          resultForAssistant: `Path is not a directory: ${path}`
        };
      }
    } catch (error) {
      return {
        type: 'error',
        error: `Cannot access directory: ${path} - ${error.message}`,
        resultForAssistant: `Cannot access directory: ${path} - ${error.message}`
      };
    }
  
    // Configure glob options
    const options = {
      cwd: path,
      nocase: true,
      nodir: true,
      stat: true,        // Enable stat to get modification time
      withFileTypes: true // Return file objects with stats
    };
    
    // Add exclude pattern(s) if provided
    if (exclude && exclude.length > 0) {
      options.ignore = exclude;
    }
    
    // Execute glob search
    let paths;
    try {
      paths = await glob(pattern, options);
    } catch (error) {
      return {
        type: 'error',
        error: `Error during glob search: ${error.message}`,
        resultForAssistant: `Error during glob search: ${error.message}`
      };
    }
    
    // Sort by modification time
    const sortedPaths = paths.sort((a, b) => (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0));
    
    // Limit results and check for truncation
    const truncated = sortedPaths.length > MAX_RESULTS;
    const truncatedFiles = sortedPaths.slice(0, MAX_RESULTS).map(path => path.fullpath());
    const numFiles = truncatedFiles.length;
    
    // Format output
    let output = `Found ${numFiles} file${numFiles === 1 ? '' : 's'}\n`;
    if (numFiles > 0) {
      output += truncatedFiles.join('\n');
      if (truncated) {
        output += '\n(Results are truncated. Consider using a more specific pattern.)';
      }
    }
    
    // Calculate duration
    const durationMs = Date.now() - start;
    
    // Prepare output object
    const outputObj = {
      filenames: truncatedFiles,
      durationMs,
      numFiles
    };
    
    // Truncate if too long
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + 
        '\n... (output truncated due to length)';
    }
    
    return {
      type: 'result',
      data: {
        pattern: toolCall.input.pattern,
        path: path,
        numResults: numFiles,
        truncated: truncated
      },
      resultForAssistant: output
    };
  } catch (error) {
    return {
      type: 'error',
      error: error.message,
      resultForAssistant: error.message
    };
  }
};

export { name, schema, handler };