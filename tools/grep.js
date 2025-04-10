import { exec } from 'child_process';

const name = 'GrepTool';

const DESCRIPTION = `
ripgreg (rg) command for sophisticated content search in files

- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Use this tool when you need to find files containing specific patterns
`;

const MAX_LINES = 100;
const MAX_OUTPUT_LENGTH = 30000;

const schema = {
  name: name,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The regular expression pattern to search for in file contents"
      },
      baseDir: {
        type: "string",
        description: "cd to this directory before running rg to reduce output redundancy in absolute filepaths"
      },
      paths: {
        type: "string",
        description: "Relative paths with respect to baseDir. These are the directories and files to search in. Directories are searched recursively"
      },
      include: {
        type: "string",
        description: "Only include filenames that match this glob pattern (e.g. \"*.js\", \"*.{ts,tsx}\")"
      },
      args: {
        type: "string",
        description: "commandline arguments for rg (default: -ni)"
      }
    },
    required: ["pattern","baseDir"]
  }
};

const handler = async (toolCall) => {
  const { pattern, baseDir, paths = '.', include, args = '-ni' } = toolCall.input;
  let stdout = '';
  let stderr = '';
  
  try {
    // Build ripgrep command
    // let command = `cd ${path} && rg ${args} "${pattern}" .`;
    // if (include) {
    //   command += ` --glob "${include}"`;
    // }
    
    // Build ripgrep command
    let command = '';

    if (baseDir) {
      command = `cd ${baseDir} && `;
    } 
    command += `rg ${args} "${pattern}" ${paths}`;
    if (include) {
      command += ` --glob "${include}"`;
    }
    
    // prepend cmd line to output
    let output = `[Executed \"${command}\"]\n\n`;

    // Execute command
    const result = await new Promise((resolve, reject) => {
      const childProcess = exec(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      
      let stdoutData = '';
      let stderrData = '';
      
      childProcess.stdout.on('data', (data) => {
        stdoutData += data;
      });
      
      childProcess.stderr.on('data', (data) => {
        stderrData += data;
      });
      
      childProcess.on('close', (code) => {
        resolve({
          stdout: stdoutData,
          stderr: stderrData,
          code
        });
      });
      
      childProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    stdout = (result.stdout || '').trim();
    stderr = (result.stderr || '').trim();
    
    // if (result.code !== 0) {
    //   return {
    //     error: output + stderr
    //   };
    // }
    

    // Process results
    const lines = stdout.split('\n').filter(Boolean);
    const numLines = lines.length;
    
    // Sort files by modification time (would need fs.stat in a real implementation)
    // For simplicity, we'll just return them as is
    
    // Truncate if too many results
    const truncatedLines = lines.slice(0, MAX_LINES);
    const isTruncated = numLines > MAX_LINES;
    
    // Format output
    // let output = `[Executed ${command}\nFound ${numLines} file${numLines === 1 ? '' : 's'}\n`;
    if (numLines > 0) {
      output += truncatedLines.join('\n');
      if (isTruncated) {
        output += '\n(Results are truncated. Consider using a more specific path or pattern.)';
      }
    }
    
    
    // Truncate if too long
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + 
        '\n... (output truncated due to length)';
    }
    
    // Add stderr if there were errors, but still return output
    if (result.code !== 0) {
      return {
        content: [{ 
          type: "text", 
          text: output + '\n\n' + stderr
        }],
        isError: true
      };
    }


    return {
      content: [{ 
        type: "text", 
        text: output
      }],
      isError: false
    };
  } catch (error) {
    return {
      content: [{ 
        type: "text", 
        text: error.message
      }],
      isError: true
    };
  }
};

export { name, schema, handler }; 
