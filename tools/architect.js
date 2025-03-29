import { query } from '../api.js';
import { LARGE_MODEL } from '../constants.js';

const name = 'ArchitectTool';

export const ARCHITECT_SYSTEM_PROMPT = `You are an expert software architect. Your role is to analyze technical requirements and produce clear, actionable implementation plans.
These plans will then be carried out by a junior software engineer so you need to be specific and detailed. However do not actually write the code, just explain the plan.

Follow these steps for each request:
1. Carefully analyze requirements to identify core functionality and constraints
2. Define clear technical approach with specific technologies and patterns
3. Break down implementation into concrete, actionable steps at the appropriate level of abstraction

Keep responses focused, specific and actionable. 

IMPORTANT: Do not ask the user if you should implement the changes at the end. Just provide the plan as described above.
IMPORTANT: Do not attempt to write the code or use any string modification tools. Just provide the plan.`;

export const DESCRIPTION =
  'Your go-to tool for any technical or coding task. Analyzes requirements and breaks them down into clear, actionable implementation steps. Use this whenever you need help planning how to implement a feature, solve a technical problem, or structure your code.';

// Function to get available tools for file exploration
async function getAvailableTools() {
  // Import tools dynamically to avoid circular dependencies
  const [bashModule, lsModule, fileReadModule, fileWriteModule, globModule, grepModule] = await Promise.all([
    import('./bash.js'),
    import('./ls.js'),
    import('./file-read.js'),
    import('./file-write.js'),
    import('./glob.js'),
    import('./grep.js')
  ]);
  
  return [
    bashModule,
    lsModule,
    fileReadModule,
    fileWriteModule,
    globModule,
    grepModule
  ];
}

const schema = {
  name: name,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The technical request or coding task to analyze"
      },
      context: {
        type: "string",
        description: "Optional context from previous conversation or system state"
      }
    },
    required: ["prompt"]
  }
};

const handler = async (toolCall) => {
  const { prompt, context = '' } = toolCall.input;
  
  try {
    const startTime = Date.now();
    
    // Get available tools for file exploration
    const tools = await getAvailableTools();
    
    // Log initialization
    console.log('Initializing architect...');
    
    // Create content based on whether context is provided
    const content = context
      ? `<context>${context}</context>\n\n${prompt}`
      : prompt;
    
    // Track tool usage
    let toolUseCount = 0;
    let totalTokens = 0;
    
    // Call the LLM with the prompt and tools
    console.log(tools)
    const result = await query({
      userPrompt: content,
      tools: tools,
      systemPrompt: [ARCHITECT_SYSTEM_PROMPT],
      model: LARGE_MODEL,
      maxTokens: 2048
    });
    
    // Extract the final response from the LLM
    let finalResponse = '';
    let data = [];
    
    if (result && result.content) {
      for (const block of result.content) {
        if (block.type === 'text') {
          finalResponse += block.text;
          data.push(block);
        }
        if (block.type === 'tool_use') {
          toolUseCount++;
        }
      }
      
      // Estimate tokens (in a real implementation, this would come from the API response)
      totalTokens = finalResponse.split(/\s+/).length * 1.3; // Rough estimate
    }
    
    const durationMs = Date.now() - startTime;
    
    // Create summary
    const summary = `Done (${toolUseCount === 1 ? '1 tool use' : `${toolUseCount} tool uses`} · ${Math.round(totalTokens)} tokens · ${(durationMs / 1000).toFixed(1)}s)`;
    
    return {
      output: data.length > 0 ? data : [{ type: 'text', text: "The architect completed the task but didn't provide a text response." }],
      summary: summary
    };
  } catch (error) {
    console.error('Architect error:', error);
    return {
      error: `Error running architect: ${error.message}`
    };
  }
};

export { name, schema, handler }; 