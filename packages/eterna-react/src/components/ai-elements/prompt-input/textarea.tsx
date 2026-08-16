"use client";

import {
  type ChangeEvent,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ComponentProps,
  type KeyboardEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/utils";
import { Textarea } from "../../ui/textarea";
import {
  CONTEXT_ICONS,
  type ContextItem,
  type SkillItem,
  usePromptInputAttachments,
  usePromptInputContexts,
  usePromptInputSkills,
} from "./context";

const PASTED_TEXT_FILE_MIN_CHARACTERS = 1000;
const PASTED_TEXT_FILE_MIN_LINES = 8;

function shouldAttachPastedText(
  text: string,
  options: { hasHtml: boolean; hasFiles: boolean },
): boolean {
  if (!text.trim()) {
    return false;
  }

  const lineCount = text.split(/\r?\n/).length;
  const isSubstantial =
    text.length >= PASTED_TEXT_FILE_MIN_CHARACTERS ||
    lineCount >= PASTED_TEXT_FILE_MIN_LINES;

  // Pasting files (e.g. a copied image) often carries incidental clipboard
  // text (the image's URL, surrounding page text). That junk must NOT become
  // a pasted-text.txt — with files present, only genuinely substantial text
  // earns an attachment; short text goes into the input instead.
  if (options.hasFiles) {
    return isSubstantial;
  }
  return options.hasHtml || isSubstantial;
}

/**
 * Custom hook for typing animation effect
 * Extracted from typing text component algorithm
 */
export function useTypingPlaceholder(
  texts: string[],
  options: {
    typingSpeed?: number;
    deletingSpeed?: number;
    pauseDuration?: number;
    loop?: boolean;
  } = {},
  enabled = true,
) {
  const {
    typingSpeed = 50,
    deletingSpeed = 30,
    pauseDuration = 2000,
    loop = true,
  } = options;

  const [displayedText, setDisplayedText] = useState("");
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentTextIndex, setCurrentTextIndex] = useState(0);

  useEffect(() => {
    // The animation renders the textarea at ~20Hz while it types; don't run
    // it at all when the caller isn't displaying the animated text.
    if (!enabled) return;
    if (texts.length === 0) return;

    let timeout: NodeJS.Timeout;
    const currentText = texts[currentTextIndex] ?? "";

    const executeTypingAnimation = () => {
      if (isDeleting) {
        if (displayedText === "") {
          setIsDeleting(false);
          if (currentTextIndex === texts.length - 1 && !loop) {
            return;
          }
          setCurrentTextIndex((prev) => (prev + 1) % texts.length);
          setCurrentCharIndex(0);
          timeout = setTimeout(() => {}, pauseDuration);
        } else {
          timeout = setTimeout(() => {
            setDisplayedText((prev) => prev.slice(0, -1));
          }, deletingSpeed);
        }
      } else {
        if (currentCharIndex < currentText.length) {
          timeout = setTimeout(() => {
            setDisplayedText((prev) => prev + currentText[currentCharIndex]);
            setCurrentCharIndex((prev) => prev + 1);
          }, typingSpeed);
        } else if (texts.length > 1) {
          timeout = setTimeout(() => {
            setIsDeleting(true);
          }, pauseDuration);
        }
      }
    };

    executeTypingAnimation();

    return () => clearTimeout(timeout);
  }, [
    enabled,
    currentCharIndex,
    displayedText,
    isDeleting,
    typingSpeed,
    deletingSpeed,
    pauseDuration,
    texts,
    currentTextIndex,
    loop,
  ]);

  return displayedText;
}

export type PromptInputTextareaProps = ComponentProps<typeof Textarea> & {
  /**
   * Enable typing animation for placeholder
   */
  enableTypingAnimation?: boolean;
  /**
   * Array of placeholder texts to cycle through (only used when enableTypingAnimation is true)
   */
  placeholderTexts?: string[];
  /**
   * Typing animation speed options
   */
  typingOptions?: {
    typingSpeed?: number;
    deletingSpeed?: number;
    pauseDuration?: number;
    loop?: boolean;
  };
};

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = "What would you like to know?",
  enableTypingAnimation = false,
  placeholderTexts,
  typingOptions,
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments();
  const contexts = usePromptInputContexts();
  const skills = usePromptInputSkills();
  const [isFocused, setIsFocused] = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [atPosition, setAtPosition] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuPosition, setMenuPosition] = useState({
    bottom: 0,
    left: 0,
    width: 0,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  // Skill slash command state
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [slashSearchQuery, setSlashSearchQuery] = useState("");
  const [slashPosition, setSlashPosition] = useState<number | null>(null);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const selectedSkillItemRef = useRef<HTMLButtonElement>(null);

  // Sync hasValue with external value prop (for controlled components)
  useEffect(() => {
    setHasValue(!!props.value);
  }, [props.value]);

  // Use typing animation for placeholder if enabled
  const textsToAnimate = useMemo(() => {
    if (placeholderTexts && placeholderTexts.length > 0) {
      return placeholderTexts;
    }
    return [placeholder];
  }, [placeholderTexts, placeholder]);

  const typingActive = enableTypingAnimation && !isFocused && !hasValue;
  const animatedPlaceholder = useTypingPlaceholder(
    textsToAnimate,
    typingOptions,
    typingActive,
  );

  const displayPlaceholder = typingActive ? animatedPlaceholder : placeholder;

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // Handle skill menu navigation
    if (showSkillMenu && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev + 1) % filteredSkills.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSkillIndex(
          (prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length,
        );
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedSkill = filteredSkills[selectedSkillIndex];
        if (selectedSkill) {
          handleSkillSelect(selectedSkill);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setShowSkillMenu(false);
        setSlashSearchQuery("");
        setSlashPosition(null);
        return;
      }
    }

    // Handle context menu navigation
    if (showContextMenu && filteredContexts.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredContexts.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) =>
            (prev - 1 + filteredContexts.length) % filteredContexts.length,
        );
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedContext = filteredContexts[selectedIndex];
        if (!selectedContext) {
          return;
        }
        handleContextSelect(selectedContext);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setShowContextMenu(false);
        setSearchQuery("");
        setAtPosition(null);
        return;
      }
    }

    // Normal textarea behavior
    if (e.key === "Enter") {
      // Don't submit if IME composition is in progress
      if (e.nativeEvent.isComposing) {
        return;
      }

      if (e.shiftKey) {
        // Allow newline
        return;
      }

      // Submit on Enter (without Shift)
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  // Handle context selection
  const handleContextSelect = useCallback(
    (context: ContextItem) => {
      if (!textareaRef.current || atPosition === null) return;

      // Add context to the list
      contexts.add(context);

      // Remove @ mention from text
      const currentValue = String(props.value || "");
      const beforeAt = currentValue.slice(0, atPosition);
      const afterSearch = currentValue.slice(
        textareaRef.current.selectionStart,
      );
      const newValue = beforeAt + afterSearch;

      // Trigger onChange with new value
      const syntheticEvent = {
        target: { value: newValue },
        currentTarget: { value: newValue },
      } as ChangeEvent<HTMLTextAreaElement>;
      onChange?.(syntheticEvent);

      // Close menu
      setShowContextMenu(false);
      setSearchQuery("");
      setAtPosition(null);

      // Refocus textarea
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = beforeAt.length;
          textareaRef.current.selectionEnd = beforeAt.length;
        }
      }, 0);
    },
    [atPosition, contexts, props.value, onChange],
  );

  // Handle skill selection
  const handleSkillSelect = useCallback(
    (skill: SkillItem) => {
      if (!textareaRef.current || slashPosition === null) return;

      // Add skill to the skills context
      skills.add({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      });

      // Remove /xxx from textarea (similar to @ handling)
      const currentValue = String(props.value || "");
      const beforeSlash = currentValue.slice(0, slashPosition);
      const afterSearch = currentValue.slice(
        textareaRef.current.selectionStart,
      );
      const newValue = beforeSlash + afterSearch;

      // Trigger onChange with new value
      const syntheticEvent = {
        target: { value: newValue },
        currentTarget: { value: newValue },
      } as ChangeEvent<HTMLTextAreaElement>;
      onChange?.(syntheticEvent);

      // Close menu
      setShowSkillMenu(false);
      setSlashSearchQuery("");
      setSlashPosition(null);

      // Refocus textarea
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = beforeSlash.length;
          textareaRef.current.selectionEnd = beforeSlash.length;
        }
      }, 0);
    },
    [slashPosition, skills, props.value, onChange],
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const clipboardData = event.clipboardData;
    const items = clipboardData?.items;

    if (!clipboardData || !items) {
      return;
    }

    const files: File[] = [];

    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    const text = clipboardData.getData("text/plain");
    const hasHtml = Array.from(clipboardData.types).includes("text/html");
    const attachTextAsFile = shouldAttachPastedText(text, {
      hasHtml,
      hasFiles: files.length > 0,
    });
    if (attachTextAsFile) {
      files.push(
        new File([text], "pasted-text.txt", {
          type: "text/plain;charset=utf-8",
          lastModified: Date.now(),
        }),
      );
    }

    if (files.length > 0) {
      event.preventDefault();
      attachments.add(files);
      // preventDefault also swallowed the text half of the paste; put short
      // text back into the input so nothing the user copied is lost.
      if (text && !attachTextAsFile) {
        const target = event.currentTarget;
        target.setRangeText(
          text,
          target.selectionStart ?? target.value.length,
          target.selectionEnd ?? target.value.length,
          "end",
        );
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  const handleChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    setHasValue(e.target.value.length > 0);

    // Detect @ symbol and search query
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    const beforeCursor = value.slice(0, cursorPos);

    // Match @ followed by any characters (not just \w)
    // Supports: @page, @tab, @current page, @github-repo, etc.
    const match = beforeCursor.match(/@([^\s]*)$/);
    const query = match?.[1];

    if (query !== undefined) {
      setAtPosition(beforeCursor.lastIndexOf("@"));
      setSearchQuery(query);
      setShowContextMenu(true);
    } else {
      setShowContextMenu(false);
      setSearchQuery("");
      setAtPosition(null);
    }

    // Detect / command for skills
    const slashMatch = beforeCursor.match(/\/([^\s]*)$/);
    if (slashMatch) {
      const slashQuery = slashMatch[1]; // Text after /
      setSlashPosition(beforeCursor.lastIndexOf("/"));
      setSlashSearchQuery(slashQuery ?? "");
      setShowSkillMenu(true);
    } else {
      setShowSkillMenu(false);
      setSlashSearchQuery("");
      setSlashPosition(null);
    }

    onChange?.(e);
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    // Don't close if clicking on context menu
    setTimeout(() => {
      setIsFocused(false);
    }, 200);
  };

  // Filter contexts based on search query with fuzzy matching
  const filteredContexts = useMemo(() => {
    if (!searchQuery) return contexts.availableContexts;

    const query = searchQuery.toLowerCase();

    return contexts.availableContexts.filter((item) => {
      // Match against label
      if (item.label.toLowerCase().includes(query)) return true;

      // Match against type
      if (item.type.toLowerCase().includes(query)) return true;

      // Match against value (URL, content preview, etc.)
      if (item.value.toLowerCase().includes(query)) return true;

      // Match against metadata URL if available
      if (item.metadata?.["url"]?.toLowerCase().includes(query)) return true;

      // Fuzzy match: check if query characters appear in order
      const labelLower = item.label.toLowerCase();
      let queryIndex = 0;
      for (let i = 0; i < labelLower.length && queryIndex < query.length; i++) {
        if (labelLower[i] === query[queryIndex]) {
          queryIndex++;
        }
      }
      if (queryIndex === query.length) return true;

      return false;
    });
  }, [contexts.availableContexts, searchQuery]);

  // Filter skills based on search query with fuzzy matching
  const filteredSkills = useMemo(() => {
    if (!slashSearchQuery) return skills.availableSkills;

    const query = slashSearchQuery.toLowerCase();

    return skills.availableSkills.filter((skill) => {
      // Match against name
      if (skill.name.toLowerCase().includes(query)) return true;

      // Match against description
      if (skill.description?.toLowerCase().includes(query)) return true;

      // Fuzzy match: check if query characters appear in order in name
      const nameLower = skill.name.toLowerCase();
      let queryIndex = 0;
      for (let i = 0; i < nameLower.length && queryIndex < query.length; i++) {
        if (nameLower[i] === query[queryIndex]) {
          queryIndex++;
        }
      }
      if (queryIndex === query.length) return true;

      return false;
    });
  }, [skills.availableSkills, slashSearchQuery]);

  // Reset selected index when filtered contexts change
  useEffect(() => {
    setSelectedIndex(filteredContexts.length ? 0 : -1);
  }, [filteredContexts]);

  // Reset selected skill index when filtered skills change
  useEffect(() => {
    setSelectedSkillIndex(0);
  }, []);

  // Auto-scroll to selected item when navigating with keyboard
  useEffect(() => {
    if (selectedIndex < 0) {
      return;
    }

    if (selectedItemRef.current && scrollContainerRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  // Auto-scroll to selected skill item when navigating with keyboard
  useEffect(() => {
    if (selectedSkillItemRef.current) {
      selectedSkillItemRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, []);

  // Calculate menu position when showing context menu or skill menu
  useEffect(() => {
    const updatePosition = () => {
      if ((showContextMenu || showSkillMenu) && textareaRef.current) {
        const rect = textareaRef.current.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        setMenuPosition({
          bottom: windowHeight - rect.top + 8, // Distance from bottom of viewport to top of textarea + 8px gap
          left: rect.left + window.scrollX,
          width: Math.min(500, window.innerWidth - 32), // 32px for padding
        });
      }
    };

    updatePosition();

    // Update position on scroll and resize
    if (!showContextMenu && !showSkillMenu) {
      return;
    }

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showContextMenu, showSkillMenu]);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        className={cn(
          "w-full resize-none rounded-none border-none px-3 py-2.5 shadow-none outline-none ring-0",
          "field-sizing-content bg-transparent dark:bg-transparent",
          "max-h-48 min-h-10",
          "focus-visible:ring-0",
          className,
        )}
        name="message"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={displayPlaceholder}
        {...props}
      />

      {/* Context Suggestion Menu - Portal Implementation */}
      {showContextMenu &&
        filteredContexts.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
            style={{
              bottom: `${menuPosition.bottom}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
            }}
          >
            <div className="bg-popover border rounded-lg shadow-xl max-h-[400px] overflow-hidden mb-2">
              {/* Search hint */}
              {searchQuery && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted/50">
                  Searching for:{" "}
                  <span className="font-medium">@{searchQuery}</span>
                  {filteredContexts.length > 0 && (
                    <span className="ml-2">
                      ({filteredContexts.length} found)
                    </span>
                  )}
                </div>
              )}

              {/* Results */}
              <div
                ref={scrollContainerRef}
                className="max-h-[350px] overflow-y-auto"
              >
                {filteredContexts.length > 0 &&
                  filteredContexts.map((context, index) => (
                    <button
                      key={context.id}
                      ref={index === selectedIndex ? selectedItemRef : null}
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left min-w-0 border-b last:border-b-0",
                        index === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      onClick={() => handleContextSelect(context)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <span className="text-muted-foreground shrink-0 w-4 h-4 flex items-center justify-center">
                        {context.icon || CONTEXT_ICONS[context.type]}
                      </span>
                      <span className="truncate flex-1 min-w-0">
                        {context.label}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                        {context.type}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Skill Command Menu - Portal Implementation */}
      {showSkillMenu &&
        filteredSkills.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
            style={{
              bottom: `${menuPosition.bottom}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
            }}
          >
            <div className="bg-popover border rounded-lg shadow-xl max-h-[400px] overflow-hidden mb-2">
              {/* Search hint */}
              <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted/50">
                {slashSearchQuery ? (
                  <>
                    Searching skills:{" "}
                    <span className="font-medium">/{slashSearchQuery}</span>
                    {filteredSkills.length > 0 && (
                      <span className="ml-2">
                        ({filteredSkills.length} found)
                      </span>
                    )}
                  </>
                ) : (
                  <span>{filteredSkills.length} skills available</span>
                )}
              </div>

              {/* Skills Results */}
              <div className="max-h-[350px] overflow-y-auto">
                {filteredSkills.map((skill, index) => (
                  <button
                    key={skill.id}
                    ref={
                      index === selectedSkillIndex ? selectedSkillItemRef : null
                    }
                    type="button"
                    className={cn(
                      "w-full flex flex-col gap-1 px-3 py-2 text-sm transition-colors text-left min-w-0 border-b last:border-b-0",
                      index === selectedSkillIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                    onClick={() => handleSkillSelect(skill)}
                    onMouseEnter={() => setSelectedSkillIndex(index)}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span className="font-medium truncate flex-1 min-w-0">
                        {skill.name}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 px-1.5 py-0.5 rounded bg-background/50">
                        skill
                      </span>
                    </div>
                    {skill.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {skill.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
