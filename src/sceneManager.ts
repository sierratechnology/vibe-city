export type ActiveSceneName = "outside" | "headquarters";

export type SceneState = {
  activeScene: ActiveSceneName;
  transitioning: boolean;
};

export function createSceneState(): SceneState {
  return {
    activeScene: "headquarters",
    transitioning: false
  };
}

export async function fadeToScene(state: SceneState, fadeElement: HTMLElement, nextScene: ActiveSceneName, onHidden: () => void): Promise<void> {
  if (state.transitioning) {
    return;
  }

  state.transitioning = true;
  fadeElement.classList.add("visible");
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  state.activeScene = nextScene;
  onHidden();
  await new Promise((resolve) => window.setTimeout(resolve, 160));
  fadeElement.classList.remove("visible");
  state.transitioning = false;
}
