import type { EncryptedData, ObfuscatedKeyParams, DerivationParams } from './types';
import {
  STORAGE_KEY_DERIVATION,
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  PBKDF2_ITERATIONS,
  ARRAY_SIZE,
  VALUE_LENGTH,
} from './types';

let cachedKey: CryptoKey | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function generateRandomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(VALUE_LENGTH));
  return arrayBufferToBase64(bytes.buffer);
}

function deriveIndices(extensionId: string): { nonceIdx: number; saltIdx: number } {
  const h1 = extensionId.charCodeAt(0) + extensionId.charCodeAt(2) + extensionId.charCodeAt(4);
  const h2 = extensionId.charCodeAt(1) + extensionId.charCodeAt(3) + extensionId.charCodeAt(5);

  const nonceIdx = h1 % ARRAY_SIZE;
  let saltIdx = h2 % ARRAY_SIZE;

  if (saltIdx === nonceIdx) {
    saltIdx = (saltIdx + 1) % ARRAY_SIZE;
  }

  return { nonceIdx, saltIdx };
}

async function initializeKeyParams(): Promise<ObfuscatedKeyParams> {
  const values: string[] = [];
  for (let i = 0; i < ARRAY_SIZE; i++) {
    values.push(generateRandomValue());
  }

  const params: ObfuscatedKeyParams = { d: values };
  await chrome.storage.local.set({ [STORAGE_KEY_DERIVATION]: params });

  return params;
}

async function getOrCreateKeyParams(): Promise<DerivationParams> {
  const result = await chrome.storage.local.get(STORAGE_KEY_DERIVATION);
  let params: ObfuscatedKeyParams = result[STORAGE_KEY_DERIVATION];

  if (!params || !params.d || params.d.length !== ARRAY_SIZE) {
    params = await initializeKeyParams();
  }

  const extensionId = chrome.runtime.id;
  const { nonceIdx, saltIdx } = deriveIndices(extensionId);

  return {
    nonce: params.d[nonceIdx],
    salt: params.d[saltIdx],
  };
}

async function deriveEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }

  const { nonce, salt } = await getOrCreateKeyParams();
  const extensionId = chrome.runtime.id;
  const seed = `${extensionId}|${nonce}`;

  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);

  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );

  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveEncryptionKey();
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  return {
    c: arrayBufferToBase64(ciphertext),
    i: arrayBufferToBase64(iv),
    v: 1,
  };
}

export async function decrypt(data: EncryptedData): Promise<string> {
  const key = await deriveEncryptionKey();
  const iv = new Uint8Array(base64ToArrayBuffer(data.i));
  const ciphertext = base64ToArrayBuffer(data.c);

  try {
    const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Decryption failed');
  }
}

export function isEncryptedData(data: unknown): data is EncryptedData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.c === 'string' && typeof obj.i === 'string' && typeof obj.v === 'number';
}

export function clearKeyCache(): void {
  cachedKey = null;
}
