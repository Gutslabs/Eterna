"use client";

/**
 * Vendored from beui's agent-code, minus the shiki highlighter. The original
 * renders plain text until shiki tokens arrive; Eterna ships that plain-text
 * path only, because bundling a second shiki (streamdown already embeds one
 * for chat markdown) would cost far more than syntax colors on short JSON
 * argument previews are worth. The public surface is unchanged so the other
 * vendored components keep working against upstream's API.
 */

import { type CSSProperties, Fragment } from "react";
import { cn } from "../../../lib/utils";

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript";

export interface AgentCodeToken {
  content: string;
  offset: number;
  light?: string;
  dark?: string;
}

export type AgentCodeTokenLines = AgentCodeToken[][];

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}

export function useAgentCodeTokens(
  _code: string,
  _language: AgentCodeLanguage,
): AgentCodeTokenLines | null {
  return null;
}

export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark":
                    token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}

export function AgentCode({ code, className }: AgentCodeProps) {
  const lines = code.split("\n");

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-foreground/85 text-xs leading-5",
        className,
      )}
    >
      <code>
        {lines.map((content, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are static per render
          <Fragment key={index}>
            <AgentCodeLine code={content} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
