export type MobileControlStateInput = {
  cityEntered: boolean;
  mobileCapable: boolean;
  typing: boolean;
  transitionBlocked: boolean;
  activeDoorAction: boolean;
};

export type MobileControlState = {
  containerVisible: boolean;
  actionVisible: boolean;
};

export function computeMobileControlState(input: MobileControlStateInput): MobileControlState {
  const containerVisible = input.cityEntered && input.mobileCapable && !input.typing;
  const actionVisible = containerVisible && !input.transitionBlocked && input.activeDoorAction;

  return { containerVisible, actionVisible };
}
