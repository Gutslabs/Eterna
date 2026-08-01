export const ETERNA_TERMINAL_NATIVE_HOST = "com.eterna.terminal";

export interface TerminalLaunchResult {
  success: boolean;
  error?: string;
  setupCommand?: string;
}

export async function launchEternaInTerminal(): Promise<TerminalLaunchResult> {
  try {
    const response = (await chrome.runtime.sendNativeMessage(
      ETERNA_TERMINAL_NATIVE_HOST,
      { action: "launch_eterna" },
    )) as TerminalLaunchResult | undefined;

    if (response?.success) {
      return { success: true };
    }
    return {
      success: false,
      error: response?.error ?? "Eterna terminal helper did not respond.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
      setupCommand: `node packages/browser-ext/native-host/install-native-host.mjs ${chrome.runtime.id}`,
    };
  }
}
