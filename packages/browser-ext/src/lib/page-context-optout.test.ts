import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissPageContext,
  getDismissedPageUrl,
  isPageContextDismissed,
  restorePageContext,
  subscribePageContextOptOut,
} from "./page-context-optout";

const PAGE = "https://x.com/junsong/status/1";
const OTHER = "https://x.com/junsong/status/2";

describe("page context opt-out", () => {
  beforeEach(() => {
    restorePageContext();
  });

  it("keeps the page attached until it is dismissed", () => {
    expect(isPageContextDismissed(PAGE)).toBe(false);
    dismissPageContext(PAGE);
    expect(isPageContextDismissed(PAGE)).toBe(true);
  });

  it("re-arms the context for a different url", () => {
    dismissPageContext(PAGE);
    expect(isPageContextDismissed(OTHER)).toBe(false);
  });

  it("treats a missing or non-string metadata url as not dismissed", () => {
    dismissPageContext(PAGE);
    expect(isPageContextDismissed(undefined)).toBe(false);
    expect(isPageContextDismissed(null)).toBe(false);
    expect(isPageContextDismissed(42)).toBe(false);
  });

  it("restores the page after undo", () => {
    dismissPageContext(PAGE);
    restorePageContext();
    expect(isPageContextDismissed(PAGE)).toBe(false);
    expect(getDismissedPageUrl()).toBeNull();
  });

  it("notifies subscribers only on real changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePageContextOptOut(listener);

    dismissPageContext(PAGE);
    dismissPageContext(PAGE);
    expect(listener).toHaveBeenCalledTimes(1);

    dismissPageContext(OTHER);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    restorePageContext();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
