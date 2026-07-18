import { ChevronDownIcon } from "lucide-react";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../../i18n/context";
import { translatedToolName } from "../../../i18n/tool-names";
import type { UIToolPart } from "../../../types";
import { Response } from "../../ai-elements/response";
import { ToolInput, ToolOutput, ToolScreenshot } from "../../ai-elements/tool";
import { formatToolOutput } from "../tools";
import {
  type ActivityStep,
  formatActivityDuration,
  toolTargetText,
  totalToolDurationMs,
} from "./activity-steps";

/** Activity rail styling uses the host application's semantic theme tokens. */
const RAIL_STYLES = `
@keyframes rail-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
@keyframes rail-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--foreground) 30%, transparent); }
  70%  { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes rail-bar {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(260%); }
}

.activity-rail {
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: 12px;
  padding: 11px 12px 13px;
}

.rail-header {
  display: flex; align-items: center; gap: 9px;
  margin-bottom: 11px;
}
.rail-pulse-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--foreground);
  flex-shrink: 0;
  animation: rail-pulse 1.6s ease-out infinite;
}
.rail-status {
  font-size: 12.5px; font-weight: 500;
  background: linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: rail-shimmer 2.2s linear infinite;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rail-status-static {
  font-size: 12.5px; font-weight: 500; color: var(--foreground);
}
.rail-time {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 10.5px; color: var(--muted-foreground);
  flex-shrink: 0;
}

.rail-track {
  display: flex; flex-direction: column;
  padding-left: 3px;
}

.rail-node { display: flex; gap: 11px; }
.rail-gutter {
  display: flex; flex-direction: column; align-items: center;
  width: 10px; flex-shrink: 0;
}
.rail-line {
  width: 1px; flex: 1;
  background: var(--border);
  margin-top: 3px;
}
.rail-content { padding-bottom: 12px; min-width: 0; flex: 1; }

.rail-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.rail-dot.done    { background: var(--muted-foreground); }
.rail-dot.active  { background: var(--foreground); animation: rail-pulse 1.6s ease-out infinite; }
.rail-dot.error   { background: var(--destructive); }
.rail-dot.pending { background: transparent; border: 1px solid var(--border); margin-top: 4px; }

.rail-step-title {
  font-size: 12px; font-weight: 500;
  color: var(--foreground); margin-bottom: 2px;
}
.rail-step-body {
  font-size: 11.5px; line-height: 1.5;
  color: var(--muted-foreground);
}
.rail-step-pending {
  font-size: 12px; color: var(--muted-foreground);
  padding-top: 2px;
}

.rail-tool-row {
  display: flex; align-items: center; gap: 7px;
  margin-bottom: 6px;
  width: 100%;
  background: none; border: none; padding: 0; text-align: left;
  cursor: pointer; font: inherit;
}
.rail-tool-chip {
  font-family: ui-monospace, monospace;
  font-size: 11px; color: var(--foreground);
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}
.rail-tool-chip.error { border-color: var(--destructive); }
.rail-tool-target {
  font-size: 11px; color: var(--muted-foreground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rail-tool-time {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 10.5px; color: var(--muted-foreground);
  flex-shrink: 0;
}
.rail-error-text {
  font-size: 11px; color: var(--destructive);
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.rail-progress {
  height: 2px; border-radius: 2px;
  background: var(--muted);
  overflow: hidden;
  max-width: 140px;
}
.rail-progress-glow {
  height: 100%; width: 40%;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--foreground), transparent);
  animation: rail-bar 1.3s ease-in-out infinite;
}

.rail-collapsed {
  display: flex; align-items: center; gap: 9px;
  width: 100%;
  padding: 8px 11px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  font: inherit; text-align: left;
}
.rail-collapsed:hover {
  border-color: var(--ring);
  background: var(--accent);
}
.rail-collapsed-label { font-size: 12px; color: var(--foreground); flex-shrink: 0; }
.rail-collapsed-chip {
  font-family: ui-monospace, monospace;
  font-size: 10.5px; color: var(--muted-foreground);
  background: var(--muted);
  border-radius: 5px;
  padding: 2px 6px;
  flex-shrink: 0;
}
.rail-collapsed-more { font-size: 10.5px; color: var(--muted-foreground); flex-shrink: 0; }
.rail-collapsed-time {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 10.5px; color: var(--muted-foreground);
  flex-shrink: 0;
}

.rail-shrink {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 250ms ease-out, opacity 250ms ease-out;
}
.rail-shrink.shrinking { grid-template-rows: 0fr; opacity: 0; }
.rail-shrink > div { overflow: hidden; }

.rail-detail { margin-top: 4px; }

@media (prefers-reduced-motion: reduce) {
  .rail-status {
    animation: none;
    background: none;
    -webkit-background-clip: initial;
    background-clip: initial;
    color: var(--foreground);
  }
  .rail-pulse-dot, .rail-dot.active { animation: none; }
  .rail-progress-glow { animation: none; width: 40%; }
}
`;

const SPARK_PATH =
  "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2 19 19M19 5l-2.8 2.8M7.8 16.2 5 19";

function SparkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
    >
      <path d={SPARK_PATH} />
    </svg>
  );
}

function isStepRunning(part: UIToolPart): boolean {
  return part.state === "executing" || part.state === "pending";
}

function dotClass(step: ActivityStep, isActive: boolean): string {
  if (step.kind === "tool" && step.part.state === "error") {
    return "rail-dot error";
  }
  if (isActive) {
    return "rail-dot active";
  }
  return "rail-dot done";
}

function ToolNodeContent({
  part,
  showProgress,
}: {
  part: UIToolPart;
  showProgress: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const target = toolTargetText(part.input);
  const running = isStepRunning(part);

  return (
    <>
      <button
        type="button"
        className="rail-tool-row"
        onClick={() => setShowDetails((open) => !open)}
      >
        <span
          className={
            part.state === "error" ? "rail-tool-chip error" : "rail-tool-chip"
          }
        >
          {part.toolName}
        </span>
        {target && <span className="rail-tool-target">{target}</span>}
        {typeof part.duration === "number" && part.duration > 0 && (
          <span className="rail-tool-time">
            {formatActivityDuration(part.duration)}
          </span>
        )}
      </button>
      {part.state === "error" && part.errorText && (
        <div className="rail-error-text">{part.errorText}</div>
      )}
      {showProgress && running && (
        <div className="rail-progress">
          <div className="rail-progress-glow" />
        </div>
      )}
      {showDetails && !running && (
        <div className="rail-detail">
          <ToolInput input={part.input} />
          <ToolOutput
            output={
              part.output ? (
                <Response>{formatToolOutput(part.output)}</Response>
              ) : undefined
            }
            errorText={part.errorText}
          />
          <ToolScreenshot
            screenshot={part.screenshot}
            screenshotUid={part.screenshotUid}
          />
        </div>
      )}
    </>
  );
}

function RailTrack({
  steps,
  isLive,
}: {
  steps: ActivityStep[];
  isLive: boolean;
}) {
  const { t } = useTranslation();

  const rows: ReactNode[] = steps.map((step, index) => {
    const isLastStep = index === steps.length - 1;
    const withLine = !isLastStep || isLive;
    const isActive =
      isLive && (step.kind === "tool" ? isStepRunning(step.part) : isLastStep);

    return (
      <div key={step.key} className="rail-node">
        <div className="rail-gutter">
          <div className={dotClass(step, isActive)} />
          {withLine && <div className="rail-line" />}
        </div>
        <div className="rail-content">
          {step.kind === "thought" ? (
            <>
              <div className="rail-step-title">{t("activity.plan")}</div>
              <div className="rail-step-body">{step.text}</div>
            </>
          ) : (
            <ToolNodeContent part={step.part} showProgress={isLive} />
          )}
        </div>
      </div>
    );
  });

  if (isLive) {
    rows.push(
      <div key="pending-answer" className="rail-node">
        <div className="rail-gutter">
          <div className="rail-dot pending" />
        </div>
        <div className="rail-step-pending">{t("activity.writeAnswer")}</div>
      </div>,
    );
  }

  return <div className="rail-track">{rows}</div>;
}

const LIVE_TICK_MS = 100;
const SETTLE_BEFORE_COLLAPSE_MS = 300;
const THOUGHT_SNIPPET_LENGTH = 42;

type RailPhase = "live" | "shrinking" | "collapsed" | "open";

export interface ActivityRailProps {
  steps: ActivityStep[];
  /** True while this turn is still thinking / running tools (no answer yet). */
  isLive: boolean;
}

/**
 * Activity rail — flight-recorder view of a turn: every step (thought, tool
 * call, answer) is a node on one vertical rail. Streams step by step while
 * live, then settles 300ms and shrinks into a one-line summary. Clicking the
 * summary reopens the frozen rail (no pulse, no shimmer).
 */
export const ActivityRail = memo(function ActivityRail({
  steps,
  isLive,
}: ActivityRailProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<RailPhase>(isLive ? "live" : "collapsed");
  // Stable identity: ShrinkAway keys its rAF + fallback effect on this, and
  // streaming re-renders would otherwise re-arm them every 50ms publish.
  const collapseNow = useCallback(() => setPhase("collapsed"), []);

  // Live elapsed: ticks every 100ms, shown with 0.1s precision; the final
  // value freezes as the rail's total when the turn completes live. The
  // start resets on every rising edge — a rail can go live again (e.g. a
  // retry re-runs the turn) and must not resume the old count.
  const liveStartRef = useRef<number | null>(null);
  const finalElapsedRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isLive) {
      return;
    }
    liveStartRef.current = Date.now();
    finalElapsedRef.current = null;
    setElapsedMs(0);
    const tick = () => {
      if (liveStartRef.current !== null) {
        const elapsed = Date.now() - liveStartRef.current;
        finalElapsedRef.current = elapsed;
        setElapsedMs(elapsed);
      }
    };
    const timer = setInterval(tick, LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [isLive]);

  // live → settle 300ms → shrink (250ms grid transition) → collapsed row.
  useEffect(() => {
    if (isLive) {
      setPhase("live");
      return;
    }
    if (phase === "live") {
      const timer = setTimeout(
        () => setPhase("shrinking"),
        SETTLE_BEFORE_COLLAPSE_MS,
      );
      return () => clearTimeout(timer);
    }
  }, [isLive, phase]);

  const { activeStep, toolNames } = useMemo(() => {
    let active: ActivityStep | undefined;
    const names: string[] = [];
    for (const step of steps) {
      if (step.kind === "tool") {
        if (!names.includes(step.part.toolName)) {
          names.push(step.part.toolName);
        }
        if (isStepRunning(step.part)) {
          active = step;
        }
      }
    }
    if (!active && steps.length > 0) {
      const last = steps[steps.length - 1];
      if (last?.kind === "thought") {
        active = last;
      }
    }
    return { activeStep: active, toolNames: names };
  }, [steps]);

  if (steps.length === 0 && !isLive) {
    return null;
  }

  // Header always says WHAT it's doing: the active tool's verb-form name, or
  // "Thinking: <current thought…>" — never a bare generic label.
  const statusLabel = (() => {
    if (activeStep?.kind === "tool") {
      return translatedToolName(t, activeStep.part.toolName);
    }
    if (activeStep?.kind === "thought") {
      const snippet =
        activeStep.text.length > THOUGHT_SNIPPET_LENGTH
          ? `${activeStep.text.slice(0, THOUGHT_SNIPPET_LENGTH - 1)}…`
          : activeStep.text;
      return `${t("activity.thinking")}: ${snippet}`;
    }
    return `${t("activity.thinking")}…`;
  })();

  const totalMs = finalElapsedRef.current ?? totalToolDurationMs(steps);
  const totalLabel = formatActivityDuration(totalMs);
  const stepsLabel =
    steps.length === 1
      ? t("activity.stepOne")
      : t("activity.steps", { count: steps.length });

  const collapsedRow = (
    <button
      type="button"
      className="rail-collapsed"
      aria-expanded={false}
      onClick={() => setPhase("open")}
    >
      <SparkIcon />
      <span className="rail-collapsed-label">{stepsLabel}</span>
      {toolNames.slice(0, 2).map((name) => (
        <span key={name} className="rail-collapsed-chip">
          {name}
        </span>
      ))}
      {toolNames.length > 2 && (
        <span className="rail-collapsed-more">
          {t("activity.more", { count: toolNames.length - 2 })}
        </span>
      )}
      {totalLabel && <span className="rail-collapsed-time">{totalLabel}</span>}
      <ChevronDownIcon
        size={11}
        strokeWidth={2.5}
        color="currentColor"
        aria-hidden="true"
        style={{
          color: "var(--muted-foreground)",
          flexShrink: 0,
          marginLeft: totalLabel ? 0 : "auto",
        }}
      />
    </button>
  );

  const expandedCard = (frozen: boolean) => (
    <div
      className="activity-rail"
      role={frozen ? undefined : "status"}
      aria-live={frozen ? undefined : "polite"}
    >
      {frozen ? (
        <button
          type="button"
          className="rail-header"
          aria-expanded
          onClick={() => setPhase("collapsed")}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <SparkIcon />
          <span className="rail-status-static">
            {stepsLabel}
            {totalLabel ? ` · ${totalLabel}` : ""}
          </span>
          <ChevronDownIcon
            size={11}
            strokeWidth={2.5}
            color="currentColor"
            aria-hidden="true"
            style={{
              color: "var(--muted-foreground)",
              flexShrink: 0,
              marginLeft: "auto",
              rotate: "180deg",
            }}
          />
        </button>
      ) : (
        <div className="rail-header">
          <div className="rail-pulse-dot" />
          <span className="rail-status">{statusLabel}</span>
          <span className="rail-time">{(elapsedMs / 1000).toFixed(1)}s</span>
        </div>
      )}
      <RailTrack steps={steps} isLive={!frozen} />
    </div>
  );

  return (
    <div className="not-prose" style={{ marginBottom: 12, width: "100%" }}>
      <style>{RAIL_STYLES}</style>

      {phase === "live" && expandedCard(false)}

      {phase === "shrinking" && (
        <ShrinkAway onDone={collapseNow}>{expandedCard(true)}</ShrinkAway>
      )}

      {phase === "collapsed" && collapsedRow}

      {phase === "open" && expandedCard(true)}
    </div>
  );
});

/**
 * Grid-rows collapse: mounts at full height, then animates to 0fr (250ms
 * ease-out per spec) and reports completion so the parent can swap in the
 * collapsed row.
 */
function ShrinkAway({
  children,
  onDone,
}: {
  children: ReactNode;
  onDone: () => void;
}) {
  const [shrinking, setShrinking] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShrinking(true));
    // Fallback in case transitionend never fires (e.g. display:none ancestors)
    const fallback = setTimeout(onDone, 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [onDone]);

  return (
    <div
      className={shrinking ? "rail-shrink shrinking" : "rail-shrink"}
      onTransitionEnd={(event) => {
        if (event.propertyName === "grid-template-rows") {
          onDone();
        }
      }}
    >
      <div>{children}</div>
    </div>
  );
}
