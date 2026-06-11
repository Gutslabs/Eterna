/**
 * In-page text selection action
 *
 * When the user selects text on the page — by mouse, or by keyboard such as
 * Cmd/Ctrl+A (including inside an input/textarea) — a small floating "Ask
 * Eterna" bar appears near the selection (like a native browser AI sidebar).
 * Clicking it
 * AUTO-SENDS the selected text to the chat and opens the panel. A prompt picker
 * (⌄) lets the user attach one of their saved prompts as the instruction —
 * picking a prompt auto-sends "prompt + selected text".
 *
 * The composed message is written to chrome.storage.local under
 * `aipex-pending-autosend` (consumed + submitted by SelectionAutoSend inside
 * the chat iframe), and this tab's panel is opened directly via the sidebar
 * command bus. Ctrl/Cmd+C while the panel is open still drops the selection in
 * as a context chip (via `aipex-pending-selection`) without sending.
 */

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { dispatchSidebarCommand } from "./sidebar-commands";
import { readSidebarOpen } from "./sidebar-open-flag";

const PENDING_SELECTION_KEY = "aipex-pending-selection";
const PENDING_AUTOSEND_KEY = "aipex-pending-autosend";
const SAVED_PROMPTS_KEY = "aipex-saved-prompts";
const MIN_SELECTION_LENGTH = 3;

interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  pinned?: boolean;
}

interface ButtonState {
  text: string;
  x: number;
  y: number;
}

const composeMessage = (selection: string, prompt?: SavedPrompt) =>
  prompt ? `${prompt.content}\n\n${selection}` : selection;

const PILL_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 10px",
  border: "1px solid #373737",
  background: "#272727",
  color: "#ebebeb",
  font: "500 12px/1 ui-sans-serif, system-ui, -apple-system, sans-serif",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function SelectionAction() {
  const [button, setButton] = useState<ButtonState | null>(null);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<ButtonState | null>(null);
  buttonRef.current = button;

  useEffect(() => {
    // Show the bar for either a page selection (document / contenteditable,
    // e.g. the X composer) or a focused text field (where Cmd+A selects the
    // value but leaves the document selection empty).
    const evaluate = () => {
      const selection = window.getSelection();
      const docText = selection?.toString().trim() ?? "";
      if (
        selection &&
        !selection.isCollapsed &&
        docText.length >= MIN_SELECTION_LENGTH
      ) {
        try {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (rect && (rect.width > 0 || rect.height > 0)) {
            setButton({
              text: docText,
              x: Math.min(rect.right, window.innerWidth - 8),
              y: Math.max(rect.top - 8, 8),
            });
            return;
          }
        } catch {
          // fall through to the field check / hide
        }
      }

      // Selection inside a focused <input>/<textarea> (incl. Cmd+A). The
      // document selection is empty in that case, so read it from the element.
      const el = document.activeElement;
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        el.type !== "password"
      ) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start != null && end != null && end > start) {
          const text = el.value.slice(start, end).trim();
          if (text.length >= MIN_SELECTION_LENGTH) {
            const rect = el.getBoundingClientRect();
            setButton({
              text,
              x: Math.min(rect.right, window.innerWidth - 8),
              y: Math.max(rect.top - 8, 8),
            });
            return;
          }
        }
      }

      setButton(null);
      setMenuOpen(false);
    };

    // Debounce so a mouse drag settles — and keyboard selections register —
    // before the bar appears.
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 100);
    };

    // `selectionchange` already covers keyboard selection (incl. Cmd+A and
    // Shift+Arrow) on the page; `select` (capture) covers input/textarea
    // selection, which doesn't bubble. No per-keystroke `keyup` listener needed.
    document.addEventListener("mouseup", schedule);
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("select", schedule, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseup", schedule);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("select", schedule, true);
    };
  }, []);

  // Load saved prompts (for the picker) and keep them in sync.
  useEffect(() => {
    const load = (value: unknown) => {
      setPrompts(Array.isArray(value) ? (value as SavedPrompt[]) : []);
    };
    chrome.storage.local
      .get(SAVED_PROMPTS_KEY)
      .then((result) => load(result[SAVED_PROMPTS_KEY]))
      .catch(() => {});
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[SAVED_PROMPTS_KEY]) {
        load(changes[SAVED_PROMPTS_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // While this tab's sidebar is open, copying selected text (Ctrl/Cmd+C) drops
  // it straight into the chat as a context chip — no extra click needed.
  useEffect(() => {
    const onCopy = () => {
      if (!readSidebarOpen()) return;
      const text = window.getSelection()?.toString().trim() ?? "";
      if (text.length < MIN_SELECTION_LENGTH) return;
      chrome.storage.local
        .set({
          [PENDING_SELECTION_KEY]: {
            text,
            url: location.href,
            title: document.title,
            ts: Date.now(),
          },
        })
        .catch(() => {});
      setButton(null);
    };

    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);

  // Auto-send: compose the message (optional prompt + selection) and hand it to
  // the chat iframe, which submits it immediately.
  const send = useCallback((prompt?: SavedPrompt) => {
    const current = buttonRef.current;
    if (!current) return;
    // Hand the composed message to the chat iframe (it submits on mount)…
    chrome.storage.local
      .set({
        [PENDING_AUTOSEND_KEY]: {
          text: composeMessage(current.text, prompt),
          ts: Date.now(),
        },
      })
      .catch(() => {});
    // …and open this tab's panel directly — no global flag, so other tabs stay
    // as they are.
    dispatchSidebarCommand("open");
    setButton(null);
    setMenuOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  if (!button) return null;

  const sortedPrompts = [...prompts].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
  );

  return (
    <div
      style={{
        position: "fixed",
        left: `${button.x}px`,
        top: `${button.y}px`,
        transform: "translate(-100%, -100%)",
        zIndex: 2147483646,
        display: "inline-flex",
        alignItems: "stretch",
        borderRadius: "8px",
        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
        overflow: "visible",
      }}
    >
      <button
        type="button"
        // Keep the page selection alive when clicking the bar.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => send()}
        style={{
          ...PILL_STYLE,
          borderRadius: prompts.length > 0 ? "8px 0 0 8px" : "8px",
          borderRight: prompts.length > 0 ? "none" : PILL_STYLE.border,
        }}
      >
        💬 Ask Eterna
      </button>

      {prompts.length > 0 && (
        <button
          type="button"
          title="Bir prompt seç ve gönder"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMenuOpen((open) => !open)}
          style={{
            ...PILL_STYLE,
            padding: "6px 8px",
            borderRadius: "0 8px 8px 0",
          }}
        >
          ⌄
        </button>
      )}

      {menuOpen && prompts.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: "180px",
            maxHeight: "240px",
            overflowY: "auto",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid #373737",
            background: "#202020",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.5)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <div
            style={{
              padding: "4px 8px",
              color: "#8f8f8f",
              font: "500 11px/1.4 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Prompt ile gönder
          </div>
          {sortedPrompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => send(prompt)}
              title={prompt.content}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                borderRadius: "6px",
                border: "none",
                background: "transparent",
                color: "#ebebeb",
                font: "500 12px/1.3 ui-sans-serif, system-ui, sans-serif",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "240px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2f2f2f";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {prompt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
