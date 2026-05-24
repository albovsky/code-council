interface PersistedSelectionConfig<T> {
  storageKey: string;
  cookieName: string;
  parse: (value: string | null) => T;
  serialize: (value: T) => string;
  defaultValue: T;
}

export interface PersistedSelection<T> {
  read(): T;
  write(value: T): void;
}

function readCookieValue(cookieName: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${cookieName}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}

function writeCookieValue(cookieName: string, value: string): void {
  if (typeof document === "undefined") return;
  const attributes = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "path=/",
    "max-age=31536000",
    "sameSite=lax",
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  document.cookie = attributes.join("; ");
}

function readLocalStorageValue(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof window.localStorage !== "undefined") {
      return window.localStorage.getItem(storageKey);
    }
  } catch {
    /* caller falls back to cookie or same-window memory */
  }
  return null;
}

function writeLocalStorageValue(storageKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof window.localStorage !== "undefined") {
      window.localStorage.setItem(storageKey, value);
    }
  } catch {
    /* caller already updated same-window memory */
  }
}

export function persistedSelection<T>(
  config: PersistedSelectionConfig<T>,
): PersistedSelection<T> {
  let fallbackValue = config.defaultValue;

  return {
    read() {
      const stored =
        readLocalStorageValue(config.storageKey) ??
        readCookieValue(config.cookieName);
      if (stored !== null) return config.parse(stored);
      return fallbackValue;
    },
    write(value) {
      fallbackValue = value;
      if (typeof window === "undefined") return;
      const serialized = config.serialize(value);
      writeCookieValue(config.cookieName, serialized);
      writeLocalStorageValue(config.storageKey, serialized);
    },
  };
}
