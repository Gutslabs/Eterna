export interface NativeSidePanelApi {
  open?: unknown;
  setPanelBehavior?: unknown;
}

export function supportsNativeSidePanel(
  sidePanel: NativeSidePanelApi | undefined,
): boolean {
  return (
    typeof sidePanel?.open === "function" &&
    typeof sidePanel.setPanelBehavior === "function"
  );
}
