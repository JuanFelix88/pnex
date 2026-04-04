import { AiConfig, TerminalContext } from "../../shared/types";
import { getClient } from "./openai-client";
import { normalizeAiError, validateAiConfig } from "./ai-error";

/**
 * Agent for Ctrl+I: returns a single terminal command.
 * System prompt instructs the model to return ONLY
 * the command, no explanation or markdown.
 */
function buildSystemPrompt(shell?: string): string {
  const activeShell = shell?.trim() || "default terminal shell";

  return `You are a terminal command assistant. The user will describe what they want to do. You must respond with ONLY the exact terminal command to execute. Rules:
- Return ONLY the command, nothing else
- No markdown, no backticks, no explanation
- No newlines before or after the command
- If multiple commands are needed, chain them with && or ;
- The current terminal shell is: ${activeShell}
- The command must be valid for that shell syntax and conventions
- If the shell is Git Bash or bash, prefer POSIX shell syntax and avoid PowerShell cmdlets
- If the shell is PowerShell, prefer PowerShell-native commands and syntax
- If the shell is cmd.exe, prefer cmd-compatible syntax
- If command output is required, in the output with echo or equivalent used, always try to style starting with two new lines, auxiliary texts that indicate the result required with the command and the like for styling
- If you cannot determine a command, respond with: echo "Unable to determine command"`;
}

function buildUserPrompt(
  prompt: string,
  context?: TerminalContext,
  localFiles?: string[],
): string {
  const parts: string[] = [];

  if (context?.cwd) {
    parts.push(`[Current Directory]\n${context.cwd}`);
  }

  if (localFiles && localFiles.length > 0) {
    parts.push(`[Local Files]\n${localFiles.join("\n")}`);
  }

  if (context?.bufferLines && context.bufferLines.length > 0) {
    parts.push(
      `[Terminal Buffer (last ${context.bufferLines.length} lines)]\n${context.bufferLines.join("\n")}`,
    );
  }

  parts.push(`[User Request]\n${prompt}`);

  return parts.join("\n\n");
}

/**
 * Generate a terminal command from a natural language prompt.
 * @returns The raw command string to execute
 */
export async function executeCommandAgent(
  prompt: string,
  config: AiConfig,
  shell?: string,
  context?: TerminalContext,
  localFiles?: string[],
): Promise<string> {
  try {
    validateAiConfig(config);
    const client = getClient(config);
    const systemPrompt = buildSystemPrompt(shell);
    const userPrompt = buildUserPrompt(prompt, context, localFiles);

    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    return content?.trim() || 'echo "No response from AI"';
  } catch (error) {
    throw normalizeAiError(error);
  }
}
