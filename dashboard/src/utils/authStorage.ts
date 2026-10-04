export type AuthCredential =
  | { type: 'apiKey'; value: string; rememberMe: boolean }
  | { type: 'dashboardSession'; value: string; rememberMe: boolean };

export type StoredCredential = Omit<AuthCredential, 'rememberMe'>;

const API_KEY_STORAGE = 'openwa_api_key';
const SESSION_STORAGE = 'openwa_dashboard_session';

export function readSavedCredential(): StoredCredential | null {
  for (const storage of [sessionStorage, localStorage]) {
    const apiKey = storage.getItem(API_KEY_STORAGE);
    if (apiKey) return { type: 'apiKey', value: apiKey };
    const dashboardSession = storage.getItem(SESSION_STORAGE);
    if (dashboardSession) return { type: 'dashboardSession', value: dashboardSession };
  }
  return null;
}

export function saveCredential(credential: AuthCredential): void {
  clearSavedCredential();
  const key = credential.type === 'apiKey' ? API_KEY_STORAGE : SESSION_STORAGE;
  const storage = credential.rememberMe ? localStorage : sessionStorage;
  storage.setItem(key, credential.value);
}

export function clearSavedCredential(): void {
  sessionStorage.removeItem(API_KEY_STORAGE);
  sessionStorage.removeItem(SESSION_STORAGE);
  localStorage.removeItem(API_KEY_STORAGE);
  localStorage.removeItem(SESSION_STORAGE);
}

export function credentialHeaders(credential = readSavedCredential()): Record<string, string> {
  if (!credential) return {};
  return credential.type === 'apiKey' ? { 'X-API-Key': credential.value } : { 'X-OpenWA-Session': credential.value };
}

export function sameCredential(left: StoredCredential | null, right: StoredCredential | null): boolean {
  return left?.type === right?.type && left?.value === right?.value;
}

export function savedApiKey(): string | null {
  const credential = readSavedCredential();
  return credential?.type === 'apiKey' ? credential.value : null;
}
