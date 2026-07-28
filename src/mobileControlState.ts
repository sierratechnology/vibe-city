export type MobileControlStateInput = {
  cityEntered: boolean;
  mobileCapable: boolean;
  typing: boolean;
  interactionBlocked: boolean;
  transitionBlocked: boolean;
  activeContextAction: boolean;
};

export type MobileControlState = {
  containerVisible: boolean;
  actionVisible: boolean;
};

export function computeMobileControlState(input: MobileControlStateInput): MobileControlState {
  const containerVisible = input.cityEntered && input.mobileCapable && !input.typing && !input.interactionBlocked;
  const actionVisible = containerVisible && !input.transitionBlocked && input.activeContextAction;

  return { containerVisible, actionVisible };
}
