import { AiConfig } from "../../shared/types";
import { getClient } from "./openai-client";
import { normalizeAiError, validateAiConfig } from "./ai-error";

/**
 * Agent for Ctrl+Shift+I: returns informational chat responses.
 * System prompt instructs the model to provide helpful,
 * concise answers about terminal usage and general topics.
 */
function buildSystemPrompt(shell?: string): string {
  const activeShell = shell?.trim() || "default terminal shell";

  return `You are a helpful terminal assistant embedded in a terminal app called pnex. The user will ask questions or request information. Rules:
- Provide clear, concise answers
- Use markdown formatting when helpful
- For code snippets, use backtick notation
- Focus on being practical and helpful
- You can answer about terminal commands, programming, system administration, and general topics
- The current terminal shell is: ${activeShell}
- When discussing commands, prefer examples that are compatible with that shell
- Keep responses focused and not overly verbose`;
}

/** Chat message for conversation context */
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Conversation history for multi-turn chat */
let conversationHistory: ChatMessage[] = [];

/**
 * Send a chat message and get an informational response.
 * Maintains conversation history for context.
 */
export async function executeChatAgent(
  prompt: string,
  config: AiConfig,
  shell?: string,
): Promise<string> {
  try {
    validateAiConfig(config);
    const client = getClient(config);
    const systemPrompt = buildSystemPrompt(shell);
    const userMessage: ChatMessage = {
      role: "user",
      content: prompt,
    };

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      userMessage,
    ];

    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    });

    const content =
      response.choices[0]?.message?.content || "No response from AI";

    conversationHistory.push(userMessage);
    conversationHistory.push({
      role: "assistant",
      content,
    });

    return content;
  } catch (error) {
    throw normalizeAiError(error);
  }
}

/** Clear conversation history (New Chat) */
export function clearChatHistory(): void {
  conversationHistory = [];
}
