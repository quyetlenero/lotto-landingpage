interface BusinessHoursWindow {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

interface BusinessHoursConfig {
  tz?: string;
  windows?: BusinessHoursWindow[];
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Returns true if `at` falls inside one of the brand's configured business-hours windows. */
export function isWithinBusinessHours(config: unknown, at: Date): boolean {
  const cfg = config as BusinessHoursConfig;
  if (!cfg?.windows || cfg.windows.length === 0) return false;

  const tz = cfg.tz ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase().slice(0, 3);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const nowMinutes = Number(hour) * 60 + Number(minute);
  const dayKey = DAY_KEYS.find((d) => d === weekday);
  if (!dayKey) return false;

  return cfg.windows.some((w) => {
    if (w.day !== dayKey) return false;
    const [startH, startM] = w.start.split(":").map(Number);
    const [endH, endM] = w.end.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  });
}
