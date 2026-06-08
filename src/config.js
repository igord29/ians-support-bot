// Single source of truth for the Claude model the bot uses.
// Update here and both the bot and the diagnostics pick it up.
//
// claude-sonnet-4-6 replaces claude-sonnet-4-20250514 (Sonnet 4.0), which is
// deprecated and retires 2026-06-15. claude-sonnet-4-6 is the drop-in successor.
export const MODEL = "claude-sonnet-4-6";

// Who this deployment belongs to. Used in scheduler greetings and as a default
// in the system prompt. Override per deployment with AGENT_OWNER_NAME so the
// same codebase can run a separate bot for a different person.
export const OWNER_NAME = process.env.AGENT_OWNER_NAME || "Ian";
