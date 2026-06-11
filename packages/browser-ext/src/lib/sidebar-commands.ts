/**
 * Sidebar command bus
 *
 * The content script bootstrap receives sidebar toggle/open/close messages
 * from the background worker, but the React sidebar is loaded lazily. Commands
 * dispatched before the sidebar mounts are buffered and replayed once it
 * registers, so the very first toggle both loads the UI and opens the panel.
 */

export type SidebarCommand = "toggle" | "open" | "close";

type SidebarCommandHandler = (command: SidebarCommand) => void;

let handler: SidebarCommandHandler | null = null;
let pending: SidebarCommand | null = null;

export function dispatchSidebarCommand(command: SidebarCommand): void {
  if (handler) {
    handler(command);
  } else {
    pending = command;
  }
}

export function onSidebarCommand(next: SidebarCommandHandler): () => void {
  handler = next;
  if (pending) {
    const command = pending;
    pending = null;
    next(command);
  }
  return () => {
    if (handler === next) {
      handler = null;
    }
  };
}
