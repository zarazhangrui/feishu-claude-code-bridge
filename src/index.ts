// Public exports — useful for smoke tests / debugging tools that want
// to reuse the same rendering logic the bot itself uses.
export { renderCard } from './card/run-renderer';
export { renderText } from './card/text-renderer';
export {
  initialState,
  reduce,
  finalizeIfRunning,
  markInterrupted,
} from './card/run-state';
export type { RunState, ToolEntry, Block, ToolStatus, Terminal, FooterStatus } from './card/run-state';

export * from './agent';
