import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ETERNA_TERMINAL_NATIVE_HOST,
  launchEternaInTerminal,
} from "./terminal-launcher";

describe("launchEternaInTerminal", () => {
  const sendNativeMessage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(chrome.runtime, {
      id: "abcdefghijklmnopabcdefghijklmnop",
      sendNativeMessage,
    });
  });

  it("asks only the fixed Eterna native host action to launch", async () => {
    sendNativeMessage.mockResolvedValue({ success: true });

    await expect(launchEternaInTerminal()).resolves.toEqual({ success: true });
    expect(sendNativeMessage).toHaveBeenCalledWith(
      ETERNA_TERMINAL_NATIVE_HOST,
      {
        action: "launch_eterna",
      },
    );
  });

  it("returns an install command containing the current extension id", async () => {
    sendNativeMessage.mockRejectedValue(
      new Error("Specified native messaging host not found."),
    );

    const result = await launchEternaInTerminal();

    expect(result).toMatchObject({
      success: false,
      error: "Specified native messaging host not found.",
    });
    expect(result.setupCommand).toContain(chrome.runtime.id);
  });
});
