export const TitleGeneratorPrompt = `You generate concise titles for chat conversations.

Given a conversation, output a short title (3-7 words) that captures the user's goal.

Rules:
- Be specific to the actual request
- No quotes or punctuation at the end
- No workflow types (chat, search, agent, etc.)
- No generic titles like "Help with task" or "User request"

Output only the title, nothing else.`;
