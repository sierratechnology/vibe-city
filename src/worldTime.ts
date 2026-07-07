export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type WorldTimeState = {
  absoluteMinutes: number;
  seasonDay: number;
  dayOfWeek: (typeof DAY_NAMES)[number];
  minuteOfDay: number;
  seasonStartTimestamp: number;
};

const STORAGE_KEY = "stgWorldZero.seasonStartTimestamp";
const OFFSET_KEY = "stgWorldZero.debugWorldMinuteOffset";
const START_MINUTE = 8 * 60 + 45;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_REAL_SECOND = 5;

function getStoredNumber(key: string): number | null {
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSeasonStartTimestamp(): number {
  const existing = getStoredNumber(STORAGE_KEY);
  if (existing) return existing;
  const created = Date.now();
  window.localStorage.setItem(STORAGE_KEY, `${created}`);
  return created;
}

function getDebugOffset(): number {
  return getStoredNumber(OFFSET_KEY) ?? 0;
}

function setDebugOffset(minutes: number): void {
  window.localStorage.setItem(OFFSET_KEY, `${minutes}`);
}

export function getWorldTime(): WorldTimeState {
  const seasonStartTimestamp = getSeasonStartTimestamp();
  const elapsedSeconds = Math.max(0, (Date.now() - seasonStartTimestamp) / 1000);
  const absoluteMinutes = START_MINUTE + elapsedSeconds * MINUTES_PER_REAL_SECOND + getDebugOffset();
  const dayIndex = Math.floor(absoluteMinutes / MINUTES_PER_DAY);
  const minuteOfDay = ((Math.floor(absoluteMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  return {
    absoluteMinutes,
    seasonDay: dayIndex + 1,
    dayOfWeek: DAY_NAMES[dayIndex % DAY_NAMES.length],
    minuteOfDay,
    seasonStartTimestamp
  };
}

export function advanceWorldHours(hours: number): WorldTimeState {
  setDebugOffset(getDebugOffset() + hours * 60);
  return getWorldTime();
}

export function advanceWorldToNextDay(): WorldTimeState {
  const state = getWorldTime();
  const nextDayStart = Math.floor(state.absoluteMinutes / MINUTES_PER_DAY + 1) * MINUTES_PER_DAY;
  const desiredAbsoluteMinutes = nextDayStart + START_MINUTE;
  const delta = desiredAbsoluteMinutes - state.absoluteMinutes;
  setDebugOffset(getDebugOffset() + delta);
  return getWorldTime();
}

export function formatWorldTime(state: WorldTimeState): string {
  const hours24 = Math.floor(state.minuteOfDay / 60);
  const minutes = state.minuteOfDay % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `World Time: Day ${state.seasonDay} - ${state.dayOfWeek} - ${hours12}:${`${minutes}`.padStart(2, "0")} ${suffix}`;
}

export function dayIndexForName(day: (typeof DAY_NAMES)[number]): number {
  return DAY_NAMES.indexOf(day);
}
