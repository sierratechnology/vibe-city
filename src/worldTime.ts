export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type VibeCityTimeMode = "real_world" | "simulated";

export type WorldTimeState = {
  absoluteMinutes: number;
  seasonDay: number;
  dayOfWeek: (typeof DAY_NAMES)[number];
  minuteOfDay: number;
  seasonStartTimestamp: number;
  realWorldTime: string;
  realWorldDate: string;
  timezone: string;
  vibeCityTimeMode: VibeCityTimeMode;
};

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * DAY_NAMES.length;
const TIME_MODE: VibeCityTimeMode = "real_world";

function localDayIndex(date: Date): number {
  return (date.getDay() + 6) % DAY_NAMES.length;
}

function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
}

export function getWorldTime(): WorldTimeState {
  const now = new Date();
  const dayIndex = localDayIndex(now);
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const weekIndex = Math.floor(now.getTime() / (MINUTES_PER_WEEK * 60 * 1000));

  return {
    absoluteMinutes: weekIndex * MINUTES_PER_WEEK + dayIndex * MINUTES_PER_DAY + minuteOfDay,
    seasonDay: dayIndex + 1,
    dayOfWeek: DAY_NAMES[dayIndex],
    minuteOfDay,
    seasonStartTimestamp: 0,
    realWorldTime: formatLocalTime(now),
    realWorldDate: formatLocalDate(now),
    timezone: localTimezone(),
    vibeCityTimeMode: TIME_MODE
  };
}

export function advanceWorldHours(_hours: number): WorldTimeState {
  return getWorldTime();
}

export function advanceWorldToNextDay(): WorldTimeState {
  return getWorldTime();
}

export function formatWorldTime(state: WorldTimeState): string {
  return `${state.realWorldDate} - ${state.realWorldTime}`;
}

export function dayIndexForName(day: (typeof DAY_NAMES)[number]): number {
  return DAY_NAMES.indexOf(day);
}
