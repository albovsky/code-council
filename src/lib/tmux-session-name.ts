export interface TmuxSessionNameInput {
  chatId: string;
  phaseId: string;
  role: string;
  agent: string;
}

const VALID_TMUX_COMPONENT = /^[a-zA-Z0-9_-]+$/;

export function validateTmuxSessionNameComponent(value: string, field: string): string {
  if (!VALID_TMUX_COMPONENT.test(value)) {
    throw new Error(`Invalid ${field}: ${value} contains forbidden characters`);
  }
  return value;
}

export function buildTmuxSessionName(input: TmuxSessionNameInput): string {
  const chatId = validateTmuxSessionNameComponent(input.chatId, "chatId");
  const phaseId = validateTmuxSessionNameComponent(input.phaseId, "phaseId");
  const role = validateTmuxSessionNameComponent(input.role, "role");
  const agent = validateTmuxSessionNameComponent(input.agent, "agent");
  return `council-${chatId}-${phaseId}-${role}-${agent}`;
}
