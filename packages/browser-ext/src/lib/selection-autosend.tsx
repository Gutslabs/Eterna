/**
 * SelectionAutoSend
 *
 * Consumes the `aipex-pending-autosend` payload written by the in-page
 * "Ask Eterna" selection bar and submits it to the chat as soon as the agent
 * is ready. Renders nothing.
 *
 * Only the visible (active-tab) panel acts on the payload, so a selection made
 * in one tab isn't double-sent by other tabs that also have the panel open.
 * The payload is cleared from storage as soon as it is consumed.
 */

import {
  useAgentContext,
  useChatContext,
} from "@aipexstudio/aipex-react/components/chatbot";
import { useEffect, useRef, useState } from "react";

const PENDING_AUTOSEND_KEY = "aipex-pending-autosend";
const MAX_AGE_MS = 15000;

export function SelectionAutoSend() {
  const { isReady } = useAgentContext();
  const { sendMessage } = useChatContext();
  const [pending, setPending] = useState<string | null>(null);
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;

  useEffect(() => {
    const consume = (value: unknown) => {
      // Only the focused/visible panel sends, to avoid duplicate sends across
      // tabs that share the global open state.
      if (document.visibilityState !== "visible") return;
      const payload = value as { text?: unknown; ts?: unknown } | null;
      const text = payload?.text;
      const ts = payload?.ts;
      if (
        typeof text === "string" &&
        text.trim() &&
        typeof ts === "number" &&
        Date.now() - ts < MAX_AGE_MS
      ) {
        setPending(text);
      }
      chrome.storage.local.remove(PENDING_AUTOSEND_KEY).catch(() => {});
    };

    chrome.storage.local
      .get(PENDING_AUTOSEND_KEY)
      .then((result) => {
        if (result[PENDING_AUTOSEND_KEY]) {
          consume(result[PENDING_AUTOSEND_KEY]);
        }
      })
      .catch(() => {});

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PENDING_AUTOSEND_KEY]?.newValue) {
        consume(changes[PENDING_AUTOSEND_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Submit once the agent is ready.
  useEffect(() => {
    if (pending && isReady) {
      const text = pending;
      setPending(null);
      void sendRef.current(text);
    }
  }, [pending, isReady]);

  return null;
}
