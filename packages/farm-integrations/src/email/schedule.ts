export interface EmailScheduleDelay {
  kind: "delay";
  seconds: number;
}

export type EmailScheduleWhen = string | number | Date | EmailScheduleDelay;

function createScheduleDelay(seconds: number): EmailScheduleDelay {
  return {
    kind: "delay",
    seconds,
  };
}

export const emailSchedule = {
  after: {
    seconds: (seconds: number) => createScheduleDelay(seconds),
    second: (seconds: number) => createScheduleDelay(seconds),
    sec: (seconds: number) => createScheduleDelay(seconds),
    minutes: (minutes: number) => createScheduleDelay(minutes * 60),
    minute: (minutes: number) => createScheduleDelay(minutes * 60),
    min: (minutes: number) => createScheduleDelay(minutes * 60),
    hours: (hours: number) => createScheduleDelay(hours * 60 * 60),
    hour: (hours: number) => createScheduleDelay(hours * 60 * 60),
    hr: (hours: number) => createScheduleDelay(hours * 60 * 60),
    days: (days: number) => createScheduleDelay(days * 24 * 60 * 60),
    day: (days: number) => createScheduleDelay(days * 24 * 60 * 60),
  },
  presets: {
    in30Minutes: createScheduleDelay(30 * 60),
    in1Hour: createScheduleDelay(60 * 60),
    in2Hours: createScheduleDelay(2 * 60 * 60),
    in1Day: createScheduleDelay(24 * 60 * 60),
  },
} as const;

export function isEmailScheduleDelay(value: unknown): value is EmailScheduleDelay {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    "seconds" in value &&
    value.kind === "delay" &&
    typeof value.seconds === "number"
  );
}

export function resolveEmailScheduleWhen(when: EmailScheduleWhen, now = Date.now()) {
  if (when instanceof Date) {
    return when.toISOString();
  }

  if (typeof when === "number") {
    if (!Number.isFinite(when) || when <= 0) {
      throw new Error("Email schedule delay seconds must be a positive finite number.");
    }

    return new Date(now + when * 1000).toISOString();
  }

  if (isEmailScheduleDelay(when)) {
    if (!Number.isFinite(when.seconds) || when.seconds <= 0) {
      throw new Error("Email schedule delay seconds must be a positive finite number.");
    }

    return new Date(now + when.seconds * 1000).toISOString();
  }

  if (typeof when === "string") {
    const value = when.trim();

    if (!value) {
      throw new Error("Email scheduling requires a non-empty when value.");
    }

    return value;
  }

  throw new Error("Unsupported email schedule value.");
}
