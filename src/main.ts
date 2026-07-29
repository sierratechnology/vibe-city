import * as THREE from "three";
import "./styles.css";
import { BusinessEntity, deriveBusinessEntities } from "./businessSystem";
import { Citizen, adjustRelationship, persistCitizenSocial } from "./citizenData";
import {
  ActiveShiftWindow,
  enterWorkPortal,
  getActiveShift,
  getUpcomingShift,
  getShiftByKey,
  sendCitizenHome,
  startCommutingToWork,
  startWorking
} from "./citizenScheduleSystem";
import { DISTRICT_ID, DISTRICT_NAME, DOOR_PORTALS, WORLD_LIMIT, Workstation, portalById, workstationById } from "./districtData";
import {
  KnowledgeItem,
  chooseShareableKnowledge,
  getKnowledgeItem,
  knowledgeItemsForIds,
  shareKnowledge
} from "./knowledgeSystem";
import { computeMobileControlState } from "./mobileControlState";
import { computeContextActionStatusState } from "./contextActionStatusState";
import { HEADQUARTERS_OFFICES, officeAccessText, officeSignText, type HeadquartersOfficeId } from "./headquarters/officeSchema";
import { PlayerPresence, PresenceDebugState, createPresenceAdapter } from "./multiplayer/presence";
import { createOperationsDirectoryController } from "./operations/operationsDirectory";
import { createWorldOperationsSnapshot, deriveRealtimeObservation, type RecordsObservation } from "./operations/worldOperationsSnapshot";
import { createRecordsTerminalController } from "./records/recordsTerminal";
import { createPrivateRecordsInterfaceController } from "./records/privateRecordsInterface";
import { loadWorkEventRecords } from "./records/workEventRecords";
import { createWorkRecordsPanelController } from "./records/workRecordsPanel";
import {
  PlayerProfile,
  addContact,
  addPlayerMessage,
  adjustPlayerCitizenRelationship,
  canGainTalkRelationship,
  createDefaultPlayerProfile,
  loadPlayerProfile,
  markTalkRelationship,
  relationshipForCitizen,
  relationshipLabelForCitizen,
  rememberKnowledge,
  resetCitizenPersistence,
  resetPlayerProfile,
  resetWorldTimePersistence,
  savePlayerProfile
} from "./playerProfile";
import { ActiveSceneName, createSceneState, fadeToScene } from "./sceneManager";
import { WorldBuildingRuntime, buildGeneratedCity } from "./world/assetFactory";
import { projectAuthorizedAgents } from "./world/agentProjection";
import { CITY_SEED, generateCity } from "./world/cityGenerator";
import { WorldTimeState, formatWorldTime, getWorldTime } from "./worldTime";

type Collider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type CitizenRuntime = {
  citizen: Citizen;
  group: THREE.Group;
  label: THREE.Sprite;
  speech: THREE.Sprite;
};

type RemotePlayerRuntime = {
  presence: PlayerPresence;
  group: THREE.Group;
  targetPosition: THREE.Vector3;
  targetRotation: number;
};

type DoorAction =
  | "enter_headquarters"
  | "leave_headquarters";
type OperationsContextAction = "inspect_reception_status" | "inspect_chief_identity" | "inspect_executive_authority";
type ContextAction = DoorAction | "inspect_records" | OperationsContextAction;
type VoiceState = "muted" | "listening" | "speaking" | "unavailable";
type AudioZoneId = "reception" | "assistant_office" | "boardroom" | "devon_executive_office" | "projects_updates_office" | "outside";

type AudioZone = {
  id: AudioZoneId;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const PLAYER_RADIUS = 0.55;
const HEADQUARTERS_PLAYER_SPAWN = { x: 0, z: 8.2 } as const;
const CHIEF_AGENT_OFFICE_SIGN_ANCHOR = ["Chief Agent Office", -6.4, 4.1] as const;
const HEADQUARTERS_SIGN_POSITIONS: Record<HeadquartersOfficeId, { readonly x: number; readonly z: number }> = {
  reception: { x: 2.8, z: 6.1 },
  "executive-office": { x: 6.4, z: -1.1 },
  "chief-agent-office": { x: CHIEF_AGENT_OFFICE_SIGN_ANCHOR[1], z: CHIEF_AGENT_OFFICE_SIGN_ANCHOR[2] },
  "records-room": { x: 6.4, z: 4.1 },
  finance: { x: -7.2, z: -7.6 },
  boardroom: { x: -6.4, z: -1.1 },
  "small-meeting-room": { x: -2.4, z: -7.6 },
  infrastructure: { x: 2.4, z: -7.6 },
  "reserved-departments": { x: 7.2, z: -7.6 }
};
const RECORDS_TERMINAL_INTERACTION_POSITION = { x: 6.4, z: 4.65 } as const;
const RECEPTION_STATUS_INTERACTION_POSITION = { x: 3.25, z: 6.3 } as const;
const CHIEF_AGENT_IDENTITY_INTERACTION_POSITION = { x: -6.4, z: 5.0 } as const;
const EXECUTIVE_AUTHORITY_INTERACTION_POSITION = { x: 2.6, z: -0.7 } as const;
type OperationsFixture = {
  id: "reception-status" | "chief-agent-identity" | "executive-authority";
  action: OperationsContextAction;
  label: string;
  actionLabel: string;
  ariaLabel: string;
  position: { readonly x: number; readonly z: number };
  radius: number;
};
const OPERATIONS_FIXTURES: readonly OperationsFixture[] = [
  {
    id: "reception-status",
    action: "inspect_reception_status",
    label: "Reception Status",
    actionLabel: "Status",
    ariaLabel: "Inspect Reception Status",
    position: RECEPTION_STATUS_INTERACTION_POSITION,
    radius: 1.9
  },
  {
    id: "chief-agent-identity",
    action: "inspect_chief_identity",
    label: "Spiders Identity",
    actionLabel: "Identity",
    ariaLabel: "Inspect Spiders Identity",
    position: CHIEF_AGENT_IDENTITY_INTERACTION_POSITION,
    radius: 1.9
  },
  {
    id: "executive-authority",
    action: "inspect_executive_authority",
    label: "Executive Authority",
    actionLabel: "Authority",
    ariaLabel: "Inspect Executive Authority",
    position: EXECUTIVE_AUTHORITY_INTERACTION_POSITION,
    radius: 1.9
  }
];
const PLAYER_SPEED = 8.2;
const AGENT_WALK_SPEED = 5.4;
const DOOR_APPROACH_DISTANCE = 2.35;
const EXECUTIVE_ASSISTANT_ID = "agent_exec_assistant_001";
const VOICE_INTERACTION_DISTANCE = 3;
const VOICE_FULL_VOLUME_DISTANCE = 1.2;
const VOICE_MAX_DISTANCE = 7;
const VOICE_CROSS_ROOM_ATTENUATION = 0.16;
const VOICE_PLACEHOLDER_TEXT = "Welcome back, Devon. I have your STG briefing ready.";
const AUDIO_ZONES: AudioZone[] = [
  { id: "reception", label: "Reception", minX: -2.8, maxX: 2.8, minZ: 0.5, maxZ: 9.8 },
  { id: "assistant_office", label: "Chief Agent Office", minX: -9.6, maxX: -2.8, minZ: 0.5, maxZ: 9.8 },
  { id: "boardroom", label: "Boardroom", minX: -9.6, maxX: -0.2, minZ: -9.6, maxZ: 0.5 },
  { id: "devon_executive_office", label: "Devon Executive Office", minX: 0.2, maxX: 9.6, minZ: -9.6, maxZ: 0.5 },
  { id: "projects_updates_office", label: "Projects & Updates Office", minX: 2.8, maxX: 9.6, minZ: 0.5, maxZ: 9.8 }
];
const ISO_CAMERA_OFFSET = new THREE.Vector3(24, 24, 24);
const ISO_FORWARD = new THREE.Vector3(0, 0, -1).normalize();
const ISO_RIGHT = new THREE.Vector3(1, 0, 0).normalize();
const ZOOM_LEVELS = [24, 30, 38];
const kioskPerformanceMode = new URLSearchParams(window.location.search).get("performance") === "kiosk";
const KIOSK_PIXEL_RATIO = 0.65;
const KIOSK_TARGET_FPS = 30;

const app = document.querySelector<HTMLDivElement>("#app")!;
const landingShell = document.querySelector<HTMLElement>("#landing-shell")!;
const enterWorldButton = document.querySelector<HTMLButtonElement>("#enter-world")!;
const currentArea = document.querySelector<HTMLSpanElement>("#current-area")!;
const multiplayerStatusLabel = document.querySelector<HTMLSpanElement>("#multiplayer-status")!;
const playerNameLabel = document.querySelector<HTMLSpanElement>("#player-name")!;
const playerWalletLabel = document.querySelector<HTMLSpanElement>("#player-wallet")!;
const playerReputationLabel = document.querySelector<HTMLSpanElement>("#player-reputation")!;
const playerInfluenceLabel = document.querySelector<HTMLSpanElement>("#player-influence")!;
const cameraModeLabel = document.querySelector<HTMLSpanElement>("#camera-mode")!;
const debugState = document.querySelector<HTMLSpanElement>("#debug-state")!;
const timeDisplay = document.querySelector<HTMLSpanElement>("#time-display")!;
const actionPrompt = document.querySelector<HTMLDivElement>("#action-prompt")!;
const voicePanel = document.querySelector<HTMLElement>("#voice-panel")!;
const voiceStatus = document.querySelector<HTMLElement>("#voice-status")!;
const voiceMeterFill = document.querySelector<HTMLElement>("#voice-meter-fill")!;
const voiceCaption = document.querySelector<HTMLElement>("#voice-caption")!;
const fadeOverlay = document.querySelector<HTMLDivElement>("#fade-overlay")!;
const popup = document.querySelector<HTMLElement>("#interaction-popup")!;
const popupClose = document.querySelector<HTMLButtonElement>("#interaction-close")!;
const popupLeave = document.querySelector<HTMLButtonElement>("#interaction-leave")!;
const briefingPanel = document.querySelector<HTMLElement>("#briefing-panel")!;
const briefingClose = document.querySelector<HTMLButtonElement>("#briefing-close")!;
const briefingTitle = document.querySelector<HTMLElement>("#briefing-title")!;
const briefingGreeting = document.querySelector<HTMLElement>("#briefing-greeting")!;
const briefingContent = document.querySelector<HTMLElement>("#briefing-content")!;
const popupFields = {
  name: document.querySelector<HTMLElement>("#interaction-name")!,
  role: document.querySelector<HTMLElement>("#interaction-role")!,
  mood: document.querySelector<HTMLElement>("#interaction-mood")!,
  state: document.querySelector<HTMLElement>("#interaction-state")!,
  wallet: document.querySelector<HTMLElement>("#interaction-wallet")!,
  relationship: document.querySelector<HTMLElement>("#interaction-relationship")!,
  known: document.querySelector<HTMLElement>("#interaction-known")!,
  late: document.querySelector<HTMLElement>("#interaction-late")!,
  greeting: document.querySelector<HTMLElement>("#interaction-greeting")!
};
const sharedKnowledgeLine = document.querySelector<HTMLElement>("#interaction-knowledge")!;
const rememberKnowledgeButton = document.querySelector<HTMLButtonElement>("#interaction-remember")!;
const opsPanel = document.querySelector<HTMLElement>("#ops-panel")!;
const opsSummary = document.querySelector<HTMLElement>("#ops-summary")!;
const citizenDetails = document.querySelector<HTMLElement>("#citizen-details")!;
const journalButton = document.querySelector<HTMLButtonElement>("#journal-open")!;
const voiceSettingsOpen = document.querySelector<HTMLButtonElement>("#voice-settings-open")!;
const voiceSettingsPanel = document.querySelector<HTMLElement>("#voice-settings-panel")!;
const voiceSettingsClose = document.querySelector<HTMLButtonElement>("#voice-settings-close")!;
const voiceEnabledToggle = document.querySelector<HTMLInputElement>("#voice-enabled-toggle")!;
const captionsEnabledToggle = document.querySelector<HTMLInputElement>("#captions-enabled-toggle")!;
const voiceVolumeSlider = document.querySelector<HTMLInputElement>("#voice-volume-slider")!;
const voiceVolumeValue = document.querySelector<HTMLElement>("#voice-volume-value")!;
const voicePushToTalkKey = document.querySelector<HTMLElement>("#voice-push-to-talk-key")!;
const voiceCurrentZone = document.querySelector<HTMLElement>("#voice-current-zone")!;
const voiceStateDisplay = document.querySelector<HTMLElement>("#voice-state-display")!;
const voiceOpenAiStatus = document.querySelector<HTMLElement>("#voice-openai-status")!;
const journalModal = document.querySelector<HTMLElement>("#knowledge-journal")!;
const journalClose = document.querySelector<HTMLButtonElement>("#journal-close")!;
const journalTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-journal-tab]"));
const journalList = document.querySelector<HTMLElement>("#journal-list")!;
const phonePanel = document.querySelector<HTMLElement>("#phone-panel")!;
const phoneClose = document.querySelector<HTMLButtonElement>("#phone-close")!;
const phoneTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-phone-app]"));
const phoneContent = document.querySelector<HTMLElement>("#phone-content")!;
const homePanel = document.querySelector<HTMLElement>("#home-panel")!;
const homeTitle = document.querySelector<HTMLElement>("#home-title")!;
const homeContent = document.querySelector<HTMLElement>("#home-content")!;
const homeClose = document.querySelector<HTMLButtonElement>("#home-close")!;
const homeCloseSecondary = document.querySelector<HTMLButtonElement>("#home-close-secondary")!;
const homeOpenContacts = document.querySelector<HTMLButtonElement>("#home-open-contacts")!;
const homeOpenJournal = document.querySelector<HTMLButtonElement>("#home-open-journal")!;
const toastMessage = document.querySelector<HTMLElement>("#toast-message")!;
const characterModal = document.querySelector<HTMLElement>("#character-modal")!;
const characterForm = document.querySelector<HTMLFormElement>("#character-form")!;
const characterNameInput = document.querySelector<HTMLInputElement>("#character-name")!;
const resetProfileButton = document.querySelector<HTMLButtonElement>("#reset-profile")!;
const resetCitizensButton = document.querySelector<HTMLButtonElement>("#reset-citizens")!;
const resetWorldTimeButton = document.querySelector<HTMLButtonElement>("#reset-world-time")!;
const touchControls = document.querySelector<HTMLElement>("#touch-controls")!;
const touchJoystick = document.querySelector<HTMLElement>("#touch-joystick")!;
const touchJoystickKnob = document.querySelector<HTMLElement>("#touch-joystick-knob")!;
const touchActionButton = document.querySelector<HTMLButtonElement>("#touch-action")!;
const contextActionStatus = document.querySelector<HTMLElement>("#context-action-status")!;
let recordsObservation: RecordsObservation = { state: "not_checked", asOf: null };
const operationsDirectoryDialog = document.querySelector<HTMLDialogElement>("#operations-directory-dialog")!;
const headquartersOfficeDirectoryList = document.querySelector<HTMLUListElement>("#headquarters-office-directory-list")!;

function renderHeadquartersOfficeDirectory(): void {
  const directoryItems: HTMLLIElement[] = [];
  for (const office of HEADQUARTERS_OFFICES) {
    const directoryItem = document.createElement("li");
    const directoryName = document.createElement("h4");
    const directoryAccess = document.createElement("p");
    const directoryDetail = document.createElement("p");
    directoryItem.dataset.officeId = office.id;
    directoryItem.dataset.access = office.access;
    directoryName.textContent = office.displayName;
    directoryAccess.textContent = officeAccessText(office);
    directoryDetail.textContent = `${office.definition} Access reason: ${office.accessReason}`;
    directoryItem.replaceChildren(directoryName, directoryAccess, directoryDetail);
    directoryItems.push(directoryItem);
  }
  headquartersOfficeDirectoryList.replaceChildren(...directoryItems);
}

renderHeadquartersOfficeDirectory();
const operationsDirectory = createOperationsDirectoryController(
  {
    access: document.querySelector<HTMLButtonElement>("#operations-directory-access")!,
    dialog: operationsDirectoryDialog,
    close: document.querySelector<HTMLButtonElement>("#operations-directory-close")!,
    state: document.querySelector<HTMLElement>("#operations-directory-state")!,
    services: document.querySelector<HTMLElement>("#operations-directory-services")!,
    records: document.querySelector<HTMLElement>("#operations-directory-record")!,
    identity: document.querySelector<HTMLElement>("#operations-directory-identity")!,
    authority: document.querySelector<HTMLElement>("#operations-directory-authority")!,
    onOpenChange: updateTouchControlVisibility
  },
  () => createWorldOperationsSnapshot({
    services: {
      coreWorld: renderer.domElement.isConnected && !renderer.getContext().isContextLost() ? "working" : "unavailable",
      realtime: deriveRealtimeObservation(multiplayerDebug),
      records: recordsObservation
    }
  })
);
const recordsTerminalDialog = document.querySelector<HTMLDialogElement>("#records-terminal-dialog")!;
const privateRecordsDialog = document.querySelector<HTMLDialogElement>("#private-records-dialog")!;
const privateRecordsAccess = document.querySelector<HTMLButtonElement>("#private-records-access")!;
const privateRecordsWorldOpen = document.querySelector<HTMLButtonElement>("#private-records-world-open")!;
const privateRecords = createPrivateRecordsInterfaceController({
  dialog: privateRecordsDialog,
  status: document.querySelector<HTMLElement>("#private-records-status")!,
  summary: document.querySelector<HTMLElement>("#private-records-summary")!,
  trace: document.querySelector<HTMLElement>("#private-records-trace")!,
  refresh: document.querySelector<HTMLButtonElement>("#private-records-refresh")!,
  close: document.querySelector<HTMLButtonElement>("#private-records-close")!
}, {
  getTrustedSession: () => null,
  readAuthorizedModel: async () => { throw new Error("Private Records adapter is not configured."); }
});
privateRecordsWorldOpen.addEventListener("click", () => void privateRecords.open(privateRecordsWorldOpen, ""));
privateRecordsAccess.addEventListener("click", () => void privateRecords.open(privateRecordsAccess, ""));
privateRecordsDialog.addEventListener("close", updateTouchControlVisibility);
const workRecordsPanel = createWorkRecordsPanelController({
  state: document.querySelector<HTMLElement>("#work-records-state")!,
  freshness: document.querySelector<HTMLElement>("#work-records-freshness")!,
  source: document.querySelector<HTMLElement>("#work-records-source")!,
  list: document.querySelector<HTMLElement>("#work-records-list")!
}, loadWorkEventRecords);
const recordsTerminal = createRecordsTerminalController({
  dialog: recordsTerminalDialog,
  close: document.querySelector<HTMLButtonElement>("#records-terminal-close")!,
  refresh: document.querySelector<HTMLButtonElement>("#records-terminal-refresh")!,
  state: document.querySelector<HTMLElement>("#records-terminal-state")!,
  record: document.querySelector<HTMLElement>("#records-terminal-record")!,
  status: document.querySelector<HTMLElement>("#records-terminal-status")!,
  sourceId: document.querySelector<HTMLElement>("#records-terminal-source-id")!,
  sourceUpdated: document.querySelector<HTMLElement>("#records-terminal-updated")!,
  observed: document.querySelector<HTMLElement>("#records-terminal-observed")!,
  freshness: document.querySelector<HTMLElement>("#records-terminal-freshness")!,
  source: document.querySelector<HTMLAnchorElement>("#records-terminal-source")!,
  onOpenChange: updateTouchControlVisibility,
  onStateChange: (state) => {
    recordsObservation = state.status === "unavailable"
      ? { state: "unavailable", asOf: state.checkedAt, failure: state.reason, record: null }
      : {
          state: state.freshness,
          asOf: state.observedAt,
          failure: state.staleReason ?? null,
          record: {
            title: state.title,
            source: state.source,
            sourceId: state.sourceId,
            sourceUpdatedAt: state.sourceUpdatedAt,
            observedAt: state.observedAt,
            checkedAt: state.checkedAt,
            url: state.url
          }
        };
  }
}, undefined, workRecordsPanel.load);

declare global {
  interface Window {
    __vibeCity3DHealth?: {
      frames: number;
      buildings: number;
      player: { x: number; z: number };
      cameraMode: "Isometric";
      camera: { x: number; y: number; z: number };
      occlusion: boolean;
      grid: boolean;
      assetDebug: boolean;
      zoom: number;
      seed: string;
      assets: number;
      scene: ActiveSceneName;
      citizensTotal: number;
      citizensVisible: number;
      citizensWorking: number;
      citizensOffDistrict: number;
      socialInteractions: number;
      businessesTotal: number;
      businessesOperating: number;
      remotePlayers: number;
      multiplayerStatus: string;
      multiplayerEnvConfigured: boolean;
      multiplayerPresenceCount: number;
      multiplayerLastBroadcastAt: number | null;
      multiplayerLastPresenceSyncAt: number | null;
      multiplayerChannelName: string;
      multiplayerSubscribeStatus: string;
      multiplayerLastError: string | null;
      multiplayerWebsocketConnected: boolean;
      openBusinessesWithoutWorkers: number;
      time: string;
      triangles: number;
      realWorldTime: string;
      realWorldDate: string;
      timezone: string;
      dayOfWeek: string;
      vibeCityTimeMode: "real_world" | "simulated";
      voiceState: VoiceState;
      agentVoiceEnabled: boolean;
      captionsEnabled: boolean;
      voiceVolumeSetting: number;
      playerDistanceToAgent: number | null;
      voiceVolume: number;
      voiceCaption: string;
      currentAudioZone: AudioZoneId;
      agentAudioZone: AudioZoneId | null;
      voiceRoomAttenuation: number;
    };
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x92a8b7);
scene.fog = new THREE.Fog(0x92a8b7, 42, 76);

const camera = new THREE.OrthographicCamera(-24, 24, 13.5, -13.5, 0.1, 160);
camera.position.copy(ISO_CAMERA_OFFSET);

const renderer = new THREE.WebGLRenderer({ antialias: !kioskPerformanceMode, powerPreference: "high-performance" });
renderer.setPixelRatio(kioskPerformanceMode ? KIOSK_PIXEL_RATIO : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !kioskPerformanceMode;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "Vibe City world viewport");
app.append(renderer.domElement);

const sceneState = createSceneState();
const outsideGroup = new THREE.Group();
const headquartersGroup = new THREE.Group();
scene.add(outsideGroup, headquartersGroup);

function updateCameraProjection(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = ZOOM_LEVELS[zoomLevelIndex];
  camera.left = (-viewSize * aspect) / 2;
  camera.right = (viewSize * aspect) / 2;
  camera.top = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.updateProjectionMatrix();
}

const outsideColliders: Collider[] = [];
const headquartersColliders: Collider[] = [];
const buildingRuntimes: WorldBuildingRuntime[] = [];
const citizenRuntimes: CitizenRuntime[] = [];
const keys = new Set<string>();
const playerVelocity = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const touchMoveInput = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const citizens = projectAuthorizedAgents<Citizen>({ status: "unavailable", reason: "not_configured" });
let playerProfile: PlayerProfile = loadPlayerProfile() ?? createDefaultPlayerProfile();
if (loadPlayerProfile()) characterModal.hidden = true;
const presenceAdapter = await createPresenceAdapter();
const remotePlayerRuntimes = new Map<string, RemotePlayerRuntime>();
let multiplayerHudStatus = "Offline / Missing Env";
let multiplayerDebug: PresenceDebugState | null = null;
const socialTopics = ["briefing", "projects", "meetings", "decisions", "updates"];
let worldTime: WorldTimeState = getWorldTime();
initializeCitizenSimulationForCurrentTime();
let occlusionEnabled = true;
let gridVisible = false;
let zoomLevelIndex = 1;
let lastZoomCycleAt = 0;
let lastDebugToggleAt = 0;
let activeContextAction: ContextAction | null = null;
let activeInteractionCitizen: Citizen | null = null;
let activeSharedKnowledge: KnowledgeItem | null = null;
let briefingAutoOpened = false;
let activeJournalTab: "contacts" | "citizen" | "place" | "business" | "rumor" = "contacts";
let activePhoneApp: "contacts" | "messages" | "knowledge" | "profile" | "map" | "debug" = "contacts";
let contactAddedMessage = "";
let toastTimeout: number | null = null;
let voiceState: VoiceState = "unavailable";
let agentVoiceEnabled = true;
let captionsEnabled = true;
let voiceVolumeSetting = 1;
let playerDistanceToAgent: number | null = null;
let voiceVolume = 0;
let currentAudioZone: AudioZoneId = "outside";
let agentAudioZone: AudioZoneId | null = null;
let voiceRoomAttenuation = 0;
let voiceCaptionText = "";
let voiceTimeout: number | null = null;
let lastVoiceKeyAt = 0;
let selectedCitizen: Citizen | null = null;
let selectedBusinessId: string | null = null;
let lastFrameAt = performance.now();
let cityEntered = false;
let lastSocialCheckAt = 0;
let lastSocialPersistAt = 0;
let activeJoystickPointerId: number | null = null;
const citizenTransitionLog: string[] = [];
let lastPresencePublishAt = 0;
let lastPresencePosition = new THREE.Vector3();
let lastPresenceFacing = 0;

updateCameraProjection();

const sun = new THREE.DirectionalLight(0xfff1cf, 2.8);
sun.position.set(-15, 24, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc9e5ff, 0x354238, 1.15));

const entryPadMaterial = new THREE.MeshStandardMaterial({ color: 0xe8d27c, roughness: 0.7 });
let assetDebugGroup: THREE.Group | null = null;
let assetDebugVisible = false;
let generatedAssetCount = 0;
const headquartersPortal = portalById("headquarters-main");

function addBox(parent: THREE.Group, width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y + height / 2, z);
  mesh.castShadow = height > 0.3;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addPlaneBox(parent: THREE.Group, width: number, depth: number, height: number, x: number, z: number, material: THREE.Material): THREE.Mesh {
  return addBox(parent, width, height, depth, x, 0.01, z, material);
}

function addCollider(target: Collider[], x: number, z: number, width: number, depth: number, radius = PLAYER_RADIUS): void {
  target.push({
    minX: x - width / 2 - radius,
    maxX: x + width / 2 + radius,
    minZ: z - depth / 2 - radius,
    maxZ: z + depth / 2 + radius
  });
}

function createLabelSprite(text: string, width = 512, height = 128, fontSize = 42, backed = false): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  if (backed) {
    context.fillStyle = "rgba(10, 24, 29, 0.84)";
    context.fillRect(8, 8, width - 16, height - 16);
    context.strokeStyle = "rgba(121, 213, 231, 0.92)";
    context.lineWidth = 3;
    context.strokeRect(9.5, 9.5, width - 19, height - 19);
  }
  context.fillStyle = "#f8f4ea";
  context.font = `700 ${fontSize}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2, width - 36);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
}

function buildOutsideMap(): void {
  const generatedCity = generateCity(CITY_SEED);
  const generatedWorld = buildGeneratedCity(outsideGroup, generatedCity);
  outsideColliders.push(...generatedWorld.colliders);
  buildingRuntimes.push(...generatedWorld.buildings);
  assetDebugGroup = generatedWorld.debugGroup;
  generatedAssetCount = generatedWorld.assetCount;
}

function buildHeadquartersInterior(): void {
  headquartersGroup.visible = false;
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x344145, roughness: 0.88 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2a2d, roughness: 0.74 });
  const deskMaterial = new THREE.MeshStandardMaterial({ color: 0x6d543c, roughness: 0.72 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x8fb3bd, roughness: 0.45, transparent: true, opacity: 0.62 });

  addPlaneBox(headquartersGroup, 20, 20, 0.12, 0, 0, floorMaterial);
  addBox(headquartersGroup, 20, 1.55, 0.9, 0, 0, -10, wallMaterial);
  addBox(headquartersGroup, 20, 1.55, 0.9, 0, 0, 10, wallMaterial);
  addBox(headquartersGroup, 0.9, 1.55, 20, -10, 0, 0, wallMaterial);
  addBox(headquartersGroup, 0.9, 1.55, 20, 10, 0, 0, wallMaterial);
  addCollider(headquartersColliders, 0, -10, 20, 0.9);
  addCollider(headquartersColliders, 0, 10, 20, 0.9);
  addCollider(headquartersColliders, -10, 0, 0.9, 20);
  addCollider(headquartersColliders, 10, 0, 0.9, 20);

  addBox(headquartersGroup, 4.8, 1, 1.4, 0, 0, 4.1, deskMaterial);
  addCollider(headquartersColliders, 0, 4.1, 4.8, 1.4);
  addBox(headquartersGroup, 5.4, 0.8, 2.2, -6.4, 0, -2.9, deskMaterial);
  addBox(headquartersGroup, 3.6, 0.8, 1.8, -6.4, 0, 2.6, deskMaterial);
  addBox(headquartersGroup, 5.4, 0.8, 2.2, 6.4, 0, -2.9, deskMaterial);
  addBox(headquartersGroup, 3.8, 0.8, 1.8, 6.4, 0, 2.6, deskMaterial);
  addCollider(headquartersColliders, -6.4, -2.9, 5.4, 2.2);
  addCollider(headquartersColliders, -6.4, 2.6, 3.6, 1.8);
  addCollider(headquartersColliders, 6.4, -2.9, 5.4, 2.2);
  addCollider(headquartersColliders, 6.4, 2.6, 3.8, 1.8);

  const recordsTerminalMaterial = new THREE.MeshStandardMaterial({
    color: 0x17323b,
    emissive: 0x2d9bb3,
    emissiveIntensity: 0.65,
    roughness: 0.35
  });
  addBox(headquartersGroup, 1.35, 0.88, 0.18, 6.4, 0.82, 2.55, recordsTerminalMaterial);
  addBox(headquartersGroup, 0.18, 0.32, 0.18, 6.4, 0.78, 2.55, wallMaterial);

  const operationsMaterial = new THREE.MeshStandardMaterial({
    color: 0x243f47,
    emissive: 0x517985,
    emissiveIntensity: 0.42,
    roughness: 0.48
  });
  for (const fixture of OPERATIONS_FIXTURES) {
    addBox(headquartersGroup, 0.95, 0.78, 0.2, fixture.position.x, 0.08, fixture.position.z, operationsMaterial);
    addCollider(headquartersColliders, fixture.position.x, fixture.position.z, 0.95, 0.2);
  }

  addBox(headquartersGroup, 0.22, 1.25, 8.8, 0, 0, -2.1, glassMaterial);
  addBox(headquartersGroup, 18, 1.1, 0.22, 0, 0, 0.5, glassMaterial);

  const title = createLabelSprite("STG Headquarters", 512, 128, 56, true);
  title.position.set(0, 3.6, -9.4);
  title.scale.set(6.5, 1.5, 1);
  headquartersGroup.add(title);

  for (const office of HEADQUARTERS_OFFICES) {
    const position = HEADQUARTERS_SIGN_POSITIONS[office.id];
    const roomSign = createLabelSprite(officeSignText(office), 768, 96, 64, true);
    roomSign.position.set(position.x, 2.15, position.z);
    roomSign.scale.set(5.2, 0.9, 1);
    roomSign.userData.officeId = office.id;
    headquartersGroup.add(roomSign);
  }

  const exitSign = createLabelSprite("Exit", 256, 96, 56, true);
  exitSign.position.set(0, 1.2, 9.1);
  exitSign.scale.set(2.4, 0.9, 1);
  headquartersGroup.add(exitSign);

  addPlaneBox(headquartersGroup, 4.4, 1.8, 0.14, headquartersPortal.interiorPosition.x, headquartersPortal.interiorPosition.z, entryPadMaterial);
}

buildOutsideMap();
buildHeadquartersInterior();

const player = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.45, 1.05, 8, 16),
  new THREE.MeshStandardMaterial({ color: 0x53c7ff, roughness: 0.55 })
);
body.position.y = 1.15;
body.castShadow = true;
const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 18, 18),
  new THREE.MeshStandardMaterial({ color: 0xf5d1b8, roughness: 0.6 })
);
head.position.y = 2.2;
head.castShadow = true;
const playerRing = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.86, 48),
  new THREE.MeshBasicMaterial({ color: 0x8ce6ff, transparent: true, opacity: 0.72, depthTest: false })
);
playerRing.rotation.x = -Math.PI / 2;
playerRing.position.y = 0.06;
playerRing.renderOrder = 10;
const playerName = createLabelSprite("You", 256, 96, 56, true);
playerName.position.y = 3.25;
playerName.scale.set(2.6, 1, 1);
playerName.renderOrder = 11;
player.add(body, head, playerRing, playerName);
player.position.set(HEADQUARTERS_PLAYER_SPAWN.x, 0, HEADQUARTERS_PLAYER_SPAWN.z);
player.rotation.y = Math.PI;
scene.add(player);

function createCitizenRuntime(citizen: Citizen, index: number): CitizenRuntime {
  const group = new THREE.Group();
  const colors = [0xffb45e, 0xff86ba, 0x9ee493, 0xc49bff, 0xf5e663, 0x6ee7f9, 0xf7a1a1, 0xa6c1ff];
  const npcBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.85, 6, 12),
    new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: 0.6 })
  );
  npcBody.position.y = 1;
  npcBody.castShadow = true;
  const label = createLabelSprite(citizen.name.split(" ")[0], 256, 96, 32);
  label.position.y = 2.45;
  label.scale.set(2.8, 1.1, 1);
  const speech = createLabelSprite("...", 160, 96, 44);
  speech.position.y = 3.15;
  speech.scale.set(1.4, 0.9, 1);
  speech.visible = false;
  speech.renderOrder = 12;
  group.add(npcBody, label, speech);
  group.visible = false;
  scene.add(group);
  return { citizen, group, label, speech };
}

for (const [index, citizen] of citizens.entries()) {
  citizenRuntimes.push(createCitizenRuntime(citizen, index));
}

function createRemotePlayerRuntime(presence: PlayerPresence): RemotePlayerRuntime {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.95, 7, 14),
    new THREE.MeshStandardMaterial({ color: 0x9c7cff, roughness: 0.55 })
  );
  body.position.y = 1.08;
  body.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.84, 40),
    new THREE.MeshBasicMaterial({ color: 0xd2c5ff, transparent: true, opacity: 0.62, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.055;
  ring.renderOrder = 9;
  const label = createLabelSprite(presence.displayName || "Player", 384, 96, 30);
  label.position.y = 2.85;
  label.scale.set(3.3, 1, 1);
  label.renderOrder = 12;
  group.add(body, ring, label);
  group.position.set(presence.x, presence.y, presence.z);
  group.rotation.y = presence.facing;
  scene.add(group);
  return {
    presence,
    group,
    targetPosition: new THREE.Vector3(presence.x, presence.y, presence.z),
    targetRotation: presence.facing
  };
}

function updateRemotePlayers(delta: number): void {
  const now = Date.now();
  const moved = player.position.distanceToSquared(lastPresencePosition) > 0.01 || Math.abs(player.rotation.y - lastPresenceFacing) > 0.02;
  const broadcastInterval = moved || playerVelocity.lengthSq() > 0.05 ? 250 : 2000;
  if (now - lastPresencePublishAt > broadcastInterval) {
    presenceAdapter.publish({
      displayName: playerProfile.displayName,
      districtId: DISTRICT_ID,
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      facing: player.rotation.y,
      currentScene: sceneState.activeScene,
      currentArea: currentArea.textContent ?? DISTRICT_NAME
    });
    lastPresencePosition.copy(player.position);
    lastPresenceFacing = player.rotation.y;
    lastPresencePublishAt = now;
  }

  const snapshot = presenceAdapter.getSnapshot(now);
  multiplayerHudStatus = snapshot.hudStatus;
  multiplayerDebug = snapshot.debug;
  const visibleRemoteIds = new Set<string>();
  for (const presence of snapshot.remotePlayers) {
    if (presence.districtId !== DISTRICT_ID) continue;
    visibleRemoteIds.add(presence.playerId);
    let runtime = remotePlayerRuntimes.get(presence.playerId);
    if (!runtime) {
      runtime = createRemotePlayerRuntime(presence);
      remotePlayerRuntimes.set(presence.playerId, runtime);
    }
    runtime.presence = presence;
    runtime.targetPosition.set(presence.x, presence.y, presence.z);
    runtime.targetRotation = presence.facing;
    runtime.group.visible = presence.currentScene === sceneState.activeScene;
    runtime.group.position.lerp(runtime.targetPosition, 1 - Math.pow(0.001, delta));
    runtime.group.rotation.y += (runtime.targetRotation - runtime.group.rotation.y) * (1 - Math.pow(0.01, delta));
  }

  for (const [playerId, runtime] of remotePlayerRuntimes) {
    if (visibleRemoteIds.has(playerId)) continue;
    scene.remove(runtime.group);
    remotePlayerRuntimes.delete(playerId);
  }
}

function activeColliders(): Collider[] {
  if (sceneState.activeScene === "headquarters") return headquartersColliders;
  return outsideColliders;
}

function collidesAt(nextPosition: THREE.Vector3): boolean {
  if (
    nextPosition.x < -WORLD_LIMIT + PLAYER_RADIUS ||
    nextPosition.x > WORLD_LIMIT - PLAYER_RADIUS ||
    nextPosition.z < -WORLD_LIMIT + PLAYER_RADIUS ||
    nextPosition.z > WORLD_LIMIT - PLAYER_RADIUS
  ) {
    return true;
  }

  return activeColliders().some((box) => {
    return nextPosition.x >= box.minX && nextPosition.x <= box.maxX && nextPosition.z >= box.minZ && nextPosition.z <= box.maxZ;
  });
}

function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function executiveAssistant(): Citizen | null {
  return citizens.find((citizen) => citizen.id === EXECUTIVE_ASSISTANT_ID) ?? null;
}

function audioZoneForPoint(point: { x: number; z: number }, sceneName: ActiveSceneName | "none"): AudioZoneId {
  if (sceneName !== "headquarters") return "outside";
  return AUDIO_ZONES.find((zone) => point.x >= zone.minX && point.x <= zone.maxX && point.z >= zone.minZ && point.z <= zone.maxZ)?.id ?? "reception";
}

function audioZoneLabel(zoneId: AudioZoneId | null): string {
  if (!zoneId) return "None";
  if (zoneId === "outside") return "Outside";
  return AUDIO_ZONES.find((zone) => zone.id === zoneId)?.label ?? zoneId;
}

function citizenName(id: string): string {
  return citizens.find((citizen) => citizen.id === id)?.name ?? id;
}

function formatCitizenList(ids: string[], limit = 5): string {
  if (!ids.length) return "None";
  const names = ids.slice(0, limit).map(citizenName);
  return ids.length > limit ? `${names.join(", ")} +${ids.length - limit}` : names.join(", ");
}

function formatBusinessHours(hours: BusinessEntity["openHours"]): string {
  if (hours === "24h") return "24 hours";
  const formatMinute = (minute: number) => {
    const hour = Math.floor(minute / 60) % 24;
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:00 ${suffix}`;
  };
  return `${formatMinute(hours.startMinute)}-${formatMinute(hours.endMinute)}`;
}

function renderRequiredStaff(business: BusinessEntity): string {
  return business.requiredStaff.map((role) => `${role.role} x${role.count} (${business.currentStaffByRole[role.role] ?? 0})`).join(", ");
}

function renderMissingStaff(business: BusinessEntity): string {
  const missing = Object.entries(business.missingStaffByRole).filter(([, count]) => count > 0);
  return missing.length ? missing.map(([role, count]) => `${role} x${count}`).join(", ") : "None";
}

function renderBriefingList(items: string[], emptyText: string): string {
  if (!items.length) return `<p>${emptyText}</p>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function executiveAssistantGreeting(): string {
  const hour = Math.floor(worldTime.minuteOfDay / 60);
  if (hour >= 5 && hour < 12) return "Good morning, Devon. I have your STG briefing ready.";
  if (hour >= 12 && hour < 17) return "Good afternoon, Devon. I have your STG briefing ready.";
  if (hour >= 17 && hour < 22) return "Good evening, Devon. I have your STG briefing ready.";
  return "Good late night, Devon. I have your STG briefing ready.";
}

function openBriefing(agent: Citizen): void {
  activeInteractionCitizen = agent;
  selectedCitizen = agent;
  const addedContact = addContact(playerProfile, agent.id);
  if (addedContact) addPlayerMessage(playerProfile, "Contact added", `${agent.displayName} was added to your contacts.`, worldTime.absoluteMinutes, "contact");

  briefingTitle.textContent = `${agent.displayName} Briefing`;
  briefingGreeting.textContent = agent.id === EXECUTIVE_ASSISTANT_ID ? executiveAssistantGreeting() : agent.greetingScript[0] ?? "Welcome back, Devon. I have your STG briefing ready.";

  const vercelSource = agent.briefingSources.find((source) => source.toLowerCase().includes("vercel"));
  const githubSource = agent.briefingSources.find((source) => source.toLowerCase().includes("github"));
  const deviceSource = agent.tools.find((tool) => tool.toLowerCase().includes("device")) ?? agent.briefingSources.find((source) => source.toLowerCase().includes("device") || source.toLowerCase().includes("raspberry"));

  briefingContent.textContent = `
    <article class="briefing-section">
      <h3>GitHub</h3>
      ${renderBriefingList(agent.watchingRepos.map((repo) => `${repo} - mock summary ready from ${githubSource ?? "seeded profile"}`), "No watched repositories yet.")}
    </article>
    <article class="briefing-section">
      <h3>Vercel</h3>
      ${renderBriefingList([`${vercelSource ?? "Vercel summaries"} - no live deployment check connected yet.`], "No Vercel briefing source configured.")}
    </article>
    <article class="briefing-section">
      <h3>Devices</h3>
      ${renderBriefingList(agent.watchingDevices.map((device) => `${device} - mock status source: ${deviceSource ?? "Device Registry"}`), "No watched devices yet.")}
    </article>
    <article class="briefing-section">
      <h3>Active Projects</h3>
      ${renderBriefingList(agent.activeProjects, "No active projects in the seeded profile.")}
    </article>
    <article class="briefing-section">
      <h3>Decision Queue</h3>
      ${renderBriefingList(agent.decisionQueue, "No pending decisions.")}
    </article>
  `;

  briefingPanel.hidden = false;
  popup.hidden = true;
  actionPrompt.hidden = true;
  updateTouchControlVisibility();
}

function closeBriefing(): void {
  briefingPanel.hidden = true;
  activeInteractionCitizen = null;
  updateTouchControlVisibility();
}

function clearVoiceTimeout(): void {
  if (voiceTimeout === null) return;
  window.clearTimeout(voiceTimeout);
  voiceTimeout = null;
}

function isAssistantVoiceAvailable(agent: Citizen | null): boolean {
  if (!agentVoiceEnabled || !agent) return false;
  if (sceneState.transitioning || sceneState.activeScene !== "headquarters") return false;
  if (agent.currentScene !== sceneState.activeScene || agent.currentState === "home" || agent.currentState === "off_district") return false;
  return (playerDistanceToAgent ?? Number.POSITIVE_INFINITY) <= VOICE_INTERACTION_DISTANCE;
}

function setVoiceState(nextState: VoiceState, caption = ""): void {
  voiceState = nextState;
  voiceCaptionText = caption;
}

function createOpenAIRealtimeVoiceSessionPlaceholder(agent: Citizen): void {
  void agent;
  // Future hook: create and attach an OpenAI Realtime voice session here.
}

function startAssistantVoicePlaceholder(): void {
  const agent = executiveAssistant();
  updateVoiceState();
  if (!agentVoiceEnabled) {
    setVoiceState("unavailable", "Voice is disabled in settings.");
    showToast("Voice is disabled.");
    clearVoiceTimeout();
    voiceTimeout = window.setTimeout(() => {
      updateVoiceState();
    }, 1800);
    return;
  }

  if (!isAssistantVoiceAvailable(agent)) {
    setVoiceState("unavailable", "Move closer to the Executive Assistant in Reception.");
    showToast("Voice is available near the Executive Assistant.");
    clearVoiceTimeout();
    voiceTimeout = window.setTimeout(() => {
      updateVoiceState();
    }, 1800);
    return;
  }

  clearVoiceTimeout();
  if (agent) createOpenAIRealtimeVoiceSessionPlaceholder(agent);
  setVoiceState("listening", "Listening...");
  voiceTimeout = window.setTimeout(() => {
    setVoiceState("speaking", agent?.id === EXECUTIVE_ASSISTANT_ID ? executiveAssistantGreeting() : VOICE_PLACEHOLDER_TEXT);
    voiceTimeout = window.setTimeout(() => {
      setVoiceState(isAssistantVoiceAvailable(agent) ? "muted" : "unavailable");
    }, 3200);
  }, 700);
}

function updateVoiceState(): void {
  const agent = executiveAssistant();
  currentAudioZone = audioZoneForPoint({ x: player.position.x, z: player.position.z }, sceneState.activeScene);
  if (!agent || sceneState.activeScene !== "headquarters") {
    playerDistanceToAgent = null;
    voiceVolume = 0;
    agentAudioZone = null;
    voiceRoomAttenuation = 0;
    if (voiceState !== "listening" && voiceState !== "speaking") setVoiceState("unavailable");
  } else {
    playerDistanceToAgent = distance2D({ x: player.position.x, z: player.position.z }, agent.position);
    agentAudioZone = audioZoneForPoint(agent.position, agent.currentScene);
    voiceRoomAttenuation = currentAudioZone === agentAudioZone ? 1 : VOICE_CROSS_ROOM_ATTENUATION;
    const falloffDistance = VOICE_MAX_DISTANCE - VOICE_FULL_VOLUME_DISTANCE;
    const distanceVolume = clamp01(1 - Math.max(0, playerDistanceToAgent - VOICE_FULL_VOLUME_DISTANCE) / falloffDistance);
    voiceVolume = agentVoiceEnabled ? clamp01(distanceVolume * voiceRoomAttenuation * voiceVolumeSetting) : 0;
    if (!isAssistantVoiceAvailable(agent) && voiceState !== "listening" && voiceState !== "speaking") {
      setVoiceState("unavailable");
    } else if (isAssistantVoiceAvailable(agent) && voiceState === "unavailable") {
      setVoiceState("muted");
    }
  }

  voicePanel.hidden = !agentVoiceEnabled || (voiceState === "unavailable" && !voiceCaptionText && !isAssistantVoiceAvailable(agent));
  const distanceLabel = playerDistanceToAgent === null ? "outside range" : `${playerDistanceToAgent.toFixed(1)}m`;
  const zoneLabel = audioZoneLabel(currentAudioZone);
  voiceStatus.textContent = `Voice: ${voiceState} / ${Math.round(voiceVolume * 100)}% / ${distanceLabel} / ${zoneLabel}`;
  voiceMeterFill.style.width = `${Math.round(voiceVolume * 100)}%`;
  voiceCaption.hidden = !voiceCaptionText || !captionsEnabled;
  voiceCaption.textContent = voiceCaptionText;
  updateVoiceSettingsPanel();
}

function updateVoiceSettingsPanel(): void {
  voiceEnabledToggle.checked = agentVoiceEnabled;
  captionsEnabledToggle.checked = captionsEnabled;
  voiceVolumeSlider.value = `${Math.round(voiceVolumeSetting * 100)}`;
  voiceVolumeValue.textContent = `${Math.round(voiceVolumeSetting * 100)}%`;
  voicePushToTalkKey.textContent = "V";
  voiceCurrentZone.textContent = audioZoneLabel(currentAudioZone);
  voiceStateDisplay.textContent = voiceState;
  voiceOpenAiStatus.textContent = "not connected yet";
}

function openVoiceSettings(): void {
  voiceSettingsPanel.hidden = false;
  updateVoiceSettingsPanel();
  actionPrompt.hidden = true;
  updateTouchControlVisibility();
}

function closeVoiceSettings(): void {
  voiceSettingsPanel.hidden = true;
  updateTouchControlVisibility();
}

function relationshipToPlayerLabel(score: number): string {
  if (score >= 75) return "close friend";
  if (score >= 40) return "friend";
  if (score >= 10) return "friendly";
  if (score >= -9) return "neutral";
  if (score >= -39) return "tense";
  if (score >= -74) return "disliked";
  return "enemy";
}

function greetingForPlayer(citizen: Citizen): string {
  const score = relationshipForCitizen(playerProfile, citizen.id);
  if (citizen.currentState === "walking_to_work" || citizen.currentMood === "rushed" || citizen.wasLateToday) return `Make it quick, ${playerProfile.displayName}. I'm on my way.`;
  if (citizen.id === EXECUTIVE_ASSISTANT_ID) return executiveAssistantGreeting();
  if (citizen.agentType === "personal_assistant") return citizen.greetingScript[0] ?? `Welcome back, ${playerProfile.displayName}.`;
  if (score >= 40) return `Hey ${playerProfile.displayName}, good to see you.`;
  if (score <= -10) return "Oh. It's you.";
  return "Hey, need something?";
}

function sourceName(item: KnowledgeItem): string {
  return item.sourceCitizenId ? citizenName(item.sourceCitizenId) : "District";
}

function playerKnowledgeIds(): string[] {
  return playerProfile.knowledgeJournal.map((entry) => entry.knowledgeId);
}

function chooseKnowledgeForPlayer(citizen: Citizen): KnowledgeItem | null {
  const knownByPlayer = new Set(playerKnowledgeIds());
  const candidates = knowledgeItemsForIds([...citizen.knownKnowledgeIds, ...citizen.privateKnowledgeIds]).filter((item) => !knownByPlayer.has(item.id));
  if (!candidates.length) return null;
  if (playerProfile.knowledgeJournal.length === 0) return candidates[0];
  const relationshipBoost = Math.max(0, citizen.relationshipToPlayer) / 180;
  const busyPenalty = citizen.currentState === "walking_to_work" || citizen.currentMood === "rushed" ? 0.18 : 0;
  const chance = Math.max(0.18, Math.min(0.82, 0.42 + relationshipBoost - busyPenalty));
  const seed = `${citizen.id}:player:${Math.floor(worldTime.absoluteMinutes / 11)}:${candidates.length}`;
  if (deterministicUnit(seed) > chance) return null;
  return candidates[Math.floor(deterministicUnit(`${seed}:pick`) * candidates.length)];
}

function renderJournal(): void {
  for (const tab of journalTabs) {
    tab.classList.toggle("active", tab.dataset.journalTab === activeJournalTab);
  }
  if (activeJournalTab === "contacts") {
    if (!playerProfile.knownCitizenIds.length) {
      journalList.textContent = "<p>No contacts yet. Talk to agents to add them.</p>";
      return;
    }

    journalList.textContent = playerProfile.knownCitizenIds
      .map((citizenId) => {
        const citizen = citizens.find((entry) => entry.id === citizenId);
        if (!citizen) return "";
        const activeShift = getActiveShift(citizen, worldTime.absoluteMinutes);
        const workplace = activeShift?.businessId ?? citizen.knownBusinesses[0] ?? "Unknown";
        const score = relationshipForCitizen(playerProfile, citizenId);
        return `
          <article class="journal-item">
            <h3>${citizen.name}</h3>
            <p>Role: ${activeShift?.role ?? citizen.role}</p>
            <p>Last Known: ${citizen.currentLocation} / ${citizen.currentState}</p>
            <p>Relationship: ${score} (${relationshipLabelForCitizen(playerProfile, citizenId)})</p>
            <p>Known Workplace: ${workplace}</p>
          </article>
        `;
      })
      .join("");
    return;
  }

  const items = knowledgeItemsForIds(playerKnowledgeIds()).filter((item) => item.type === activeJournalTab);
  if (!items.length) {
    journalList.textContent = `<p>No ${activeJournalTab === "citizen" ? "people" : `${activeJournalTab}s`} discovered yet.</p>`;
    return;
  }

  journalList.textContent = items
    .map(
      (item) => `
        <article class="journal-item">
          <h3>${item.title}</h3>
          <p>${item.description}</p>
          <p>Source: ${playerProfile.knowledgeJournal.find((entry) => entry.knowledgeId === item.id)?.sourceCitizenId ? citizenName(playerProfile.knowledgeJournal.find((entry) => entry.knowledgeId === item.id)!.sourceCitizenId!) : sourceName(item)} / Confidence: ${item.confidence}</p>
          <p>Tags: ${item.tags.join(", ")}</p>
        </article>
      `
    )
    .join("");
}

function openJournal(tab: typeof activeJournalTab = activeJournalTab): void {
  activeJournalTab = tab;
  renderJournal();
  journalModal.hidden = false;
  updateTouchControlVisibility();
}

function renderPhone(): void {
  for (const tab of phoneTabs) tab.classList.toggle("active", tab.dataset.phoneApp === activePhoneApp);

  if (activePhoneApp === "contacts") {
    phoneContent.textContent = playerProfile.knownCitizenIds.length
      ? playerProfile.knownCitizenIds
          .map((citizenId) => {
            const citizen = citizens.find((entry) => entry.id === citizenId);
            if (!citizen) return "";
            return `<article class="phone-card"><h3>${citizen.name}</h3><p>${citizen.role}</p><p>${citizen.currentLocation} / ${citizen.currentState}</p><p>${relationshipForCitizen(playerProfile, citizen.id)} (${relationshipLabelForCitizen(playerProfile, citizen.id)})</p><p>Known workplace: ${citizen.knownBusinesses[0] ?? "Unknown"}</p></article>`;
          })
          .join("")
      : "<p>No contacts yet.</p>";
    return;
  }

  if (activePhoneApp === "messages") {
    phoneContent.textContent = playerProfile.messages.length
      ? playerProfile.messages.map((message) => `<article class="phone-card"><h3>${message.title}</h3><p>${message.body}</p><p>${message.category}</p></article>`).join("")
      : "<p>No messages yet.</p>";
    return;
  }

  if (activePhoneApp === "knowledge") {
    const items = knowledgeItemsForIds(playerKnowledgeIds());
    const section = (label: string, type: KnowledgeItem["type"]) => {
      const matches = items.filter((item) => item.type === type);
      return `<h3>${label}</h3>${matches.length ? matches.map((item) => `<article class="phone-card"><strong>${item.title}</strong><p>${item.description}</p></article>`).join("") : "<p>None discovered.</p>"}`;
    };
    phoneContent.textContent = `${section("People", "citizen")}${section("Places", "place")}${section("Businesses", "business")}${section("Rumors", "rumor")}`;
    return;
  }

  if (activePhoneApp === "profile") {
    phoneContent.textContent = `
      <article class="phone-card">
        <h3>${playerProfile.displayName}</h3>
        <p>Wallet: $${Math.round(playerProfile.wallet)}</p>
        <p>Reputation: ${playerProfile.reputationStars.toFixed(1)}</p>
        <p>Influence: ${Math.round(playerProfile.influence)}</p>
        <p>Contacts: ${playerProfile.knownCitizenIds.length}</p>
        <p>Knowledge: ${playerProfile.knowledgeJournal.length}</p>
        <p>Interests: ${playerProfile.interests.join(", ")}</p>
      </article>
    `;
    return;
  }

  if (activePhoneApp === "map") {
    const businessEntities = deriveBusinessEntities(citizens, worldTime);
    phoneContent.textContent = `
      <article class="phone-card">
        <h3>${DISTRICT_NAME}</h3>
        <p>Current area: ${currentArea.textContent}</p>
        <p>STG Headquarters is the first active World Zero building.</p>
      </article>
      ${businessEntities.map((business) => `<article class="phone-card"><strong>${business.businessName}</strong><p>${business.businessType} / ${business.operationalStatus}</p><p>Reputation ${business.reputation.toFixed(1)} / Staff ${business.staffingStatus}</p></article>`).join("")}
    `;
    return;
  }

  phoneContent.textContent = `<article class="phone-card">${opsSummary.textContent}<p>Selected: ${(selectedCitizen ?? citizens[0]).name}</p></article>`;
}

function openPhone(appName: typeof activePhoneApp = activePhoneApp): void {
  activePhoneApp = appName;
  renderPhone();
  phonePanel.hidden = false;
  updateTouchControlVisibility();
}

function showToast(message: string): void {
  toastMessage.textContent = message;
  toastMessage.hidden = false;
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toastMessage.hidden = true;
  }, 2600);
}

function shouldShowTouchControls(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches || window.innerWidth <= 1024;
}

function updateTouchControlVisibility(): void {
  const focusedElement = document.activeElement;
  const typing =
    focusedElement instanceof HTMLInputElement ||
    focusedElement instanceof HTMLTextAreaElement ||
    focusedElement instanceof HTMLSelectElement;
  const state = computeMobileControlState({
    cityEntered,
    mobileCapable: shouldShowTouchControls(),
    typing,
    interactionBlocked: recordsTerminalDialog.open || operationsDirectoryDialog.open || privateRecordsDialog.open,
    transitionBlocked: sceneState.transitioning,
    activeContextAction: activeContextAction !== null
  });
  touchControls.classList.toggle("visible", state.containerVisible);
  touchActionButton.hidden = !state.actionVisible;
  touchActionButton.disabled = !state.actionVisible;
  touchActionButton.textContent = contextActionLabel(activeContextAction);
  touchActionButton.setAttribute("aria-label", contextActionAriaLabel(activeContextAction));
  if (!state.containerVisible) resetJoystick();
}

function contextActionLabel(action: ContextAction | null): string {
  if (action === "inspect_records") return "Inspect";
  const operationsFixture = OPERATIONS_FIXTURES.find((fixture) => fixture.action === action);
  if (operationsFixture) return operationsFixture.actionLabel;
  return "Action";
}

function contextActionAriaLabel(action: ContextAction | null): string {
  if (action === "enter_headquarters") return "Enter STG Headquarters";
  if (action === "leave_headquarters") return "Exit STG Headquarters";
  if (action === "inspect_records") return "Inspect Records Terminal";
  const operationsFixture = OPERATIONS_FIXTURES.find((fixture) => fixture.action === action);
  if (operationsFixture) return operationsFixture.ariaLabel;
  return "Interact";
}

function updateJoystickFromPointer(event: PointerEvent): void {
  const rect = touchJoystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = rect.width / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const clampedDistance = Math.min(distance, radius);
  const angle = Math.atan2(dy, dx);
  const knobX = Math.cos(angle) * clampedDistance;
  const knobY = Math.sin(angle) * clampedDistance;
  const deadZone = 0.14;
  const strength = clampedDistance / radius;
  touchJoystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  touchMoveInput.x = strength > deadZone ? knobX / radius : 0;
  touchMoveInput.y = strength > deadZone ? -knobY / radius : 0;
}

function resetJoystick(): void {
  activeJoystickPointerId = null;
  touchMoveInput.set(0, 0);
  touchJoystickKnob.style.transform = "translate(-50%, -50%)";
}

function renderHomeProfile(): void {
  homeTitle.textContent = "STG Headquarters";
  homeContent.textContent = `
    <p>Player: ${playerProfile.displayName}</p>
    <p>Wallet: $${Math.round(playerProfile.wallet)}</p>
    <p>Reputation: ${playerProfile.reputationStars.toFixed(1)}</p>
    <p>Influence: ${Math.round(playerProfile.influence)}</p>
    <p>Contacts: ${playerProfile.knownCitizenIds.length}</p>
    <p>Known Knowledge: ${playerProfile.knowledgeJournal.length}</p>
    <p>Home: STG Headquarters</p>
  `;
  homePanel.hidden = false;
  updateTouchControlVisibility();
}

async function restAtHome(): Promise<void> {
  await fadeToScene(sceneState, fadeOverlay, "headquarters", () => {});
  showToast("You reviewed the briefing.");
}

function closeHomePanel(): void {
  homePanel.hidden = true;
  updateTouchControlVisibility();
}

function logCitizenTransition(message: string): void {
  citizenTransitionLog.unshift(`${formatWorldTime(worldTime)} - ${message}`);
  citizenTransitionLog.length = Math.min(citizenTransitionLog.length, 12);
  console.info(`[door-routing] ${message}`);
}

function doorApproachPoint(portal: typeof headquartersPortal): { x: number; z: number } {
  if (portal.facingDirection === "south") return { x: portal.exteriorPosition.x, z: portal.exteriorPosition.z + DOOR_APPROACH_DISTANCE };
  if (portal.facingDirection === "north") return { x: portal.exteriorPosition.x, z: portal.exteriorPosition.z - DOOR_APPROACH_DISTANCE };
  if (portal.facingDirection === "east") return { x: portal.exteriorPosition.x + DOOR_APPROACH_DISTANCE, z: portal.exteriorPosition.z };
  return { x: portal.exteriorPosition.x - DOOR_APPROACH_DISTANCE, z: portal.exteriorPosition.z };
}

function routeCitizenToExteriorDoor(citizen: Citizen, portal: typeof headquartersPortal): void {
  if (citizen.routeWaypoints.length) return;
  const approach = doorApproachPoint(portal);
  citizen.routeWaypoints = [
    { x: citizen.position.x, z: approach.z },
    approach,
    { ...portal.exteriorPosition }
  ].filter((point, index, points) => index === 0 || distance2D(point, points[index - 1]) > 0.4);
}

function nextCitizenWaypoint(citizen: Citizen, finalTarget: { x: number; z: number }): { x: number; z: number } {
  if (!citizen.routeWaypoints.length) return finalTarget;
  return citizen.routeWaypoints[0];
}

function consumeWaypointIfArrived(citizen: Citizen, arrived: boolean): boolean {
  if (!arrived) return false;
  if (citizen.routeWaypoints.length) {
    citizen.routeWaypoints.shift();
    return citizen.routeWaypoints.length === 0;
  }
  return true;
}

function moveCitizenToward(citizen: Citizen, target: { x: number; z: number }, delta: number): boolean {
  const dx = target.x - citizen.position.x;
  const dz = target.z - citizen.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance < 0.25) {
    citizen.position.x = target.x;
    citizen.position.z = target.z;
    return true;
  }

  const step = Math.min(distance, AGENT_WALK_SPEED * delta);
  citizen.position.x += (dx / distance) * step;
  citizen.position.z += (dz / distance) * step;
  return false;
}

function updateDealerRotation(): void {
  const rotationMinute = Math.floor(worldTime.absoluteMinutes / 30);
  const dealerStations = ["reception"];
  const activeDealers = citizens.filter((citizen) => citizen.currentState === "working" && citizen.role.includes("Dealer"));
  for (const [index, citizen] of activeDealers.entries()) {
    const station = workstationById(dealerStations[(index + rotationMinute) % dealerStations.length]);
    citizen.currentWorkstationId = station.id;
    citizen.currentLocation = station.name;
    citizen.currentDestination = station.name;
    moveCitizenToward(citizen, station.position, 0.04);
  }
}

function patrolCitizen(citizen: Citizen, points: Workstation[], delta: number): void {
  if (!points.length) return;
  const index = Math.floor(worldTime.absoluteMinutes / 5 + citizen.id.length) % points.length;
  const target = points[index].position;
  citizen.currentLocation = points[index].name;
  citizen.currentDestination = points[index].name;
  moveCitizenToward(citizen, target, delta * 0.45);
}

function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function updateCitizenNeeds(citizen: Citizen, realDelta: number): void {
  const minutes = realDelta * 5;
  if (citizen.currentState === "working") {
    citizen.needs.energy = Math.max(0, citizen.needs.energy - minutes * 0.035);
    citizen.needs.hunger = Math.min(100, citizen.needs.hunger + minutes * 0.028);
    citizen.needs.social = Math.max(0, citizen.needs.social - minutes * 0.012);
  } else if (citizen.currentState === "home" || citizen.currentState === "off_district") {
    citizen.needs.energy = Math.min(100, citizen.needs.energy + minutes * 0.045);
    citizen.needs.hunger = Math.max(0, citizen.needs.hunger - minutes * 0.018);
    citizen.needs.social = Math.max(0, citizen.needs.social - minutes * 0.006);
  } else {
    citizen.needs.energy = Math.max(0, citizen.needs.energy - minutes * 0.012);
    citizen.needs.hunger = Math.min(100, citizen.needs.hunger + minutes * 0.018);
    citizen.needs.social = Math.max(0, citizen.needs.social - minutes * 0.01);
  }
  citizen.needs.moneyStress = Math.max(0, Math.min(100, citizen.needs.moneyStress + minutes * 0.002 - citizen.wallet * 0.00002));

  if (citizen.currentState === "walking_to_work") {
    citizen.currentMood = citizen.wasLateToday || citizen.delayMinutes > 10 ? "annoyed" : "rushed";
    citizen.moodReason = citizen.wasLateToday ? "Late for work" : "Commuting to work";
  } else if (citizen.needs.energy < 25) {
    citizen.currentMood = "tired";
    citizen.moodReason = "Low energy";
  } else if (citizen.needs.hunger > 72) {
    citizen.currentMood = "distracted";
    citizen.moodReason = "Hungry";
  } else if (citizen.needs.social < 25) {
    citizen.currentMood = "lonely";
    citizen.moodReason = "Low social need";
  } else if (citizen.needs.moneyStress > 76) {
    citizen.currentMood = "stressed";
    citizen.moodReason = "Money stress";
  } else if (citizen.currentState === "working") {
    citizen.currentMood = "neutral";
    citizen.moodReason = "Focused on work";
  } else {
    citizen.currentMood = "neutral";
    citizen.moodReason = "Stable needs";
  }
}

function canSocialize(citizen: Citizen): boolean {
  if (citizen.currentState === "home" || citizen.currentState === "off_district") return false;
  if (citizen.currentState === "walking_to_work" && (citizen.wasLateToday || citizen.delayMinutes > 5)) return false;
  if (citizen.currentSocialInteraction && citizen.currentSocialInteraction.endsAtAbsoluteMinute > worldTime.absoluteMinutes) return false;
  if (citizen.role.includes("Dealer") && citizen.currentState === "working") return false;
  if (citizen.role.includes("Surveillance") && citizen.currentState === "working") return false;
  return true;
}

function startSocialInteraction(a: Citizen, b: Citizen): void {
  const seed = `${a.id}:${b.id}:${Math.floor(worldTime.absoluteMinutes / 15)}`;
  const sharedInterests = a.interests.filter((interest) => b.interests.includes(interest));
  const topicPool = sharedInterests.length ? sharedInterests : socialTopics;
  const topic = topicPool[Math.floor(deterministicUnit(seed) * topicPool.length)];
  const duration = 5 + Math.floor(deterministicUnit(`${seed}:duration`) * 11);
  const delta = deterministicUnit(`${seed}:delta`) > 0.18 ? 1 : -1;
  const endsAtAbsoluteMinute = worldTime.absoluteMinutes + duration;
  a.currentSocialInteraction = { partnerId: b.id, topic, endsAtAbsoluteMinute, relationshipDelta: delta };
  b.currentSocialInteraction = { partnerId: a.id, topic, endsAtAbsoluteMinute, relationshipDelta: delta };
  a.needs.social = Math.min(100, a.needs.social + 8);
  b.needs.social = Math.min(100, b.needs.social + 8);
  adjustRelationship(a, b.id, delta, ["social", topic]);
  adjustRelationship(b, a.id, delta, ["social", topic]);
  const aShare = chooseShareableKnowledge(a, b, worldTime);
  if (aShare) shareKnowledge(a, b, aShare, worldTime);
  const bShare = chooseShareableKnowledge(b, a, worldTime);
  if (bShare) shareKnowledge(b, a, bShare, worldTime);
  persistCitizenSocial(a);
  persistCitizenSocial(b);
}

function updateSocialInteractions(): void {
  for (const citizen of citizens) {
    if (citizen.currentSocialInteraction && citizen.currentSocialInteraction.endsAtAbsoluteMinute <= worldTime.absoluteMinutes) {
      citizen.currentSocialInteraction = null;
    }
  }

  if (performance.now() - lastSocialCheckAt < 2500) return;
  lastSocialCheckAt = performance.now();

  const candidates = citizens.filter(canSocialize);
  for (let index = 0; index < candidates.length; index += 1) {
    const a = candidates[index];
    if (a.currentSocialInteraction) continue;
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const b = candidates[otherIndex];
      if (b.currentSocialInteraction || a.currentScene !== b.currentScene) continue;
      if (distance2D(a.position, b.position) > 3.6) continue;
      const relation = a.relationships[b.id]?.score ?? 0;
      const chance = 0.28 + Math.max(0, relation) / 280;
      if (deterministicUnit(`${a.id}:${b.id}:${Math.floor(worldTime.absoluteMinutes / 10)}`) < chance) {
        startSocialInteraction(a, b);
      }
      break;
    }
  }
}

function initializeCitizenSimulationForCurrentTime(): void {
  for (const citizen of citizens) {
    const activeShift = getActiveShift(citizen, worldTime.absoluteMinutes);
    if (activeShift) {
      const minutesIntoShift = worldTime.absoluteMinutes - activeShift.startAbsoluteMinute;
      if (minutesIntoShift > 45) startWorking(citizen, activeShift, worldTime);
      else startCommutingToWork(citizen, activeShift);
      continue;
    }

    const upcomingShift = getUpcomingShift(citizen, worldTime.absoluteMinutes);
    if (upcomingShift) startCommutingToWork(citizen, upcomingShift);
  }
}

function updateCitizenSchedules(realDelta: number, movementDelta: number): void {
  for (const citizen of citizens) {
    updateCitizenNeeds(citizen, realDelta);

    if (activeInteractionCitizen?.id === citizen.id && popup.hidden === false && citizen.currentState === "walking_to_work") {
      citizen.delayMinutes += realDelta * 5;
      continue;
    }

    const activeShift = getActiveShift(citizen, worldTime.absoluteMinutes);
    const upcomingShift = getUpcomingShift(citizen, worldTime.absoluteMinutes);

    if (citizen.currentSocialInteraction && citizen.currentSocialInteraction.endsAtAbsoluteMinute > worldTime.absoluteMinutes) {
      if (citizen.currentState === "walking_to_work") citizen.delayMinutes += realDelta * 5;
      continue;
    }

    if (citizen.currentState === "home" || citizen.currentState === "off_district") {
      if (upcomingShift) startCommutingToWork(citizen, upcomingShift);
      else if (activeShift) startCommutingToWork(citizen, activeShift);
      continue;
    }

    if (citizen.currentState === "walking_to_work") {
      const shift = activeShift ?? getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes);
      const targetPortal = shift ? portalById(shift.portalId) : portalById(citizen.offDistrictEntryPortalId);
      routeCitizenToExteriorDoor(citizen, targetPortal);
      const arrived = moveCitizenToward(citizen, nextCitizenWaypoint(citizen, targetPortal.exteriorPosition), movementDelta);
      if (arrived && shift) {
        const routeComplete = consumeWaypointIfArrived(citizen, true);
        if (routeComplete) {
          enterWorkPortal(citizen, shift);
          logCitizenTransition(`${citizen.name} entered ${targetPortal.buildingId} via ${targetPortal.id}`);
          if (shift.scene === "outside" || targetPortal.linkedScene === "outside") startWorking(citizen, shift, worldTime);
        }
      } else {
        consumeWaypointIfArrived(citizen, arrived);
      }
      continue;
    }

    if (citizen.currentState === "walking_to_workstation") {
      const shift = activeShift ?? getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes);
      const station = shift ? workstationById(shift.workstationId) : null;
      if (!shift || !station) {
        sendCitizenHome(citizen, getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes));
        continue;
      }
      const arrived = moveCitizenToward(citizen, station.position, movementDelta);
      if (arrived) startWorking(citizen, shift, worldTime);
      continue;
    }

    if (citizen.currentState === "working") {
      if (!activeShift) {
        sendCitizenHome(citizen, getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes));
      }
      continue;
    }

    if (citizen.currentState === "idle") {
      if (!activeShift) sendCitizenHome(citizen, getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes));
      continue;
    }

    if (citizen.currentState === "walking_home") {
      const portal = portalById(citizen.offDistrictEntryPortalId);
      routeCitizenToExteriorDoor(citizen, portal);
      const arrived = moveCitizenToward(citizen, nextCitizenWaypoint(citizen, portal.exteriorPosition), movementDelta);
      const routeComplete = consumeWaypointIfArrived(citizen, arrived);
      if (routeComplete) {
        citizen.currentState = "home";
        citizen.currentScene = "none";
        citizen.currentMood = "neutral";
        citizen.currentLocation = "Home";
        citizen.currentDestination = null;
        citizen.activeShiftKey = null;
        citizen.routeWaypoints = [];
      }
      continue;
    }

    if (citizen.currentState === "leaving_building") {
      const shift = getShiftByKey(citizen, citizen.activeShiftKey, worldTime.absoluteMinutes);
      const exitPortal = portalById(shift?.portalId ?? citizen.offDistrictEntryPortalId);
      const arrived = moveCitizenToward(citizen, exitPortal.interiorPosition, movementDelta);
      if (arrived) {
        citizen.position = { ...exitPortal.exteriorPosition };
        citizen.currentScene = "outside";
        citizen.currentState = "walking_to_destination";
        citizen.currentDestination = citizen.offDistrictEntryPortalId;
        citizen.currentLocation = "Outside";
        citizen.routeWaypoints = [];
        logCitizenTransition(`${citizen.name} exited ${exitPortal.buildingId} via ${exitPortal.id}`);
      }
      continue;
    }

    if (citizen.currentState === "walking_to_destination") {
      const portal = portalById(citizen.offDistrictEntryPortalId);
      routeCitizenToExteriorDoor(citizen, portal);
      const arrived = moveCitizenToward(citizen, nextCitizenWaypoint(citizen, portal.exteriorPosition), movementDelta);
      const routeComplete = consumeWaypointIfArrived(citizen, arrived);
      if (routeComplete) {
        citizen.currentState = citizen.home === "home" ? "home" : "off_district";
        citizen.currentScene = "none";
        citizen.currentMood = "neutral";
        citizen.currentLocation = citizen.home === "home" ? "Home" : "Off District";
        citizen.currentDestination = null;
        citizen.activeShiftKey = null;
        citizen.routeWaypoints = [];
      }
    }
  }

  updateDealerRotation();
  updateSocialInteractions();

  if (performance.now() - lastSocialPersistAt > 10000) {
    lastSocialPersistAt = performance.now();
    for (const citizen of citizens) persistCitizenSocial(citizen);
  }
}

function updateCitizenMeshes(): void {
  for (const runtime of citizenRuntimes) {
    const shouldShow = runtime.citizen.currentScene === sceneState.activeScene && runtime.citizen.currentState !== "home" && runtime.citizen.currentState !== "off_district";
    runtime.group.visible = shouldShow;
    runtime.group.position.set(runtime.citizen.position.x, 0, runtime.citizen.position.z);
    runtime.speech.visible = shouldShow && runtime.citizen.currentSocialInteraction !== null;
    if (runtime.citizen.currentSocialInteraction) {
      const partner = citizens.find((entry) => entry.id === runtime.citizen.currentSocialInteraction?.partnerId);
      if (partner) runtime.group.rotation.y = Math.atan2(partner.position.x - runtime.citizen.position.x, partner.position.z - runtime.citizen.position.z);
    }
  }
}

function movePlayer(delta: number): void {
  if (!cityEntered || sceneState.transitioning || recordsTerminalDialog.open || operationsDirectoryDialog.open || privateRecordsDialog.open) {
    playerVelocity.lerp(new THREE.Vector3(), 1 - Math.pow(0.00003, delta));
    return;
  }

  const input = new THREE.Vector3();
  if (keys.has("keyw") || keys.has("arrowup")) input.z += 1;
  if (keys.has("keys") || keys.has("arrowdown")) input.z -= 1;
  if (keys.has("keya") || keys.has("arrowleft")) input.x -= 1;
  if (keys.has("keyd") || keys.has("arrowright")) input.x += 1;
  input.x += touchMoveInput.x;
  input.z += touchMoveInput.y;

  if (input.lengthSq() > 0) {
    const desiredDirection = ISO_FORWARD
      .clone()
      .multiplyScalar(input.z)
      .add(ISO_RIGHT.clone().multiplyScalar(input.x))
      .normalize();
    playerVelocity.lerp(desiredDirection.multiplyScalar(PLAYER_SPEED), 1 - Math.pow(0.0008, delta));
  } else {
    playerVelocity.lerp(new THREE.Vector3(), 1 - Math.pow(0.00003, delta));
  }

  const step = playerVelocity.clone().multiplyScalar(delta);
  const nextX = player.position.clone();
  nextX.x += step.x;
  if (!collidesAt(nextX)) player.position.x = nextX.x;

  const nextZ = player.position.clone();
  nextZ.z += step.z;
  if (!collidesAt(nextZ)) player.position.z = nextZ.z;

  if (playerVelocity.lengthSq() > 0.05) {
    player.rotation.y = Math.atan2(playerVelocity.x, playerVelocity.z);
  }
}

function updateCamera(delta: number): void {
  const desiredPosition = player.position.clone().add(ISO_CAMERA_OFFSET);
  const desiredTarget = player.position.clone().add(new THREE.Vector3(0, 1.1, 0));
  camera.position.lerp(desiredPosition, 1 - Math.pow(0.0025, delta));
  cameraLookTarget.lerp(desiredTarget, 1 - Math.pow(0.005, delta));
  camera.lookAt(cameraLookTarget);
}

function setBuildingOpacity(building: WorldBuildingRuntime, opacity: number): void {
  for (const material of building.materials) {
    material.transparent = true;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.95;
  }
}

function updateBuildingOcclusion(): void {
  let blockingBuilding: WorldBuildingRuntime | null = null;

  if (occlusionEnabled && sceneState.activeScene === "outside") {
    const playerTarget = player.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const direction = playerTarget.clone().sub(camera.position).normalize();
    const playerDistance = camera.position.distanceTo(playerTarget);
    raycaster.set(camera.position, direction);
    raycaster.far = playerDistance - 0.3;
    const intersections = raycaster.intersectObjects(buildingRuntimes.map((building) => building.occluder), false);
    const firstHit = intersections[0]?.object;

    if (firstHit) {
      blockingBuilding = buildingRuntimes.find((building) => building.occluder === firstHit) ?? null;
    }
  }

  for (const building of buildingRuntimes) {
    setBuildingOpacity(building, building === blockingBuilding ? 0.38 : 1);
    building.roof.visible = building !== blockingBuilding || occlusionEnabled;
  }
}

function updateSceneVisibility(): void {
  outsideGroup.visible = sceneState.activeScene === "outside";
  headquartersGroup.visible = sceneState.activeScene === "headquarters";
}

function canInspectRecordsTerminal(): boolean {
  return (
    sceneState.activeScene === "headquarters" &&
    distance2D({ x: player.position.x, z: player.position.z }, RECORDS_TERMINAL_INTERACTION_POSITION) < 2.15
  );
}

function canInspectOperationsFixture(fixture: OperationsFixture): boolean {
  return (
    sceneState.activeScene === "headquarters" &&
    distance2D({ x: player.position.x, z: player.position.z }, fixture.position) < fixture.radius
  );
}

function updateNavigationContext(): void {
  activeContextAction = null;
  const playerPoint = { x: player.position.x, z: player.position.z };

  if (sceneState.activeScene === "outside") {
    if (distance2D(playerPoint, headquartersPortal.exteriorPosition) < 2.8) activeContextAction = "enter_headquarters";
  } else if (sceneState.activeScene === "headquarters") {
    if (distance2D(playerPoint, headquartersPortal.interiorPosition) < 2.4) activeContextAction = "leave_headquarters";
    else if (canInspectRecordsTerminal()) activeContextAction = "inspect_records";
    else {
      const operationsFixture = OPERATIONS_FIXTURES.find(canInspectOperationsFixture);
      if (operationsFixture) activeContextAction = operationsFixture.action;
    }
  }

  const contextStatusState = computeContextActionStatusState({
    cityEntered,
    transitionBlocked: sceneState.transitioning,
    recordsTerminalOpen: recordsTerminalDialog.open,
    operationsDirectoryOpen: operationsDirectoryDialog.open,
    activeContextLabel: activeContextAction === null ? null : contextActionAriaLabel(activeContextAction)
  });
  contextActionStatus.hidden = contextStatusState.hidden;
  contextActionStatus.textContent = contextStatusState.text;

  updateTouchControlVisibility();
}

function openInteraction(citizen: Citizen): void {
  if (citizen.agentType === "personal_assistant") {
    openBriefing(citizen);
    return;
  }

  activeInteractionCitizen = citizen;
  selectedCitizen = citizen;
  const addedContact = addContact(playerProfile, citizen.id);
  contactAddedMessage = addedContact ? "Contact added" : "";
  if (addedContact) addPlayerMessage(playerProfile, "Contact added", `${citizen.name} was added to your contacts.`, worldTime.absoluteMinutes, "contact");
  if (canGainTalkRelationship(playerProfile, citizen.id, worldTime.absoluteMinutes) && citizen.currentMood !== "annoyed") {
    adjustPlayerCitizenRelationship(playerProfile, citizen.id, 1);
    markTalkRelationship(playerProfile, citizen.id, worldTime.absoluteMinutes);
  }
  if (citizen.currentState === "walking_to_work") citizen.delayMinutes += 1;
  popupFields.name.textContent = citizen.name;
  popupFields.role.textContent = `Current Role: ${citizen.role}`;
  popupFields.mood.textContent = `Mood: ${citizen.currentMood}`;
  popupFields.state.textContent = `State: ${citizen.currentState}`;
  popupFields.wallet.textContent = `Wallet: $${Math.round(citizen.wallet)}`;
  popupFields.relationship.textContent = `Relationship: ${relationshipLabelForCitizen(playerProfile, citizen.id)} (${relationshipForCitizen(playerProfile, citizen.id)})${contactAddedMessage ? ` / ${contactAddedMessage}` : ""}`;
  popupFields.known.textContent = `Known coworkers/friends: ${formatCitizenList([...citizen.coworkers, ...citizen.friends])}`;
  popupFields.late.textContent = `Late today: ${citizen.wasLateToday ? "Yes" : "No"} / Delay: ${Math.floor(citizen.delayMinutes)} min`;
  popupFields.greeting.textContent = greetingForPlayer(citizen);
  activeSharedKnowledge = chooseKnowledgeForPlayer(citizen);
  if (activeSharedKnowledge) {
    sharedKnowledgeLine.hidden = false;
    rememberKnowledgeButton.hidden = false;
    sharedKnowledgeLine.textContent = `Shared: ${activeSharedKnowledge.description}`;
  } else {
    sharedKnowledgeLine.hidden = false;
    rememberKnowledgeButton.hidden = true;
    sharedKnowledgeLine.textContent = "They do not share anything new right now.";
  }
  popup.hidden = false;
  actionPrompt.hidden = true;
  updateTouchControlVisibility();
}

function closeInteraction(): void {
  popup.hidden = true;
  activeInteractionCitizen = null;
  activeSharedKnowledge = null;
  updateTouchControlVisibility();
}

function maybeOpenReceptionBriefing(): void {
  if (briefingAutoOpened || sceneState.transitioning || sceneState.activeScene !== "headquarters") return;
  if (!briefingPanel.hidden || !popup.hidden || !phonePanel.hidden || !voiceSettingsPanel.hidden || !journalModal.hidden || !homePanel.hidden || !characterModal.hidden) return;

  const assistant = executiveAssistant();
  if (!assistant) return;
  const inReception = distance2D({ x: player.position.x, z: player.position.z }, { x: 0, z: 5.2 }) < 3.2;
  const nearAssistant = distance2D({ x: player.position.x, z: player.position.z }, assistant.position) < 3.2;
  if (!inReception && !nearAssistant) return;

  briefingAutoOpened = true;
  openBriefing(assistant);
}

popupClose.addEventListener("click", closeInteraction);
popupLeave.addEventListener("click", closeInteraction);
briefingClose.addEventListener("click", closeBriefing);
voiceSettingsOpen.addEventListener("click", openVoiceSettings);
voiceSettingsClose.addEventListener("click", closeVoiceSettings);
voiceEnabledToggle.addEventListener("change", () => {
  agentVoiceEnabled = voiceEnabledToggle.checked;
  if (!agentVoiceEnabled) {
    clearVoiceTimeout();
    setVoiceState("unavailable");
  }
  updateVoiceState();
});
captionsEnabledToggle.addEventListener("change", () => {
  captionsEnabled = captionsEnabledToggle.checked;
  updateVoiceState();
});
voiceVolumeSlider.addEventListener("input", () => {
  voiceVolumeSetting = clamp01(Number(voiceVolumeSlider.value) / 100);
  updateVoiceState();
});
rememberKnowledgeButton.addEventListener("click", () => {
  if (!activeSharedKnowledge || !activeInteractionCitizen) return;
  const remembered = rememberKnowledge(playerProfile, activeSharedKnowledge.id, activeInteractionCitizen.id, worldTime.absoluteMinutes);
  if (remembered) addPlayerMessage(playerProfile, "Knowledge remembered", `${activeInteractionCitizen.name} shared: ${activeSharedKnowledge.title}`, worldTime.absoluteMinutes, "knowledge");
  adjustPlayerCitizenRelationship(playerProfile, activeInteractionCitizen.id, 1);
  sharedKnowledgeLine.textContent = `Remembered: ${activeSharedKnowledge.title}`;
  popupFields.relationship.textContent = `Relationship: ${relationshipLabelForCitizen(playerProfile, activeInteractionCitizen.id)} (${relationshipForCitizen(playerProfile, activeInteractionCitizen.id)})`;
  rememberKnowledgeButton.hidden = true;
  renderJournal();
  renderPhone();
});
journalButton.addEventListener("click", () => openPhone("contacts"));
phoneClose.addEventListener("click", () => {
  phonePanel.hidden = true;
  updateTouchControlVisibility();
});
for (const tab of phoneTabs) {
  tab.addEventListener("click", () => {
    const next = tab.dataset.phoneApp;
    if (next === "contacts" || next === "messages" || next === "knowledge" || next === "profile" || next === "map" || next === "debug") openPhone(next);
  });
}
journalClose.addEventListener("click", () => {
  journalModal.hidden = true;
  updateTouchControlVisibility();
});
for (const tab of journalTabs) {
  tab.addEventListener("click", () => {
    const next = tab.dataset.journalTab;
    if (next === "contacts" || next === "citizen" || next === "place" || next === "business" || next === "rumor") openJournal(next);
  });
}
homeClose.addEventListener("click", closeHomePanel);
homeCloseSecondary.addEventListener("click", closeHomePanel);
homeOpenContacts.addEventListener("click", () => {
  closeHomePanel();
  openPhone("contacts");
});
homeOpenJournal.addEventListener("click", () => {
  closeHomePanel();
  openPhone("knowledge");
});

characterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  playerProfile = createDefaultPlayerProfile(characterNameInput.value);
  savePlayerProfile(playerProfile);
  characterModal.hidden = true;
  updateHud();
  renderJournal();
  updateTouchControlVisibility();
});

resetProfileButton.addEventListener("click", () => {
  resetPlayerProfile();
  playerProfile = createDefaultPlayerProfile();
  characterNameInput.value = "Player";
  characterModal.hidden = false;
  renderJournal();
  updateHud();
  updateTouchControlVisibility();
});

resetCitizensButton.addEventListener("click", () => {
  resetCitizenPersistence();
  window.location.reload();
});

resetWorldTimeButton.addEventListener("click", () => {
  resetWorldTimePersistence();
  window.location.reload();
});

touchJoystick.addEventListener("pointerdown", (event) => {
  activeJoystickPointerId = event.pointerId;
  touchJoystick.setPointerCapture(event.pointerId);
  updateJoystickFromPointer(event);
});

touchJoystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activeJoystickPointerId) return;
  updateJoystickFromPointer(event);
});

touchJoystick.addEventListener("pointerup", (event) => {
  if (event.pointerId === activeJoystickPointerId) resetJoystick();
});

touchJoystick.addEventListener("pointercancel", (event) => {
  if (event.pointerId === activeJoystickPointerId) resetJoystick();
});

touchActionButton.addEventListener("click", handleNavigationAction);

function enterWorld(): void {
  cityEntered = true;
  document.body.classList.add("city-entered");
  landingShell.hidden = true;
  landingShell.inert = true;
  landingShell.setAttribute("aria-hidden", "true");
  updateTouchControlVisibility();
}

enterWorldButton.addEventListener("click", enterWorld);
if (kioskPerformanceMode) enterWorld();

async function switchToScene(nextScene: ActiveSceneName, playerPosition: { x: number; z: number }): Promise<void> {
  await fadeToScene(sceneState, fadeOverlay, nextScene, () => {
    player.position.set(playerPosition.x, 0, playerPosition.z);
    playerVelocity.set(0, 0, 0);
    updateSceneVisibility();
    updateCitizenMeshes();
  });
}

function handleNavigationAction(): void {
  if (sceneState.transitioning) return;
  if (activeContextAction === "enter_headquarters") {
    void switchToScene("headquarters", { ...HEADQUARTERS_PLAYER_SPAWN });
  } else if (activeContextAction === "leave_headquarters") {
    void switchToScene("outside", { x: headquartersPortal.exteriorPosition.x, z: headquartersPortal.exteriorPosition.z + 1.1 });
  } else if (activeContextAction === "inspect_records" && canInspectRecordsTerminal()) {
    void recordsTerminal.open();
  } else {
    const operationsFixture = OPERATIONS_FIXTURES.find(
      (fixture) => fixture.action === activeContextAction && canInspectOperationsFixture(fixture)
    );
    if (operationsFixture) {
      const opener = shouldShowTouchControls() ? touchActionButton : renderer.domElement;
      operationsDirectory.open(opener);
    }
  }
}

function updateHud(): void {
  const areaLabels: Record<ActiveSceneName, string> = {
    outside: DISTRICT_NAME,
    headquarters: "STG Headquarters"
  };
  timeDisplay.textContent = formatWorldTime(worldTime);
  playerNameLabel.textContent = playerProfile.displayName;
  playerWalletLabel.textContent = `${Math.round(playerProfile.wallet)}`;
  playerReputationLabel.textContent = playerProfile.reputationStars.toFixed(1);
  playerInfluenceLabel.textContent = `${Math.round(playerProfile.influence)}`;
  currentArea.textContent = areaLabels[sceneState.activeScene];
  multiplayerStatusLabel.textContent = multiplayerHudStatus;
  debugState.textContent = `Occlusion ${occlusionEnabled ? "On" : "Off"} / Grid ${gridVisible ? "On" : "Off"} / Assets ${assetDebugVisible ? "On" : "Off"} / Zoom ${zoomLevelIndex + 1} / Seed ${CITY_SEED}`;
  const grid = outsideGroup.getObjectByName("debug-grid");
  if (grid) grid.visible = gridVisible;
  if (assetDebugGroup) assetDebugGroup.visible = assetDebugVisible && sceneState.activeScene === "outside";
}

function updateOpsPanel(): void {
  const businessEntities = deriveBusinessEntities(citizens, worldTime);
  const visible = citizens.filter((citizen) => citizen.currentScene === sceneState.activeScene && citizen.currentState !== "home" && citizen.currentState !== "off_district").length;
  const home = citizens.filter((citizen) => citizen.currentState === "home").length;
  const offDistrict = citizens.filter((citizen) => citizen.currentState === "off_district").length;
  const working = citizens.filter((citizen) => citizen.currentState === "working").length;
  const commuting = citizens.filter(
    (citizen) =>
      citizen.currentState === "walking_to_work" ||
      citizen.currentState === "walking_to_workstation" ||
      citizen.currentState === "leaving_building" ||
      citizen.currentState === "walking_home" ||
      citizen.currentState === "walking_to_destination"
  ).length;
  const visiting = citizens.filter((citizen) => citizen.currentState === "idle").length;
  const routingToGarage = citizens.filter((citizen) => citizen.currentState === "walking_to_destination").length;
  const socializing = citizens.filter((citizen) => citizen.currentSocialInteraction).length;
  const socialPairs = citizens.filter((citizen) => citizen.currentSocialInteraction).length / 2;
  const openBusinesses = businessEntities.filter((business) => business.operationalStatus !== "Closed").length;
  const closedBusinesses = businessEntities.length - openBusinesses;
  const operatingBusinesses = businessEntities.filter((business) => business.operationalStatus === "Operating").length;
  const understaffedBusinesses = businessEntities.filter((business) => business.staffingStatus === "understaffed").length;
  const openBusinessesWithoutWorkers = businessEntities.filter(
    (business) => business.operationalStatus !== "Closed" && business.employeesPresentCitizenIds.length === 0 && business.workersEnRouteCitizenIds.length === 0
  );
  const remotePlayerList = multiplayerDebug?.remotePlayers.length
    ? multiplayerDebug.remotePlayers.map((presence) => `${presence.displayName} / ${presence.currentScene} / ${presence.currentArea}`).join("<br>")
    : "None";
  opsSummary.textContent = `
    <p>Active District: ${DISTRICT_ID}</p>
    <h2>Multiplayer Debug</h2>
    <p>Supabase URL Configured: ${multiplayerDebug?.supabaseUrlConfigured ? "yes" : "no"}</p>
    <p>Supabase Anon Key Configured: ${multiplayerDebug?.supabaseAnonKeyConfigured ? "yes" : "no"}</p>
    <p>Current Mode: ${multiplayerDebug?.mode ?? "offline"}</p>
    <p>Channel Name: ${multiplayerDebug?.channelName ?? "stg-world-zero"}</p>
    <p>Channel Status: ${multiplayerDebug?.channelStatus ?? "unknown"}</p>
    <p>Subscribe Status: ${multiplayerDebug?.subscribeStatus ?? "unknown"}</p>
    <p>Last Error: ${multiplayerDebug?.lastError ?? "None"}</p>
    <p>Websocket Connected: ${multiplayerDebug?.websocketConnected ? "true" : "false"}</p>
    <p>Local Player ID: ${multiplayerDebug?.localPlayerId ?? "unknown"}</p>
    <p>Local Display Name: ${multiplayerDebug?.localDisplayName || playerProfile.displayName}</p>
    <p>Presence Count: ${multiplayerDebug?.presenceCount ?? 1}</p>
    <p>Remote Players Count: ${multiplayerDebug?.remotePlayersCount ?? remotePlayerRuntimes.size}</p>
    <p>Last Broadcast: ${multiplayerDebug?.lastBroadcastAt ? new Date(multiplayerDebug.lastBroadcastAt).toLocaleTimeString() : "None"}</p>
    <p>Last Presence Sync: ${multiplayerDebug?.lastPresenceSyncAt ? new Date(multiplayerDebug.lastPresenceSyncAt).toLocaleTimeString() : "None"}</p>
    <p>Remote Players: ${remotePlayerList}</p>
    <p>Agents: ${citizens.length} total / ${visible} visible</p>
    <p>Home: ${home} / Off District: ${offDistrict}</p>
    <p>Working: ${working} / Commuting: ${commuting}</p>
    <p>Visiting Interest Locations: ${visiting}</p>
    <p>Routing to Exit: ${routingToGarage}</p>
    <p>Socializing: ${socializing} / Conversations: ${socialPairs}</p>
    <p>Business Entities: ${businessEntities.length} total / ${openBusinesses} open / ${closedBusinesses} closed</p>
    <p>Operating: ${operatingBusinesses} / Understaffed Rosters: ${understaffedBusinesses}</p>
    <p>Open Without Workers Present/En Route: ${openBusinessesWithoutWorkers.length ? openBusinessesWithoutWorkers.map((business) => business.businessName).join(", ") : "None"}</p>
    <p>Door Transitions: ${citizenTransitionLog[0] ?? "None yet"}</p>
  `;

  const inspected = selectedCitizen ?? citizens.find((citizen) => citizen.currentState === "working") ?? citizens[0];
  const activeShift = getActiveShift(inspected, worldTime.absoluteMinutes);
  const topRelationships = Object.values(inspected.relationships)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 6)
    .map((relationship) => `${citizenName(relationship.citizenId)} ${relationship.score} (${relationship.label})`)
    .join(", ");
  const needs = inspected.needs;
  const knownRumors = knowledgeItemsForIds(inspected.knownRumorIds).map((item) => item.title);
  const privateKnowledge = knowledgeItemsForIds(inspected.privateKnowledgeIds).map((item) => item.title);
  const lastShared = inspected.lastSharedKnowledgeId ? getKnowledgeItem(inspected.lastSharedKnowledgeId)?.title ?? inspected.lastSharedKnowledgeId : "None";
  const social = inspected.currentSocialInteraction
    ? `${citizenName(inspected.currentSocialInteraction.partnerId)} / ${inspected.currentSocialInteraction.topic} / ${Math.max(0, Math.ceil(inspected.currentSocialInteraction.endsAtAbsoluteMinute - worldTime.absoluteMinutes))} min`
    : "None";
  citizenDetails.textContent = `
    <h2>Selected Agent</h2>
    <p>${inspected.name}</p>
    <p>Interests: ${inspected.interests.join(", ") || "None"}</p>
    <p>State: ${inspected.currentState}</p>
    <p>Job: ${activeShift?.role ?? inspected.role}</p>
    <p>Current Schedule Block: ${activeShift ? `${activeShift.role} at ${activeShift.businessId}` : "None"}</p>
    <p>Destination: ${inspected.currentDestination ?? "None"}</p>
    <p>Wallet: $${Math.round(inspected.wallet)}</p>
    <p>Schedule: ${inspected.schedule.map((shift) => `${shift.role} ${Math.floor(shift.startMinute / 60)}:00-${Math.floor(shift.endMinute / 60)}:00`).join(", ")}</p>
    <p>Workstation: ${inspected.currentWorkstationId ? workstationById(inspected.currentWorkstationId).name : "None"}</p>
    <p>Late: ${inspected.wasLateToday ? "Yes" : "No"} / Delay ${Math.floor(inspected.delayMinutes)} min</p>
    <p>Needs: Energy ${Math.round(needs.energy)} / Hunger ${Math.round(needs.hunger)} / Social ${Math.round(needs.social)} / Money Stress ${Math.round(needs.moneyStress)}</p>
    <p>Mood Reason: ${inspected.moodReason}</p>
    <p>Current Social: ${social}</p>
    <p>Relationships: ${topRelationships || "None"}</p>
    <p>Player Contact: ${playerProfile.knownCitizenIds.includes(inspected.id) ? "Known" : "Not in phone"} / Player Relationship ${relationshipForCitizen(playerProfile, inspected.id)} (${relationshipLabelForCitizen(playerProfile, inspected.id)})</p>
    <p>Known Agents: ${formatCitizenList(inspected.knownCitizens, 8)}</p>
    <p>Known Places: ${inspected.knownPlaces.join(", ") || "None"}</p>
    <p>Known Businesses: ${inspected.knownBusinesses.join(", ") || "None"}</p>
    <p>Known Knowledge: ${inspected.knownKnowledgeIds.length}</p>
    <p>Known Rumors: ${knownRumors.join(", ") || "None"}</p>
    <p>Private Knowledge: ${privateKnowledge.join(", ") || "None"}</p>
    <p>Last Shared: ${lastShared}</p>
    <p>Recent Received: ${inspected.recentKnowledgeReceived.join(", ") || "None"}</p>
    <p>Coworkers: ${formatCitizenList(inspected.coworkers, 8)}</p>
    <p>Friends: ${formatCitizenList(inspected.friends, 8)}</p>
    <p>Supervisor: ${inspected.supervisor ? citizenName(inspected.supervisor) : "None"}</p>
    <p>Subordinates: ${formatCitizenList(inspected.subordinates, 8)}</p>
  `;

  if (!selectedBusinessId || !businessEntities.some((business) => business.businessId === selectedBusinessId)) {
    selectedBusinessId = businessEntities[0]?.businessId ?? null;
  }
  const focusedBusiness = businessEntities.find((business) => business.businessId === selectedBusinessId) ?? businessEntities[0];
  const businessCards = businessEntities
    .map(
      (business) => `
        <button type="button" class="business-inspector-card ${business.businessId === focusedBusiness.businessId ? "active" : ""}" data-business-id="${business.businessId}">
          <strong>${business.businessName}</strong>
          <span>${business.businessType} / ${business.operationalStatus}</span>
          <span>${business.staffingStatus} / Missing: ${renderMissingStaff(business)}</span>
        </button>
      `
    )
    .join("");
  const managerName = focusedBusiness.managerCitizenId ? citizenName(focusedBusiness.managerCitizenId) : "None";
  citizenDetails.textContent += `
    <h2>Business Inspector</h2>
    <div id="business-inspector-list">${businessCards}</div>
    <section class="business-inspector-detail">
      <h3>${focusedBusiness.businessName}</h3>
      <p>Business Type: ${focusedBusiness.businessType}</p>
      <p>Manager: ${managerName}</p>
      <p>Owner Type: ${focusedBusiness.ownerType}</p>
      <p>Open Hours: ${formatBusinessHours(focusedBusiness.openHours)}</p>
      <p>Current Status: ${focusedBusiness.operationalStatus}</p>
      <p>Staffing Status: ${focusedBusiness.staffingStatus}</p>
      <p>Scheduled Staff: ${focusedBusiness.scheduledStaffCitizenIds.length}</p>
      <p>Present Staff: ${focusedBusiness.employeesPresentCitizenIds.length} / ${focusedBusiness.employeeCitizenIds.length}</p>
      <p>Workers En Route: ${focusedBusiness.workersEnRouteCitizenIds.length}</p>
      <p>Workers Home: ${focusedBusiness.workersHomeCitizenIds.length}</p>
      <p>Workers Off District: ${focusedBusiness.workersOffDistrictCitizenIds.length}</p>
      <p>Visitors Present: ${focusedBusiness.visitorsPresentCitizenIds.length}</p>
      <p>Required Staff: ${renderRequiredStaff(focusedBusiness)}</p>
      <p>Missing Staff: ${renderMissingStaff(focusedBusiness)}</p>
      <p>Reputation: ${focusedBusiness.reputation.toFixed(1)} / 5.0</p>
      <p>Capacity: ${focusedBusiness.capacity}</p>
      <p>Lease Space: ${focusedBusiness.leaseSpaceId ?? "None"}</p>
      <p>Allowed Types: ${focusedBusiness.allowedBusinessTypes.join(", ")}</p>
      <p>Workstations: ${focusedBusiness.workstationIds.join(", ")}</p>
      <p>Recent Door Logs: ${citizenTransitionLog.slice(0, 4).join("<br>") || "None yet"}</p>
    </section>
  `;
  for (const button of Array.from(citizenDetails.querySelectorAll<HTMLButtonElement>("[data-business-id]"))) {
    button.addEventListener("click", () => {
      selectedBusinessId = button.dataset.businessId ?? selectedBusinessId;
      updateOpsPanel();
    });
  }
  opsPanel.hidden = false;
}

function animate(): void {
  const now = performance.now();
  const realDelta = Math.min((now - lastFrameAt) / 1000, 2);
  lastFrameAt = now;
  const delta = Math.min(realDelta, 0.1);
  worldTime = getWorldTime();
  updateCitizenSchedules(realDelta, delta);
  updateCitizenMeshes();
  movePlayer(delta);
  updateRemotePlayers(delta);
  updateCamera(delta);
  updateBuildingOcclusion();
  updateSceneVisibility();
  updateNavigationContext();
  renderer.render(scene, camera);
  const businessHealth = deriveBusinessEntities(citizens, worldTime);
  window.__vibeCity3DHealth = {
    frames: (window.__vibeCity3DHealth?.frames ?? 0) + 1,
    buildings: buildingRuntimes.length,
    player: { x: Number(player.position.x.toFixed(2)), z: Number(player.position.z.toFixed(2)) },
    cameraMode: "Isometric",
    camera: {
      x: Number(camera.position.x.toFixed(2)),
      y: Number(camera.position.y.toFixed(2)),
      z: Number(camera.position.z.toFixed(2))
    },
    occlusion: occlusionEnabled,
    grid: gridVisible,
    assetDebug: assetDebugVisible,
    zoom: zoomLevelIndex + 1,
    seed: CITY_SEED,
    assets: generatedAssetCount,
    scene: sceneState.activeScene,
    citizensTotal: citizens.length,
    citizensVisible: citizens.filter((citizen) => citizen.currentScene === sceneState.activeScene && citizen.currentState !== "home" && citizen.currentState !== "off_district").length,
    citizensWorking: citizens.filter((citizen) => citizen.currentState === "working").length,
    citizensOffDistrict: citizens.filter((citizen) => citizen.currentState === "off_district").length,
    socialInteractions: citizens.filter((citizen) => citizen.currentSocialInteraction).length / 2,
    businessesTotal: businessHealth.length,
    businessesOperating: businessHealth.filter((business) => business.operationalStatus === "Operating").length,
    remotePlayers: remotePlayerRuntimes.size,
    multiplayerStatus: multiplayerHudStatus,
    multiplayerEnvConfigured: multiplayerDebug?.envConfigured ?? false,
    multiplayerPresenceCount: multiplayerDebug?.presenceCount ?? 1,
    multiplayerLastBroadcastAt: multiplayerDebug?.lastBroadcastAt ?? null,
    multiplayerLastPresenceSyncAt: multiplayerDebug?.lastPresenceSyncAt ?? null,
    multiplayerChannelName: multiplayerDebug?.channelName ?? "stg-world-zero",
    multiplayerSubscribeStatus: multiplayerDebug?.subscribeStatus ?? "unknown",
    multiplayerLastError: multiplayerDebug?.lastError ?? null,
    multiplayerWebsocketConnected: multiplayerDebug?.websocketConnected ?? false,
    openBusinessesWithoutWorkers: businessHealth.filter(
      (business) => business.operationalStatus !== "Closed" && business.employeesPresentCitizenIds.length === 0 && business.workersEnRouteCitizenIds.length === 0
    ).length,
    time: formatWorldTime(worldTime),
    triangles: renderer.info.render.triangles,
    realWorldTime: worldTime.realWorldTime,
    realWorldDate: worldTime.realWorldDate,
    timezone: worldTime.timezone,
    dayOfWeek: worldTime.dayOfWeek,
    vibeCityTimeMode: worldTime.vibeCityTimeMode,
    voiceState,
    agentVoiceEnabled,
    captionsEnabled,
    voiceVolumeSetting: Number(voiceVolumeSetting.toFixed(2)),
    playerDistanceToAgent: playerDistanceToAgent === null ? null : Number(playerDistanceToAgent.toFixed(2)),
    voiceVolume: Number(voiceVolume.toFixed(2)),
    voiceCaption: voiceCaptionText,
    currentAudioZone,
    agentAudioZone,
    voiceRoomAttenuation: Number(voiceRoomAttenuation.toFixed(2))
  };
  app.dataset.frames = `${window.__vibeCity3DHealth.frames}`;
  app.dataset.buildings = `${window.__vibeCity3DHealth.buildings}`;
  app.dataset.triangles = `${window.__vibeCity3DHealth.triangles}`;
  app.dataset.playerX = `${window.__vibeCity3DHealth.player.x}`;
  app.dataset.playerZ = `${window.__vibeCity3DHealth.player.z}`;
  app.dataset.cameraMode = window.__vibeCity3DHealth.cameraMode;
  app.dataset.cameraY = `${window.__vibeCity3DHealth.camera.y}`;
  app.dataset.occlusion = `${window.__vibeCity3DHealth.occlusion}`;
  app.dataset.grid = `${window.__vibeCity3DHealth.grid}`;
  app.dataset.assetDebug = `${window.__vibeCity3DHealth.assetDebug}`;
  app.dataset.zoom = `${window.__vibeCity3DHealth.zoom}`;
  app.dataset.seed = window.__vibeCity3DHealth.seed;
  app.dataset.assets = `${window.__vibeCity3DHealth.assets}`;
  app.dataset.scene = window.__vibeCity3DHealth.scene;
  app.dataset.citizensTotal = `${window.__vibeCity3DHealth.citizensTotal}`;
  app.dataset.citizensVisible = `${window.__vibeCity3DHealth.citizensVisible}`;
  app.dataset.citizensWorking = `${window.__vibeCity3DHealth.citizensWorking}`;
  app.dataset.citizensOffDistrict = `${window.__vibeCity3DHealth.citizensOffDistrict}`;
  app.dataset.socialInteractions = `${window.__vibeCity3DHealth.socialInteractions}`;
  app.dataset.businessesTotal = `${window.__vibeCity3DHealth.businessesTotal}`;
  app.dataset.businessesOperating = `${window.__vibeCity3DHealth.businessesOperating}`;
  app.dataset.remotePlayers = `${window.__vibeCity3DHealth.remotePlayers}`;
  app.dataset.multiplayerStatus = window.__vibeCity3DHealth.multiplayerStatus;
  app.dataset.multiplayerEnvConfigured = `${window.__vibeCity3DHealth.multiplayerEnvConfigured}`;
  app.dataset.multiplayerPresenceCount = `${window.__vibeCity3DHealth.multiplayerPresenceCount}`;
  app.dataset.multiplayerLastBroadcastAt = `${window.__vibeCity3DHealth.multiplayerLastBroadcastAt ?? ""}`;
  app.dataset.multiplayerLastPresenceSyncAt = `${window.__vibeCity3DHealth.multiplayerLastPresenceSyncAt ?? ""}`;
  app.dataset.multiplayerChannelName = window.__vibeCity3DHealth.multiplayerChannelName;
  app.dataset.multiplayerSubscribeStatus = window.__vibeCity3DHealth.multiplayerSubscribeStatus;
  app.dataset.multiplayerLastError = window.__vibeCity3DHealth.multiplayerLastError ?? "";
  app.dataset.multiplayerWebsocketConnected = `${window.__vibeCity3DHealth.multiplayerWebsocketConnected}`;
  app.dataset.openBusinessesWithoutWorkers = `${window.__vibeCity3DHealth.openBusinessesWithoutWorkers}`;
  app.dataset.realWorldTime = window.__vibeCity3DHealth.realWorldTime;
  app.dataset.realWorldDate = window.__vibeCity3DHealth.realWorldDate;
  app.dataset.timezone = window.__vibeCity3DHealth.timezone;
  app.dataset.dayOfWeek = window.__vibeCity3DHealth.dayOfWeek;
  app.dataset.vibeCityTimeMode = window.__vibeCity3DHealth.vibeCityTimeMode;
  app.dataset.voiceState = window.__vibeCity3DHealth.voiceState;
  app.dataset.agentVoiceEnabled = `${window.__vibeCity3DHealth.agentVoiceEnabled}`;
  app.dataset.captionsEnabled = `${window.__vibeCity3DHealth.captionsEnabled}`;
  app.dataset.voiceVolumeSetting = `${window.__vibeCity3DHealth.voiceVolumeSetting}`;
  app.dataset.playerDistanceToAgent = `${window.__vibeCity3DHealth.playerDistanceToAgent ?? ""}`;
  app.dataset.voiceVolume = `${window.__vibeCity3DHealth.voiceVolume}`;
  app.dataset.currentAudioZone = window.__vibeCity3DHealth.currentAudioZone;
  app.dataset.agentAudioZone = window.__vibeCity3DHealth.agentAudioZone ?? "";
  app.dataset.voiceRoomAttenuation = `${window.__vibeCity3DHealth.voiceRoomAttenuation}`;
  cameraModeLabel.textContent = "Isometric";
}

const kioskFrameInterval = 1000 / KIOSK_TARGET_FPS;
let lastKioskFrameAt = -kioskFrameInterval;

function renderLoop(now: number): void {
  requestAnimationFrame(renderLoop);
  if (kioskPerformanceMode && now - lastKioskFrameAt < kioskFrameInterval) return;
  lastKioskFrameAt = now;
  animate();
}

requestAnimationFrame(renderLoop);

function handleKeyDown(event: KeyboardEvent): void {
  const code = event.code.toLowerCase();
  if (!cityEntered || recordsTerminalDialog.open || operationsDirectoryDialog.open) return;
  keys.add(code);

  if (event.repeat) return;

  if (code === "keye") handleNavigationAction();

  if (code === "keyc" && performance.now() - lastZoomCycleAt > 180) {
    zoomLevelIndex = (zoomLevelIndex + 1) % ZOOM_LEVELS.length;
    updateCameraProjection();
    lastZoomCycleAt = performance.now();
  }

  if (performance.now() - lastDebugToggleAt <= 120) return;
  if (code === "keyo") {
    occlusionEnabled = !occlusionEnabled;
    lastDebugToggleAt = performance.now();
  }
  if (code === "keyg") {
    gridVisible = !gridVisible;
    lastDebugToggleAt = performance.now();
  }
  if (code === "keyb") {
    assetDebugVisible = !assetDebugVisible;
    lastDebugToggleAt = performance.now();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  keys.delete(event.code.toLowerCase());
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
document.addEventListener("keydown", (event) => {
  if (event.target === document.body) handleKeyDown(event);
});
document.addEventListener("keyup", handleKeyUp);
document.addEventListener("focusin", updateTouchControlVisibility);
document.addEventListener("focusout", () => {
  window.setTimeout(updateTouchControlVisibility, 0);
});

window.addEventListener("resize", () => {
  updateCameraProjection();
  updateTouchControlVisibility();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("beforeunload", () => {
  presenceAdapter.dispose();
});

updateTouchControlVisibility();
