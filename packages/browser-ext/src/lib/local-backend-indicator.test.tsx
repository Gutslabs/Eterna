import {
  ConfigContext,
  type ConfigContextValue,
} from "@eterna/react/components/chatbot";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalBackendIndicator } from "./local-backend-indicator";
import { clearLocalBackendStatusCache } from "./local-backend-status";

const config = {
  settings: { aiModel: "gpt-5.6-sol" },
  isLoading: false,
  updateSetting: vi.fn(),
  updateSettings: vi.fn(),
} as unknown as ConfigContextValue;

beforeEach(() => {
  vi.resetAllMocks();
  clearLocalBackendStatusCache();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalBackendIndicator", () => {
  it("launches Eterna from the offline button", async () => {
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<
      typeof vi.fn
    >;
    sendMessage.mockResolvedValue({ success: true });

    render(
      <ConfigContext.Provider value={config}>
        <LocalBackendIndicator />
      </ConfigContext.Provider>,
    );

    const button = await screen.findByRole("button", {
      name: /click to open terminal and run eterna/i,
    });
    expect(button).toHaveTextContent("Start Eterna");

    fireEvent.click(button);

    await waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        request: "launch-eterna-terminal",
      }),
    );
  });

  it("renders nothing at all while the backend is reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));

    const { container } = render(
      <ConfigContext.Provider value={config}>
        <LocalBackendIndicator />
      </ConfigContext.Provider>,
    );

    // The probe resolves async; wait for it, then assert the composer stays
    // clean — a healthy backend earns no pixels.
    await vi.waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
