/**
 * The Claude API key lives in the environment or the OS keychain (macOS
 * Keychain, Windows Credential Manager, libsecret). Never in SQLite or logs.
 */
const SERVICE = "autoply";
const ACCOUNT = "anthropic-api-key";

type KeyringEntry = { getPassword(): string | null; setPassword(p: string): void; deletePassword(): boolean };

async function entry(account = ACCOUNT): Promise<KeyringEntry | null> {
  // Tests never touch the real keychain.
  if (process.env.AUTOPLY_TEST === "1" || process.env.NODE_ENV === "test") return null;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(process.env.AUTOPLY_KEYCHAIN_SERVICE ?? SERVICE, account);
  } catch {
    return null;
  }
}

export type ApiKeySource = "env" | "keychain" | null;

export async function getApiKey(): Promise<{ key: string | null; source: ApiKeySource }> {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
  const e = await entry();
  try {
    const key = e?.getPassword() ?? null;
    return { key, source: key ? "keychain" : null };
  } catch {
    return { key: null, source: null };
  }
}

export async function setApiKey(key: string): Promise<void> {
  const e = await entry();
  if (!e) throw new Error("The OS keychain isn't available on this machine. Set ANTHROPIC_API_KEY instead.");
  e.setPassword(key.trim());
}

export async function deleteApiKey(): Promise<void> {
  const e = await entry();
  try {
    e?.deletePassword();
  } catch {
    // already absent
  }
}

/** Generic credential storage (e.g. Workday account passwords), same keychain service. */
export async function getSecret(account: string): Promise<string | null> {
  const e = await entry(account);
  try {
    return e?.getPassword() ?? null;
  } catch {
    return null;
  }
}

export async function setSecret(account: string, value: string): Promise<void> {
  const e = await entry(account);
  if (!e) throw new Error("The OS keychain isn't available on this machine.");
  e.setPassword(value);
}

export function maskKey(key: string) {
  return key.length <= 12 ? "••••" : `${key.slice(0, 7)}…${key.slice(-4)}`;
}
