import {
  type AppSettings,
  STORAGE_KEYS,
  updateAppSettings,
} from "@eterna/core";
import { cn } from "@eterna/react/lib/utils";
import { EyeIcon, EyeOffIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { chromeStorageAdapter } from "../../hooks";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export const loadSettings = async (): Promise<AppSettings> =>
  ((await chromeStorageAdapter.load(STORAGE_KEYS.SETTINGS)) as
    | AppSettings
    | undefined) ?? {};

export const saveSettings = async (
  updates: Partial<AppSettings>,
): Promise<AppSettings> =>
  updateAppSettings(chromeStorageAdapter, STORAGE_KEYS.SETTINGS, updates);

export const formatKb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

export function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-0.5 pt-1.5 pb-1.5">
      <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.07em]">
        {children}
      </span>
      {trailing}
    </div>
  );
}

export function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-[34px] shrink-0 rounded-full p-[2px] transition-colors",
        checked ? "justify-end bg-foreground" : "justify-start bg-muted",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full",
          checked ? "bg-background" : "bg-muted-foreground/70",
        )}
      />
    </button>
  );
}

export function TextField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  secret,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="px-0.5 text-[11.5px] text-muted-foreground">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </div>
      <div className="flex items-center gap-2 rounded-[9px] border border-border bg-muted/30 px-2.5 py-2 focus-within:border-muted-foreground/40">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70",
            mono && "font-mono text-[12px]",
          )}
        />
        {secret && (
          <button
            type="button"
            aria-label={show ? "Hide" : "Show"}
            onClick={() => setShow((s) => !s)}
            className="text-muted-foreground hover:text-foreground"
          >
            {show ? (
              <EyeOffIcon className="size-[13px]" />
            ) : (
              <EyeIcon className="size-[13px]" />
            )}
          </button>
        )}
      </div>
      {hint && (
        <div className="px-0.5 text-[10.5px] text-muted-foreground/80">
          {hint}
        </div>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-0.5 text-[11px] text-muted-foreground">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="resize-y rounded-[9px] border border-border bg-muted/30 px-2.5 py-[7px] text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-muted-foreground/40"
      />
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[9px] bg-foreground px-3.5 py-2 text-center font-semibold text-[12px] text-background transition-opacity hover:opacity-90 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[9px] border border-border bg-muted/30 px-2.5 py-[7px]">
      <SearchIcon className="size-[13px] shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}
