import { PROMPT_CACHING_ENABLED } from './constants.js';
import { formatSystemPromptWithContext } from './context.js';

export async function api({ messages, tools, systemPrompt, model = "claude-3-5-haiku-latest", maxTokens = 1024 }) {
  const url = "https://api.anthropic.com/v1/messages";
  const headers = {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  };
  if(model === "claude-3-7-sonnet-20250219") {
    headers["anthropic-beta"] = "token-efficient-tools-2025-02-19";
  }

  const body = {
    system: systemPrompt.map(prompt => ({ type: "text", text: prompt })),
    model: model,
    messages: messages,
    tools: tools,
    max_tokens: maxTokens
  };

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`HTTP error! status: ${response.status}, error: ${JSON.stringify(error)}`);
  }
  const res = await response.json();
  return res;
}


function log(block) {
  if(typeof block === "string") {
    console.log(block);
  } else if(Array.isArray(block)) {
    for(const item of block) {
      log(item);
    }
  } else if(typeof block === "object") {
    if(block.role) {
      console.log(`\x1b[36m> ${block.role}\x1b[0m`);
      log(block.content);
      console.log("\n");
      return
    } else if (block.text) {
      console.log(block.text);
      console.log("\n");
    } else if (block.type === "tool_use") {
      console.log(`\x1b[32m> ${block.name}\x1b[0m: ${JSON.stringify(block.input)}`);
    } else if(block.type === "tool_result") {
      try {
          const obj = JSON.parse(block.content);
          console.log(`\x1b[34m> ${block.tool_use_id}\x1b[0m\n`);
          console.log(obj);
      } catch (e) {
        console.log(`\x1b[34m> ${block.tool_use_id}\x1b[0m: ${block.content}`);
      }
    }
    if(block.usage) {
      console.log(`\x1b[33m> Usage\x1b[0m: ${JSON.stringify(block.usage)}`);
    }
  }
}

function addMessageWithPromptCaching(message) {
  if (!message.role || !PROMPT_CACHING_ENABLED) return message;

  const isAssistant = message.role === 'assistant';
  
  // Handle string content
  if (typeof message.content === 'string') {
    return {
      ...message,
      content: [{
        type: 'text',
        text: message.content,
        cache_control: { type: 'ephemeral' }
      }]
    };
  }
  
  // Handle array content
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((item, i) => {
        // Only add cache to the last item
        const isLastItem = i === message.content.length - 1;
        
        // For assistant messages, exclude special types
        const skipCaching = isAssistant && (
          item.type === 'tool_use' || 
          item.type === 'tool_result' || 
          item.type === 'thinking' || 
          item.type === 'redacted_thinking'
        );
        
        return {
          ...item,
          ...(isLastItem && !skipCaching ? { cache_control: { type: 'ephemeral' } } : {})
        };
      })
    };
  }
  
  return message;
}

function addCacheToMessages(messages) {
  return messages.map((message, index) => {
    if (index > messages.length - 3) {
      return addMessageWithPromptCaching(message);
    } else {
      return message;
    }
  })
}

export async function query({ messages, tools, systemPrompt, model = "claude-3-5-haiku-latest", maxTokens = 1024 }) {
  // Create initial user message with caching

  const toolSchema = tools.map(tool => ({
    name: tool.name,
    description: tool.schema.description,
    input_schema: tool.schema.input_schema || tool.schema.parameters
  }));

  systemPrompt = formatSystemPromptWithContext(systemPrompt);
  
  while (true) {
    try {
      console.log(systemPrompt);
      console.log(JSON.stringify(tools, null, 2));
      const apiResponse = await api({ messages: addCacheToMessages(messages), tools: toolSchema, systemPrompt, model, maxTokens });
      const assistantMessage = { 
        role: apiResponse.role, 
        content: apiResponse.content 
      };
      messages.push(assistantMessage);

      log(apiResponse);

      const toolCalls = [];
      if(Array.isArray(apiResponse.content)) {
        for(const block of apiResponse.content) {
          if(block.type === "tool_use") {
            toolCalls.push(block);
          }
        }
      } 

      if(toolCalls.length > 0) {
        await Promise.all(toolCalls.map(async (toolCall) => {
          const toolResult = await tools.find(tool => tool.name === toolCall.name)?.handler?.(toolCall) || '<tool-not-found>';

          const message = {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: toolResult.resultForAssistant ? JSON.stringify(toolResult.resultForAssistant) : ''
            }]
          };
          log(message);
          messages.push(message);
        }));
      } else {
        return assistantMessage;
      }
    } catch (error) {
      console.error("Error:", error.message);
      break;
    }
  }
}