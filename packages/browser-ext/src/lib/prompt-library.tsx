/**
 * PromptLibrary
 *
 * A row of quick-action pills shown ABOVE the input box (where Dia shows
 * Analyze / Explain / Summarize). Each pill is a saved prompt; clicking it
 * attaches that prompt to the chat as a context chip/card — like the page chip —
 * so the prompt text is sent to the AI without being typed into the box.
 *
 * At most 3 pills are shown (pinned ones first). The "+" button opens a menu
 * (upward, to stay clear of the input) listing every saved prompt: attach any,
 * pin up to 3 to the bar, delete, or create a new one.
 *
 * It renders outside the PromptInput provider, so it hands the chosen prompt off
 * via chrome.storage (`aipex-pending-context`), which BrowserContextLoader turns
 * into a chip. Prompts persist locally.
 */

import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@aipexstudio/aipex-react/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@aipexstudio/aipex-react/components/ui/dropdown-menu";
import { Input } from "@aipexstudio/aipex-react/components/ui/input";
import { Textarea } from "@aipexstudio/aipex-react/components/ui/textarea";
import { BookmarkIcon, PinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aipex-saved-prompts";
const PENDING_CONTEXT_KEY = "aipex-pending-context";
const MAX_PILLS = 3;

const PILL_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#343434] bg-[#272727] px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-[#2f2f2f] hover:text-foreground";

interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  pinned?: boolean;
}

export function PromptLibrary() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    const load = () => {
      chrome.storage.local
        .get(STORAGE_KEY)
        .then((result) => {
          const list = result[STORAGE_KEY];
          if (Array.isArray(list)) setPrompts(list as SavedPrompt[]);
        })
        .catch(() => {});
    };
    load();

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        const value = changes[STORAGE_KEY].newValue;
        setPrompts(Array.isArray(value) ? (value as SavedPrompt[]) : []);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const persist = useCallback((list: SavedPrompt[]) => {
    chrome.storage.local.set({ [STORAGE_KEY]: list }).catch(() => {});
  }, []);

  const attachPrompt = useCallback((prompt: SavedPrompt) => {
    chrome.storage.local
      .set({
        [PENDING_CONTEXT_KEY]: {
          label: prompt.name,
          value: prompt.content,
          metadata: { kind: "prompt" },
          ts: Date.now(),
        },
      })
      .catch(() => {});
  }, []);

  const deletePrompt = useCallback(
    (id: string) => {
      setPrompts((prev) => {
        const next = prev.filter((p) => p.id !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const togglePin = useCallback(
    (id: string) => {
      setPrompts((prev) => {
        const next = prev.map((p) =>
          p.id === id ? { ...p, pinned: !p.pinned } : p,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const saveNewPrompt = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || !trimmedContent) return;
    setPrompts((prev) => {
      const next = [
        ...prev,
        { id: crypto.randomUUID(), name: trimmedName, content: trimmedContent },
      ];
      persist(next);
      return next;
    });
    setName("");
    setContent("");
    setDialogOpen(false);
  }, [name, content, persist]);

  // Pinned prompts first, capped to keep the bar tidy.
  const visiblePrompts = [...prompts]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .slice(0, MAX_PILLS);

  return (
    <div className="mb-2 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
      {visiblePrompts.map((prompt) => (
        <button
          key={prompt.id}
          type="button"
          onClick={() => attachPrompt(prompt)}
          title={prompt.content}
          className={PILL_CLASS}
        >
          <BookmarkIcon className="size-3" />
          <span className="max-w-[160px] truncate">{prompt.name}</span>
        </button>
      ))}

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" title="All prompts" className={PILL_CLASS}>
            <PlusIcon className="size-3" />
            {prompts.length === 0 && <span>Add prompt</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-72"
        >
          {prompts.length === 0 ? (
            <div className="px-2 py-3 text-center text-muted-foreground text-xs">
              No saved prompts yet
            </div>
          ) : (
            <div className="flex max-h-56 flex-col overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-1 hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => {
                      attachPrompt(prompt);
                      setMenuOpen(false);
                    }}
                    title={prompt.content}
                    className="min-w-0 flex-1 truncate py-0.5 text-left text-sm"
                  >
                    {prompt.name}
                  </button>
                  <button
                    type="button"
                    aria-label={prompt.pinned ? "Unpin from bar" : "Pin to bar"}
                    title={prompt.pinned ? "Unpin from bar" : "Pin to bar"}
                    onClick={() => togglePin(prompt.id)}
                    className={
                      prompt.pinned
                        ? "shrink-0 p-1 text-foreground"
                        : "shrink-0 p-1 text-muted-foreground hover:text-foreground"
                    }
                  >
                    <PinIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete prompt"
                    onClick={() => deletePrompt(prompt.id)}
                    className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="my-1 border-border border-t" />

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setTimeout(() => setDialogOpen(true), 0);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <PlusIcon className="size-3.5" />
            New prompt
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save a prompt</DialogTitle>
            <DialogDescription>
              It appears in the prompt menu; pin up to {MAX_PILLS} to show them
              as pills above the input.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Name (e.g. Fix grammar)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              placeholder="Prompt text…"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-28"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveNewPrompt}
              disabled={!name.trim() || !content.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
