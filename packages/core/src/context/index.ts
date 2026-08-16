/**
 * Context Provider API
 * Framework-agnostic context provider system for Eterna agents
 */

export { ContextManager } from "./manager";
export type {
  Context,
  ContextManagerOptions,
  ContextProvider,
  ContextProviderCapabilities,
  ContextQuery,
  ContextType,
} from "./types";
export {
  formatContextsForPrompt,
  isContext,
  resolveContexts,
} from "./utils";
