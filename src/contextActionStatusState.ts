export type ContextActionStatusInput = {
  cityEntered: boolean;
  transitionBlocked: boolean;
  recordsTerminalOpen: boolean;
  operationsDirectoryOpen: boolean;
  activeContextLabel: string | null;
};

export type ContextActionStatusState = {
  hidden: boolean;
  text: string;
};

export function computeContextActionStatusState(input: ContextActionStatusInput): ContextActionStatusState {
  const visible =
    input.cityEntered &&
    !input.transitionBlocked &&
    !input.recordsTerminalOpen &&
    !input.operationsDirectoryOpen &&
    input.activeContextLabel !== null;

  return {
    hidden: !visible,
    text: visible ? input.activeContextLabel ?? "" : ""
  };
}
