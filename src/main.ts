import * as THREE from "three";
import "./styles.css";
import { BusinessEntity, deriveBusinessEntities } from "./businessSystem";
import { Citizen, adjustRelationship, createCitizens, persistCitizenSocial } from "./citizenData";
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
  seedCitizenKnowledge,
  shareKnowledge
} from "./knowledgeSystem";
import { PlayerPresence, PresenceDebugState, createPresenceAdapter } from "./multiplayer/presence";
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
import { CITY_SEED, generateCity } from "./world/cityGenerator";
import { WorldTimeState, advanceWorldHours, advanceWorldToNextDay, formatWorldTime, getWorldTime } from "./worldTime";

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
  | "enter_bar_a"
  | "leave_bar_a"
  | "enter_bar_b"
  | "leave_bar_b"
  | "enter_sports_bar"
  | "leave_sports_bar"
  | "enter_casino"
  | "leave_casino"
  | "enter_restaurant"
  | "leave_restaurant"
  | "enter_book_shop"
  | "leave_book_shop"
  | "enter_music_venue"
  | "leave_music_venue"
  | "enter_parking_garage"
  | "leave_parking_garage"
  | "enter_apartment"
  | "leave_apartment";
type HomeAction = "rest" | "profile" | "customize";

const PLAYER_RADIUS = 0.55;
const PLAYER_SPEED = 8.2;
const NPC_WALK_SPEED = 5.4;
const DOOR_APPROACH_DISTANCE = 2.35;
const ISO_CAMERA_OFFSET = new THREE.Vector3(24, 24, 24);
const ISO_FORWARD = new THREE.Vector3(0, 0, -1).normalize();
const ISO_RIGHT = new THREE.Vector3(1, 0, 0).normalize();
const ZOOM_LEVELS = [24, 30, 38];

const app = document.querySelector<HTMLDivElement>("#app")!;
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
const fadeOverlay = document.querySelector<HTMLDivElement>("#fade-overlay")!;
const popup = document.querySelector<HTMLElement>("#interaction-popup")!;
const popupClose = document.querySelector<HTMLButtonElement>("#interaction-close")!;
const popupLeave = document.querySelector<HTMLButtonElement>("#interaction-leave")!;
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
const touchPhoneButton = document.querySelector<HTMLButtonElement>("#touch-phone")!;
const touchDebugButton = document.querySelector<HTMLButtonElement>("#touch-debug")!;

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
      openBusinessesWithoutWorkers: number;
      time: string;
      triangles: number;
    };
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x92a8b7);
scene.fog = new THREE.Fog(0x92a8b7, 42, 76);

const camera = new THREE.OrthographicCamera(-24, 24, 13.5, -13.5, 0.1, 160);
camera.position.copy(ISO_CAMERA_OFFSET);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.append(renderer.domElement);

const sceneState = createSceneState();
const outsideGroup = new THREE.Group();
const barAGroup = new THREE.Group();
const barBGroup = new THREE.Group();
const sportsBarGroup = new THREE.Group();
const casinoGroup = new THREE.Group();
const restaurantGroup = new THREE.Group();
const bookShopGroup = new THREE.Group();
const musicVenueGroup = new THREE.Group();
const parkingGarageGroup = new THREE.Group();
const apartmentGroup = new THREE.Group();
scene.add(outsideGroup, barAGroup, barBGroup, sportsBarGroup, casinoGroup, restaurantGroup, bookShopGroup, musicVenueGroup, parkingGarageGroup, apartmentGroup);

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
const barAColliders: Collider[] = [];
const barBColliders: Collider[] = [];
const sportsBarColliders: Collider[] = [];
const casinoColliders: Collider[] = [];
const restaurantColliders: Collider[] = [];
const bookShopColliders: Collider[] = [];
const musicVenueColliders: Collider[] = [];
const parkingGarageColliders: Collider[] = [];
const apartmentColliders: Collider[] = [];
const buildingRuntimes: WorldBuildingRuntime[] = [];
const citizenRuntimes: CitizenRuntime[] = [];
const keys = new Set<string>();
const playerVelocity = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const touchMoveInput = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const citizens = createCitizens();
seedCitizenKnowledge(citizens);
let playerProfile: PlayerProfile = loadPlayerProfile() ?? createDefaultPlayerProfile();
if (loadPlayerProfile()) characterModal.hidden = true;
const presenceAdapter = createPresenceAdapter();
const remotePlayerRuntimes = new Map<string, RemotePlayerRuntime>();
let multiplayerHudStatus = "Offline / Missing Env";
let multiplayerDebug: PresenceDebugState | null = null;
const socialTopics = ["work", "sports", "music", "casino", "books", "food", "nightlife", "gossip", "commute"];
let worldTime: WorldTimeState = getWorldTime();
initializeCitizenSimulationForCurrentTime();
let occlusionEnabled = true;
let gridVisible = false;
let zoomLevelIndex = 1;
let lastZoomCycleAt = 0;
let lastDebugToggleAt = 0;
let nearbyCitizen: Citizen | null = null;
let activeDoorAction: DoorAction | null = null;
let activeHomeAction: HomeAction | null = null;
let activeInteractionCitizen: Citizen | null = null;
let activeSharedKnowledge: KnowledgeItem | null = null;
let activeJournalTab: "contacts" | "citizen" | "place" | "business" | "rumor" = "contacts";
let activePhoneApp: "contacts" | "messages" | "knowledge" | "profile" | "map" | "debug" = "contacts";
let contactAddedMessage = "";
let toastTimeout: number | null = null;
let selectedCitizen: Citizen | null = null;
let selectedBusinessId: string | null = null;
let lastFrameAt = performance.now();
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
const apartmentPortal = portalById("apartment-main");
const barAPortal = portalById("bar-a-main");
const barBPortal = portalById("bar-b-main");
const sportsBarPortal = portalById("sports-bar-main");
const casinoPortal = portalById("casino-main");
const restaurantPortal = portalById("restaurant-main");
const bookShopPortal = portalById("book-shop-main");
const musicVenuePortal = portalById("music-venue-main");
const parkingGaragePortal = portalById("parking-garage-main");

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

function createLabelSprite(text: string, width = 512, height = 128, fontSize = 42): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
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

function buildBarInterior(): void {
  barAGroup.visible = false;
  addPlaneBox(barAGroup, 18, 16, 0.12, 0, 0, new THREE.MeshStandardMaterial({ color: 0x3b3230, roughness: 0.9 }));
  addBox(barAGroup, 18, 1.5, 0.9, 0, 0, -8, new THREE.MeshStandardMaterial({ color: 0x201b1a, roughness: 0.75 }));
  addBox(barAGroup, 18, 1.5, 0.9, 0, 0, 8, new THREE.MeshStandardMaterial({ color: 0x201b1a, roughness: 0.75 }));
  addBox(barAGroup, 0.9, 1.5, 16, -9, 0, 0, new THREE.MeshStandardMaterial({ color: 0x201b1a, roughness: 0.75 }));
  addBox(barAGroup, 0.9, 1.5, 16, 9, 0, 0, new THREE.MeshStandardMaterial({ color: 0x201b1a, roughness: 0.75 }));
  addBox(barAGroup, 11, 1.1, 1.6, 0, 0, -4.5, new THREE.MeshStandardMaterial({ color: 0x7d523a, roughness: 0.65 }));
  addBox(barAGroup, 11, 0.45, 2.2, 0, 1.1, -4.5, new THREE.MeshStandardMaterial({ color: 0x2a1711, roughness: 0.6 }));
  addBox(barAGroup, 4.4, 1, 2.2, 5.8, 0, -5.2, new THREE.MeshStandardMaterial({ color: 0x4f3b34, roughness: 0.72 }));
  addCollider(barAColliders, 0, -8, 18, 0.9);
  addCollider(barAColliders, 0, 8, 18, 0.9);
  addCollider(barAColliders, -9, 0, 0.9, 16);
  addCollider(barAColliders, 9, 0, 0.9, 16);
  addCollider(barAColliders, 0, -4.5, 11, 2.2);

  const stoolMaterial = new THREE.MeshStandardMaterial({ color: 0xc5965b, roughness: 0.75 });
  for (let x = -4; x <= 4; x += 2) {
    addBox(barAGroup, 0.7, 0.7, 0.7, x, 0, -2.6, stoolMaterial);
  }

  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4533, roughness: 0.72 });
  for (const [x, z] of [[-4.5, 2.8], [4.5, 2.8], [0, 4.8]]) {
    addBox(barAGroup, 1.6, 0.65, 1.6, x, 0, z, tableMaterial);
  }

  const exitPad = addPlaneBox(barAGroup, 3.5, 1.8, 0.14, barAPortal.interiorPosition.x, barAPortal.interiorPosition.z, entryPadMaterial);
  exitPad.name = "bar-exit-pad";
  const label = createLabelSprite("Exit", 256, 96, 36);
  label.position.set(barAPortal.interiorPosition.x, 2.2, barAPortal.interiorPosition.z);
  label.scale.set(3.2, 1.2, 1);
  barAGroup.add(label);
}

function buildVenueInterior(
  group: THREE.Group,
  colliders: Collider[],
  portal: typeof barAPortal,
  titleText: string,
  theme: number,
  options: { bar?: boolean; restaurant?: boolean; books?: boolean; music?: boolean; sports?: boolean; garage?: boolean }
): void {
  group.visible = false;
  const floorMaterial = new THREE.MeshStandardMaterial({ color: theme, roughness: 0.88 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2328, roughness: 0.74 });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x6f4c35, roughness: 0.72 });
  addPlaneBox(group, 18, 16, 0.12, 0, 0, floorMaterial);
  addBox(group, 18, 1.5, 0.9, 0, 0, -8, wallMaterial);
  addBox(group, 18, 1.5, 0.9, 0, 0, 8, wallMaterial);
  addBox(group, 0.9, 1.5, 16, -9, 0, 0, wallMaterial);
  addBox(group, 0.9, 1.5, 16, 9, 0, 0, wallMaterial);
  addCollider(colliders, 0, -8, 18, 0.9);
  addCollider(colliders, 0, 8, 18, 0.9);
  addCollider(colliders, -9, 0, 0.9, 16);
  addCollider(colliders, 9, 0, 0.9, 16);

  if (options.bar || options.sports || options.music) {
    addBox(group, 11, 1.1, 1.6, 0, 0, -4.5, woodMaterial);
    addBox(group, 11, 0.45, 2.2, 0, 1.1, -4.5, new THREE.MeshStandardMaterial({ color: 0x2a1711, roughness: 0.6 }));
    addCollider(colliders, 0, -4.5, 11, 2.2);
    for (let x = -4; x <= 4; x += 2) addBox(group, 0.7, 0.7, 0.7, x, 0, -2.6, new THREE.MeshStandardMaterial({ color: 0xc5965b, roughness: 0.75 }));
  }

  if (options.restaurant) {
    addBox(group, 5.8, 1, 2.2, 4.2, 0, -4.5, new THREE.MeshStandardMaterial({ color: 0x4f5e48, roughness: 0.76 }));
    addBox(group, 2.2, 1, 1.2, -4.2, 0, 4.6, woodMaterial);
    addCollider(colliders, 4.2, -4.5, 5.8, 2.2);
  }

  if (options.books) {
    for (let x = -5.5; x <= 5.5; x += 3.6) addBox(group, 1.1, 1.9, 7.5, x, 0, -1.3, new THREE.MeshStandardMaterial({ color: 0x5b3f2d, roughness: 0.8 }));
    addBox(group, 4.2, 1, 1.4, -4, 0, -5.2, woodMaterial);
  }

  if (options.music) {
    addBox(group, 7, 0.8, 2.2, 1.8, 0, -5.5, new THREE.MeshStandardMaterial({ color: 0x2e2a46, roughness: 0.72 }));
    addBox(group, 2.8, 1.1, 1.8, -5, 0, 2.6, new THREE.MeshStandardMaterial({ color: 0x36445f, roughness: 0.72 }));
  }

  if (options.sports) {
    for (const [x, z] of [[-5.8, 1.4], [0, 2.8], [5.8, 1.4]] as const) addBox(group, 1.8, 0.7, 1.8, x, 0, z, woodMaterial);
    for (const x of [-5.5, 0, 5.5]) {
      addBox(group, 2.2, 1.1, 0.22, x, 1.5, -7.45, new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.35 }));
      const tv = createLabelSprite("TV", 128, 64, 30);
      tv.position.set(x, 2.35, -7.2);
      tv.scale.set(1.5, 0.7, 1);
      group.add(tv);
    }
  }

  if (options.garage) {
    for (let x = -5; x <= 5; x += 5) addBox(group, 2.8, 0.45, 4.8, x, 0, 0.6, new THREE.MeshStandardMaterial({ color: 0x4d5962, roughness: 0.68 }));
    addBox(group, 4, 1.1, 2, -3.8, 0, -3.2, new THREE.MeshStandardMaterial({ color: 0x3e4b54, roughness: 0.7 }));
    const portalLabel = createLabelSprite("Off-District Portal", 512, 96, 30);
    portalLabel.position.set(0, 2.25, -5.8);
    portalLabel.scale.set(4.2, 1, 1);
    group.add(portalLabel);
  }

  for (const [x, z] of [[-4.5, 2.8], [4.5, 2.8], [0, 4.8]] as const) addBox(group, 1.6, 0.65, 1.6, x, 0, z, woodMaterial);

  const title = createLabelSprite(titleText, 512, 128, 42);
  title.position.set(0, 2.8, -0.8);
  title.scale.set(6, 1.5, 1);
  group.add(title);

  addPlaneBox(group, 3.5, 1.8, 0.14, portal.interiorPosition.x, portal.interiorPosition.z, entryPadMaterial);
  const exitLabel = createLabelSprite("Exit", 256, 96, 36);
  exitLabel.position.set(portal.interiorPosition.x, 2.2, portal.interiorPosition.z);
  exitLabel.scale.set(3.2, 1.2, 1);
  group.add(exitLabel);
}

function buildCasinoInterior(): void {
  casinoGroup.visible = false;
  const floor = new THREE.MeshStandardMaterial({ color: 0x29313a, roughness: 0.88 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.72 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x1f6f55, roughness: 0.7 });
  const slot = new THREE.MeshStandardMaterial({ color: 0x8d7d3f, roughness: 0.55 });
  addPlaneBox(casinoGroup, 26, 28, 0.12, 0, 0, floor);
  addBox(casinoGroup, 26, 1.6, 0.9, 0, 0, -14, wall);
  addBox(casinoGroup, 26, 1.6, 0.9, 0, 0, 14, wall);
  addBox(casinoGroup, 0.9, 1.6, 28, -13, 0, 0, wall);
  addBox(casinoGroup, 0.9, 1.6, 28, 13, 0, 0, wall);
  addCollider(casinoColliders, 0, -14, 26, 0.9);
  addCollider(casinoColliders, 0, 14, 26, 0.9);
  addCollider(casinoColliders, -13, 0, 0.9, 28);
  addCollider(casinoColliders, 13, 0, 0.9, 28);

  addBox(casinoGroup, 3.8, 0.8, 2.2, -4.8, 0, 0.8, felt);
  addBox(casinoGroup, 3.8, 0.8, 2.2, 0, 0, 0.8, felt);
  addBox(casinoGroup, 3.8, 0.8, 2.2, 4.8, 0, 0.8, felt);
  for (let x = -8; x <= -4; x += 2) {
    for (let z = 4.2; z <= 7.2; z += 1.5) {
      addBox(casinoGroup, 0.9, 1.1, 0.7, x, 0, z, slot);
    }
  }
  addBox(casinoGroup, 4.4, 1.2, 1.1, 8.4, 0, 4.5, new THREE.MeshStandardMaterial({ color: 0x435066, roughness: 0.65 }));
  addBox(casinoGroup, 4.6, 1.2, 3, -8.8, 0, -8.5, new THREE.MeshStandardMaterial({ color: 0x283c55, roughness: 0.7 }));
  addBox(casinoGroup, 4.6, 1.2, 3, 8.2, 0, -8.2, new THREE.MeshStandardMaterial({ color: 0x4c3f57, roughness: 0.7 }));
  addBox(casinoGroup, 8, 0.8, 2.2, 0, 0, -9, new THREE.MeshStandardMaterial({ color: 0x6c4d35, roughness: 0.7 }));
  for (const [text, x, z] of [
    ["Blackjack", -4.8, 2.6],
    ["Roulette", 0, 2.6],
    ["Three Card", 4.8, 2.6],
    ["Slots", -6.4, 8.4],
    ["Cage", 8.4, 6.4],
    ["Restaurant Lease", 0, -11.3],
    ["Surveillance", -8.8, -11],
    ["Break Room", 8.2, -10.7]
  ] as const) {
    const label = createLabelSprite(text, 384, 96, 28);
    label.position.set(x, 2.3, z);
    label.scale.set(3.6, 1, 1);
    casinoGroup.add(label);
  }
  const exitPad = addPlaneBox(casinoGroup, 4.2, 1.8, 0.14, casinoPortal.interiorPosition.x, casinoPortal.interiorPosition.z, entryPadMaterial);
  exitPad.name = "casino-exit-pad";
  const label = createLabelSprite("Exit", 256, 96, 36);
  label.position.set(casinoPortal.interiorPosition.x, 2.2, casinoPortal.interiorPosition.z);
  label.scale.set(3.2, 1.2, 1);
  casinoGroup.add(label);
}

function buildApartmentInterior(): void {
  apartmentGroup.visible = false;
  addPlaneBox(apartmentGroup, 14, 12, 0.12, 0, 0, new THREE.MeshStandardMaterial({ color: 0x566476, roughness: 0.86 }));
  addBox(apartmentGroup, 14, 1.3, 0.8, 0, 0, -6, new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.7 }));
  addBox(apartmentGroup, 14, 1.3, 0.8, 0, 0, 6, new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.7 }));
  addBox(apartmentGroup, 0.8, 1.3, 12, -7, 0, 0, new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.7 }));
  addBox(apartmentGroup, 0.8, 1.3, 12, 7, 0, 0, new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.7 }));
  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x344d77, roughness: 0.82 });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x7b573c, roughness: 0.74 });
  const fabricMaterial = new THREE.MeshStandardMaterial({ color: 0x8e5f68, roughness: 0.8 });
  const kitchenMaterial = new THREE.MeshStandardMaterial({ color: 0x596f6c, roughness: 0.7 });
  addBox(apartmentGroup, 4.1, 0.55, 2.4, -4.2, 0, -3.8, bedMaterial);
  addBox(apartmentGroup, 1.2, 0.28, 2.3, -5.55, 0.55, -3.8, new THREE.MeshStandardMaterial({ color: 0xd7d0bd, roughness: 0.78 }));
  addBox(apartmentGroup, 2.4, 0.75, 1.2, 3.9, 0, -3.8, woodMaterial);
  addBox(apartmentGroup, 0.65, 0.9, 0.65, 3.9, 0, -2.55, new THREE.MeshStandardMaterial({ color: 0x3d4656, roughness: 0.78 }));
  addBox(apartmentGroup, 3.5, 0.75, 1.35, -3.8, 0, 1.4, fabricMaterial);
  addBox(apartmentGroup, 1.1, 0.8, 1.35, -5.55, 0, 1.4, fabricMaterial);
  addBox(apartmentGroup, 3.8, 0.85, 1.1, 3.9, 0, 2.4, kitchenMaterial);
  addBox(apartmentGroup, 1.3, 0.65, 1.1, 5.4, 0.85, 2.4, new THREE.MeshStandardMaterial({ color: 0xb8c4c0, roughness: 0.45 }));
  addBox(apartmentGroup, 1.6, 1.8, 0.9, 5.4, 0, -4.4, new THREE.MeshStandardMaterial({ color: 0x4a3342, roughness: 0.78 }));
  addCollider(apartmentColliders, 0, -6, 14, 0.8);
  addCollider(apartmentColliders, 0, 6, 14, 0.8);
  addCollider(apartmentColliders, -7, 0, 0.8, 12);
  addCollider(apartmentColliders, 7, 0, 0.8, 12);
  addCollider(apartmentColliders, -4.2, -3.8, 4.1, 2.4);
  addCollider(apartmentColliders, 3.9, -3.8, 2.4, 1.2);
  addCollider(apartmentColliders, -3.8, 1.4, 3.5, 1.35);
  addCollider(apartmentColliders, 3.9, 2.4, 3.8, 1.1);
  addCollider(apartmentColliders, 5.4, -4.4, 1.6, 0.9);
  const title = createLabelSprite("Your Apartment", 512, 128, 42);
  title.position.set(0, 2.8, -2.8);
  title.scale.set(6, 1.5, 1);
  apartmentGroup.add(title);
  for (const [text, x, z] of [
    ["Rest", -4.2, -2],
    ["Profile", 3.9, -1.6],
    ["Kitchen", 3.9, 4],
    ["Closet", 5.4, -2.8],
    ["Door", 0, 4.3]
  ] as const) {
    const label = createLabelSprite(text, 256, 96, 30);
    label.position.set(x, 2.1, z);
    label.scale.set(2.7, 1, 1);
    apartmentGroup.add(label);
  }
  addPlaneBox(apartmentGroup, 3.5, 1.8, 0.14, apartmentPortal.interiorPosition.x, apartmentPortal.interiorPosition.z, entryPadMaterial);
}

buildOutsideMap();
buildBarInterior();
buildVenueInterior(barBGroup, barBColliders, barBPortal, "Bar B", 0x44334c, { bar: true });
buildVenueInterior(sportsBarGroup, sportsBarColliders, sportsBarPortal, "Sports Bar", 0x263b4f, { sports: true, bar: true });
buildCasinoInterior();
buildVenueInterior(restaurantGroup, restaurantColliders, restaurantPortal, "Standalone Restaurant", 0x354d3e, { restaurant: true });
buildVenueInterior(bookShopGroup, bookShopColliders, bookShopPortal, "Book Shop", 0x493a2f, { books: true });
buildVenueInterior(musicVenueGroup, musicVenueColliders, musicVenuePortal, "Music Venue", 0x29344f, { music: true, bar: true });
buildVenueInterior(parkingGarageGroup, parkingGarageColliders, parkingGaragePortal, "Parking Garage", 0x353f47, { garage: true });
buildApartmentInterior();

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
const playerName = createLabelSprite("You", 256, 96, 34);
playerName.position.y = 3.25;
playerName.scale.set(2.6, 1, 1);
playerName.renderOrder = 11;
player.add(body, head, playerRing, playerName);
player.position.set(apartmentPortal.exteriorPosition.x, 0, apartmentPortal.exteriorPosition.z + 1.2);
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
  if (sceneState.activeScene === "barA") return barAColliders;
  if (sceneState.activeScene === "barB") return barBColliders;
  if (sceneState.activeScene === "sportsBar") return sportsBarColliders;
  if (sceneState.activeScene === "casino") return casinoColliders;
  if (sceneState.activeScene === "restaurant") return restaurantColliders;
  if (sceneState.activeScene === "bookShop") return bookShopColliders;
  if (sceneState.activeScene === "musicVenue") return musicVenueColliders;
  if (sceneState.activeScene === "parkingGarage") return parkingGarageColliders;
  if (sceneState.activeScene === "apartment") return apartmentColliders;
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
  if (citizen.currentState === "working" && (citizen.role.includes("Dealer") || citizen.role.includes("Bartender"))) return `Hey ${playerProfile.displayName}, I'm working right now.`;
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
      journalList.innerHTML = "<p>No contacts yet. Talk to citizens to add them.</p>";
      return;
    }

    journalList.innerHTML = playerProfile.knownCitizenIds
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
    journalList.innerHTML = `<p>No ${activeJournalTab === "citizen" ? "people" : `${activeJournalTab}s`} discovered yet.</p>`;
    return;
  }

  journalList.innerHTML = items
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
    phoneContent.innerHTML = playerProfile.knownCitizenIds.length
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
    phoneContent.innerHTML = playerProfile.messages.length
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
    phoneContent.innerHTML = `${section("People", "citizen")}${section("Places", "place")}${section("Businesses", "business")}${section("Rumors", "rumor")}`;
    return;
  }

  if (activePhoneApp === "profile") {
    phoneContent.innerHTML = `
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
    phoneContent.innerHTML = `
      <article class="phone-card">
        <h3>${DISTRICT_NAME}</h3>
        <p>Current area: ${currentArea.textContent}</p>
        <p>Parking Garage connects District 1 to future districts. Off-district citizens enter and leave through it.</p>
      </article>
      ${businessEntities.map((business) => `<article class="phone-card"><strong>${business.businessName}</strong><p>${business.businessType} / ${business.operationalStatus}</p><p>Reputation ${business.reputation.toFixed(1)} / Staff ${business.staffingStatus}</p></article>`).join("")}
    `;
    return;
  }

  phoneContent.innerHTML = `<article class="phone-card">${opsSummary.innerHTML}<p>Selected: ${(selectedCitizen ?? citizens[0]).name}</p></article>`;
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
  const blockingPanelOpen = !phonePanel.hidden || !journalModal.hidden || !homePanel.hidden || !popup.hidden || !characterModal.hidden;
  const shouldShow = shouldShowTouchControls() && !typing && !blockingPanelOpen;
  touchControls.classList.toggle("visible", shouldShow);
  if (!shouldShow) resetJoystick();
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
  homeTitle.textContent = "Your Apartment";
  homeContent.innerHTML = `
    <p>Player: ${playerProfile.displayName}</p>
    <p>Wallet: $${Math.round(playerProfile.wallet)}</p>
    <p>Reputation: ${playerProfile.reputationStars.toFixed(1)}</p>
    <p>Influence: ${Math.round(playerProfile.influence)}</p>
    <p>Contacts: ${playerProfile.knownCitizenIds.length}</p>
    <p>Known Knowledge: ${playerProfile.knowledgeJournal.length}</p>
    <p>Home: Apartment</p>
  `;
  homePanel.hidden = false;
}

async function restAtHome(): Promise<void> {
  await fadeToScene(sceneState, fadeOverlay, "apartment", () => {
    worldTime = advanceWorldHours(1);
  });
  showToast("You rested for an hour.");
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

function doorApproachPoint(portal: typeof barAPortal): { x: number; z: number } {
  if (portal.facingDirection === "south") return { x: portal.exteriorPosition.x, z: portal.exteriorPosition.z + DOOR_APPROACH_DISTANCE };
  if (portal.facingDirection === "north") return { x: portal.exteriorPosition.x, z: portal.exteriorPosition.z - DOOR_APPROACH_DISTANCE };
  if (portal.facingDirection === "east") return { x: portal.exteriorPosition.x + DOOR_APPROACH_DISTANCE, z: portal.exteriorPosition.z };
  return { x: portal.exteriorPosition.x - DOOR_APPROACH_DISTANCE, z: portal.exteriorPosition.z };
}

function routeCitizenToExteriorDoor(citizen: Citizen, portal: typeof barAPortal): void {
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

  const step = Math.min(distance, NPC_WALK_SPEED * delta);
  citizen.position.x += (dx / distance) * step;
  citizen.position.z += (dz / distance) * step;
  return false;
}

function updateDealerRotation(): void {
  const rotationMinute = Math.floor(worldTime.absoluteMinutes / 30);
  const dealerStations = ["blackjack-table", "roulette-table", "three-card-poker-table", "dealer-break-room"];
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
      } else if (citizen.role.includes("Security")) {
        patrolCitizen(citizen, ["security-entrance", "security-slot-floor", "casino-restaurant-host"].map(workstationById), movementDelta);
      } else if (citizen.role.includes("Maintenance")) {
        patrolCitizen(citizen, ["maintenance-route", "cage-window-1", "dealer-break-room"].map(workstationById), movementDelta);
      } else if (citizen.role.includes("Cocktail")) {
        patrolCitizen(citizen, ["cocktail-floor", "blackjack-table", "roulette-table", "three-card-poker-table"].map(workstationById), movementDelta);
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
  if (!popup.hidden || !homePanel.hidden || !journalModal.hidden || !phonePanel.hidden || sceneState.transitioning) {
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
  barAGroup.visible = sceneState.activeScene === "barA";
  barBGroup.visible = sceneState.activeScene === "barB";
  sportsBarGroup.visible = sceneState.activeScene === "sportsBar";
  casinoGroup.visible = sceneState.activeScene === "casino";
  restaurantGroup.visible = sceneState.activeScene === "restaurant";
  bookShopGroup.visible = sceneState.activeScene === "bookShop";
  musicVenueGroup.visible = sceneState.activeScene === "musicVenue";
  parkingGarageGroup.visible = sceneState.activeScene === "parkingGarage";
  apartmentGroup.visible = sceneState.activeScene === "apartment";
}

function updatePrompts(): void {
  nearbyCitizen = null;
  activeDoorAction = null;
  activeHomeAction = null;
  const playerPoint = { x: player.position.x, z: player.position.z };

  for (const citizen of citizens) {
    if (citizen.currentScene !== sceneState.activeScene || citizen.currentState === "home" || citizen.currentState === "off_district") continue;
    if (distance2D(playerPoint, citizen.position) < 2.2) {
      nearbyCitizen = citizen;
      selectedCitizen = citizen;
      break;
    }
  }

  if (sceneState.activeScene === "outside") {
    if (distance2D(playerPoint, barAPortal.exteriorPosition) < 2.6) activeDoorAction = "enter_bar_a";
    if (distance2D(playerPoint, barBPortal.exteriorPosition) < 2.6) activeDoorAction = "enter_bar_b";
    if (distance2D(playerPoint, sportsBarPortal.exteriorPosition) < 2.8) activeDoorAction = "enter_sports_bar";
    if (distance2D(playerPoint, casinoPortal.exteriorPosition) < 3) activeDoorAction = "enter_casino";
    if (distance2D(playerPoint, restaurantPortal.exteriorPosition) < 2.8) activeDoorAction = "enter_restaurant";
    if (distance2D(playerPoint, bookShopPortal.exteriorPosition) < 2.6) activeDoorAction = "enter_book_shop";
    if (distance2D(playerPoint, musicVenuePortal.exteriorPosition) < 2.8) activeDoorAction = "enter_music_venue";
    if (distance2D(playerPoint, parkingGaragePortal.exteriorPosition) < 3.2) activeDoorAction = "enter_parking_garage";
    if (distance2D(playerPoint, apartmentPortal.exteriorPosition) < 2.8) activeDoorAction = "enter_apartment";
  } else if (sceneState.activeScene === "barA" && distance2D(playerPoint, barAPortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_bar_a";
  } else if (sceneState.activeScene === "barB" && distance2D(playerPoint, barBPortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_bar_b";
  } else if (sceneState.activeScene === "sportsBar" && distance2D(playerPoint, sportsBarPortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_sports_bar";
  } else if (sceneState.activeScene === "casino" && distance2D(playerPoint, casinoPortal.interiorPosition) < 2.7) {
    activeDoorAction = "leave_casino";
  } else if (sceneState.activeScene === "restaurant" && distance2D(playerPoint, restaurantPortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_restaurant";
  } else if (sceneState.activeScene === "bookShop" && distance2D(playerPoint, bookShopPortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_book_shop";
  } else if (sceneState.activeScene === "musicVenue" && distance2D(playerPoint, musicVenuePortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_music_venue";
  } else if (sceneState.activeScene === "parkingGarage" && distance2D(playerPoint, parkingGaragePortal.interiorPosition) < 2.4) {
    activeDoorAction = "leave_parking_garage";
  } else if (sceneState.activeScene === "apartment") {
    if (distance2D(playerPoint, { x: -4.2, z: -2.1 }) < 2) activeHomeAction = "rest";
    if (distance2D(playerPoint, { x: 3.9, z: -2.0 }) < 2) activeHomeAction = "profile";
    if (distance2D(playerPoint, { x: 5.4, z: -2.8 }) < 1.9) activeHomeAction = "customize";
    if (distance2D(playerPoint, apartmentPortal.interiorPosition) < 2.4) activeDoorAction = "leave_apartment";
  }

  if (!popup.hidden || sceneState.transitioning) {
    actionPrompt.hidden = true;
    return;
  }

  if (nearbyCitizen) {
    actionPrompt.textContent = `[E] Talk to ${nearbyCitizen.name}`;
    actionPrompt.hidden = false;
    return;
  }

  const homeLabels: Record<HomeAction, string> = {
    rest: "[E] Rest",
    profile: "[E] Check Profile",
    customize: "[E] Customize Character Coming Soon"
  };

  if (activeHomeAction) {
    actionPrompt.textContent = homeLabels[activeHomeAction];
    actionPrompt.hidden = false;
    return;
  }

  const labels: Record<DoorAction, string> = {
    enter_bar_a: "[E] Enter Bar A",
    leave_bar_a: "[E] Leave Bar A",
    enter_bar_b: "[E] Enter Bar B",
    leave_bar_b: "[E] Leave Bar B",
    enter_sports_bar: "[E] Enter Sports Bar",
    leave_sports_bar: "[E] Leave Sports Bar",
    enter_casino: "[E] Enter Casino",
    leave_casino: "[E] Leave Casino",
    enter_restaurant: "[E] Enter Restaurant",
    leave_restaurant: "[E] Leave Restaurant",
    enter_book_shop: "[E] Enter Book Shop",
    leave_book_shop: "[E] Leave Book Shop",
    enter_music_venue: "[E] Enter Music Venue",
    leave_music_venue: "[E] Leave Music Venue",
    enter_parking_garage: "[E] Enter Parking Garage",
    leave_parking_garage: "[E] Leave Parking Garage",
    enter_apartment: "[E] Enter Apartment",
    leave_apartment: "[E] Leave Apartment"
  };

  if (activeDoorAction) {
    actionPrompt.textContent = labels[activeDoorAction];
    actionPrompt.hidden = false;
  } else {
    actionPrompt.hidden = true;
  }
}

function openInteraction(citizen: Citizen): void {
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

popupClose.addEventListener("click", closeInteraction);
popupLeave.addEventListener("click", closeInteraction);
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

touchActionButton.addEventListener("click", () => handleInteractionKey());
touchPhoneButton.addEventListener("click", () => openPhone("contacts"));
touchDebugButton.addEventListener("click", () => {
  assetDebugVisible = !assetDebugVisible;
});

async function switchToScene(nextScene: ActiveSceneName, playerPosition: { x: number; z: number }): Promise<void> {
  await fadeToScene(sceneState, fadeOverlay, nextScene, () => {
    player.position.set(playerPosition.x, 0, playerPosition.z);
    playerVelocity.set(0, 0, 0);
    updateSceneVisibility();
    updateCitizenMeshes();
  });
}

function handleInteractionKey(): void {
  if (nearbyCitizen) {
    openInteraction(nearbyCitizen);
    return;
  }

  if (activeHomeAction === "rest") {
    void restAtHome();
    return;
  }
  if (activeHomeAction === "profile") {
    renderHomeProfile();
    return;
  }
  if (activeHomeAction === "customize") {
    showToast("Customize Character Coming Soon");
    return;
  }

  if (activeDoorAction === "enter_bar_a") {
    void switchToScene("barA", { x: barAPortal.interiorPosition.x, z: barAPortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_bar_a") {
    void switchToScene("outside", { x: barAPortal.exteriorPosition.x + 1.2, z: barAPortal.exteriorPosition.z });
  } else if (activeDoorAction === "enter_bar_b") {
    void switchToScene("barB", { x: barBPortal.interiorPosition.x, z: barBPortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_bar_b") {
    void switchToScene("outside", { x: barBPortal.exteriorPosition.x, z: barBPortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_sports_bar") {
    void switchToScene("sportsBar", { x: sportsBarPortal.interiorPosition.x, z: sportsBarPortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_sports_bar") {
    void switchToScene("outside", { x: sportsBarPortal.exteriorPosition.x, z: sportsBarPortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_casino") {
    void switchToScene("casino", { x: casinoPortal.interiorPosition.x, z: casinoPortal.interiorPosition.z - 1.8 });
  } else if (activeDoorAction === "leave_casino") {
    void switchToScene("outside", { x: casinoPortal.exteriorPosition.x, z: casinoPortal.exteriorPosition.z + 1.4 });
  } else if (activeDoorAction === "enter_restaurant") {
    void switchToScene("restaurant", { x: restaurantPortal.interiorPosition.x, z: restaurantPortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_restaurant") {
    void switchToScene("outside", { x: restaurantPortal.exteriorPosition.x, z: restaurantPortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_book_shop") {
    void switchToScene("bookShop", { x: bookShopPortal.interiorPosition.x, z: bookShopPortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_book_shop") {
    void switchToScene("outside", { x: bookShopPortal.exteriorPosition.x, z: bookShopPortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_music_venue") {
    void switchToScene("musicVenue", { x: musicVenuePortal.interiorPosition.x, z: musicVenuePortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_music_venue") {
    void switchToScene("outside", { x: musicVenuePortal.exteriorPosition.x, z: musicVenuePortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_parking_garage") {
    void switchToScene("parkingGarage", { x: parkingGaragePortal.interiorPosition.x, z: parkingGaragePortal.interiorPosition.z - 1.6 });
  } else if (activeDoorAction === "leave_parking_garage") {
    void switchToScene("outside", { x: parkingGaragePortal.exteriorPosition.x, z: parkingGaragePortal.exteriorPosition.z + 1.2 });
  } else if (activeDoorAction === "enter_apartment") {
    void switchToScene("apartment", { x: apartmentPortal.interiorPosition.x, z: apartmentPortal.interiorPosition.z - 1.5 });
  } else if (activeDoorAction === "leave_apartment") {
    void switchToScene("outside", { x: apartmentPortal.exteriorPosition.x, z: apartmentPortal.exteriorPosition.z + 1.1 });
  }
}

function updateHud(): void {
  const areaLabels: Record<ActiveSceneName, string> = {
    outside: DISTRICT_NAME,
    barA: "Bar A Interior",
    barB: "Bar B Interior",
    sportsBar: "Sports Bar Interior",
    casino: "Casino Interior",
    restaurant: "Standalone Restaurant Interior",
    bookShop: "Book Shop Interior",
    musicVenue: "Music Venue Interior",
    parkingGarage: "Parking Garage",
    apartment: "Your Apartment"
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
  const routingToGarage = citizens.filter((citizen) => citizen.currentState === "walking_to_destination" && citizen.currentDestination === "parking-garage-portal").length;
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
  opsSummary.innerHTML = `
    <p>Active District: ${DISTRICT_ID}</p>
    <h2>Multiplayer Debug</h2>
    <p>Supabase URL Configured: ${multiplayerDebug?.supabaseUrlConfigured ? "yes" : "no"}</p>
    <p>Supabase Anon Key Configured: ${multiplayerDebug?.supabaseAnonKeyConfigured ? "yes" : "no"}</p>
    <p>Current Mode: ${multiplayerDebug?.mode ?? "offline"}</p>
    <p>Channel Status: ${multiplayerDebug?.channelStatus ?? "unknown"}</p>
    <p>Local Player ID: ${multiplayerDebug?.localPlayerId ?? "unknown"}</p>
    <p>Local Display Name: ${multiplayerDebug?.localDisplayName || playerProfile.displayName}</p>
    <p>Presence Count: ${multiplayerDebug?.presenceCount ?? 1}</p>
    <p>Remote Players Count: ${multiplayerDebug?.remotePlayersCount ?? remotePlayerRuntimes.size}</p>
    <p>Last Broadcast: ${multiplayerDebug?.lastBroadcastAt ? new Date(multiplayerDebug.lastBroadcastAt).toLocaleTimeString() : "None"}</p>
    <p>Last Presence Sync: ${multiplayerDebug?.lastPresenceSyncAt ? new Date(multiplayerDebug.lastPresenceSyncAt).toLocaleTimeString() : "None"}</p>
    <p>Remote Players: ${remotePlayerList}</p>
    <p>Citizens: ${citizens.length} total / ${visible} visible</p>
    <p>Home: ${home} / Off District: ${offDistrict}</p>
    <p>Working: ${working} / Commuting: ${commuting}</p>
    <p>Visiting Interest Locations: ${visiting}</p>
    <p>Routing to Parking Garage: ${routingToGarage}</p>
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
  citizenDetails.innerHTML = `
    <h2>Selected Citizen</h2>
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
    <p>Known Citizens: ${formatCitizenList(inspected.knownCitizens, 8)}</p>
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
  citizenDetails.innerHTML += `
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
  updatePrompts();
  updateHud();
  updateOpsPanel();
  if (!phonePanel.hidden) renderPhone();
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
    openBusinessesWithoutWorkers: businessHealth.filter(
      (business) => business.operationalStatus !== "Closed" && business.employeesPresentCitizenIds.length === 0 && business.workersEnRouteCitizenIds.length === 0
    ).length,
    time: formatWorldTime(worldTime),
    triangles: renderer.info.render.triangles
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
  app.dataset.openBusinessesWithoutWorkers = `${window.__vibeCity3DHealth.openBusinessesWithoutWorkers}`;
  cameraModeLabel.textContent = "Isometric";
}

window.setInterval(animate, 1000 / 60);
animate();

function handleKeyDown(event: KeyboardEvent): void {
  const code = event.code.toLowerCase();
  keys.add(code);

  if (event.repeat) return;

  if (code === "keye") handleInteractionKey();
  if (code === "keyp") openPhone("contacts");
  if (code === "keyt") worldTime = advanceWorldHours(1);
  if (code === "keyy") worldTime = advanceWorldToNextDay();

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
