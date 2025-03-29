import fs from 'fs';
import path from 'path';
import { memoize } from './utils.js';
import { getCwd } from './persistent_shell.js';

const STYLE_PROMPT =
  'The codebase follows strict style guidelines shown below. All code changes must strictly adhere to these guidelines to maintain consistency and quality.';

export const getCodeStyle = memoize(() => {
  const styles = [];
  let currentDir = getCwd();

  while (currentDir !== path.parse(currentDir).root) {
    const stylePath = path.join(currentDir, 'KODING.md');
    if (fs.existsSync(stylePath)) {
      styles.push(
        `Contents of ${stylePath}:\n\n${fs.readFileSync(stylePath, 'utf-8')}`
      );
    }
    currentDir = path.dirname(currentDir);
  }

  if (styles.length === 0) {
    return '';
  }

  return `${STYLE_PROMPT}\n\n${styles.reverse().join('\n\n')}`;
});

export function formatSystemPromptWithContext(
  systemPrompt
) {
  
  const context = {
    codeStyle: getCodeStyle(),
  }

  return [
    ...systemPrompt,
    `\nAs you answer the user's questions, you can use the following context:\n`,
    ...Object.entries(context).map(
      ([key, value]) => `<context name="${key}">${value}</context>`,
    ),
  ]
}
