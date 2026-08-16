"use client";

import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import {
  type ChangeEventHandler,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import {
  AttachmentsContext,
  type ContextItem,
  ContextItemsContext,
  type SkillItem,
  SkillItemsContext,
} from "./context";

export type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
  contexts?: ContextItem[];
  skills?: SkillItem[];
};

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit"
> & {
  accept?: string; // e.g., "image/*" or leave undefined for any
  multiple?: boolean;
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean;
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean;
  // Minimal constraints
  maxFiles?: number;
  maxFileSize?: number; // bytes
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [availableContexts, setAvailableContexts] = useState<ContextItem[]>([]);
  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Find nearest form to scope drag & drop
  useEffect(() => {
    const root = anchorRef.current?.closest("form");
    if (root instanceof HTMLFormElement) {
      formRef.current = root;
    }
  }, []);

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }
      // Simple check: if accept includes "image/*", filter to images; otherwise allow.
      if (accept.includes("image/*")) {
        return f.type.startsWith("image/");
      }
      return true;
    },
    [accept],
  );

  const add = useCallback(
    (files: File[] | FileList) => {
      const incoming = Array.from(files);
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (sized.length === 0 && accepted.length > 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return;
      }
      setItems((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            id: nanoid(),
            type: "file",
            url: URL.createObjectURL(file),
            mediaType: file.type,
            filename: file.name,
          });
        }
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const file of prev) {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
      return [];
    });
  }, []);

  // Context management callbacks
  const addContext = useCallback((context: ContextItem) => {
    setContextItems((prev) => {
      // Avoid duplicates
      if (prev.some((item) => item.id === context.id)) {
        return prev;
      }
      return [...prev, context];
    });
  }, []);

  const removeContext = useCallback((id: string) => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearContexts = useCallback(() => {
    // Persistent contexts (e.g. the current page) stay attached across sends so
    // every message carries them; only an explicit remove drops them.
    setContextItems((prev) => prev.filter((item) => item.persistent));
  }, []);

  // Skill management callbacks
  const addSkill = useCallback((skill: SkillItem) => {
    setSkillItems((prev) => {
      // Avoid duplicates
      if (prev.some((item) => item.id === skill.id)) {
        return prev;
      }
      return [...prev, skill];
    });
  }, []);

  const removeSkill = useCallback((id: string) => {
    setSkillItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearSkills = useCallback(() => {
    setSkillItems([]);
  }, []);

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current) {
      // Clear the input when items are cleared
      if (items.length === 0) {
        inputRef.current.value = "";
      }
    }
  }, [items, syncHiddenInput]);

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add]);

  useEffect(() => {
    if (!globalDrop) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) {
      add(event.currentTarget.files);
    }
  };

  const convertBlobUrlToDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const text = (formData.get("message") as string) || "";

    // Convert blob URLs to data URLs asynchronously
    void Promise.all(
      items.map(async ({ id, ...item }) => {
        if (item.url?.startsWith("blob:")) {
          return {
            ...item,
            url: await convertBlobUrlToDataUrl(item.url),
          };
        }
        return item;
      }),
    ).then((files: FileUIPart[]) => {
      onSubmit(
        { text, files, contexts: contextItems, skills: skillItems },
        event,
      );
      clear();
      clearContexts();
      clearSkills();
    });
  };

  const ctx = useMemo<AttachmentsContext>(
    () => ({
      files: items.map((item) => ({ ...item, id: item.id })),
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
    }),
    [items, add, remove, clear, openFileDialog],
  );

  const contextsCtx = useMemo<ContextItemsContext>(
    () => ({
      items: contextItems,
      add: addContext,
      remove: removeContext,
      clear: clearContexts,
      availableContexts,
      setAvailableContexts,
    }),
    [contextItems, addContext, removeContext, clearContexts, availableContexts],
  );

  const skillsCtx = useMemo<SkillItemsContext>(
    () => ({
      items: skillItems,
      add: addSkill,
      remove: removeSkill,
      clear: clearSkills,
      availableSkills,
      setAvailableSkills,
    }),
    [skillItems, addSkill, removeSkill, clearSkills, availableSkills],
  );

  return (
    <AttachmentsContext.Provider value={ctx}>
      <ContextItemsContext.Provider value={contextsCtx}>
        <SkillItemsContext.Provider value={skillsCtx}>
          <span aria-hidden="true" className="hidden" ref={anchorRef} />
          <input
            accept={accept}
            className="hidden"
            multiple={multiple}
            onChange={handleChange}
            ref={inputRef}
            type="file"
          />
          <form
            className={cn(
              "w-full divide-y overflow-hidden rounded-xl border bg-background shadow-sm",
              className,
            )}
            onSubmit={handleSubmit}
            {...props}
          >
            {children}
          </form>
        </SkillItemsContext.Provider>
      </ContextItemsContext.Provider>
    </AttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn(className, "flex flex-col")} {...props} />
);
