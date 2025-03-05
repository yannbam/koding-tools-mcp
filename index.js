import { query } from './api.js';
import { tools } from './tools.js';
import { getSystemPrompt } from './prompts.js';

async function main() { 
  const systemPrompt = await getSystemPrompt();

  const userPrompt = process.argv[2] == '-p' ? process.argv.slice(3).join(' ') : "list the files in the current directory";
  await query({ userPrompt, tools, systemPrompt }).catch(error => console.error("Error:", error));
}

main();
