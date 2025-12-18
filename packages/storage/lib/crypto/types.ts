export interface EncryptedData {
  c: string;
  i: string;
  v: number;
}

export interface ObfuscatedKeyParams {
  d: string[];
}

export interface DerivationParams {
  nonce: string;
  salt: string;
}

export const STORAGE_KEY_DERIVATION = 'warpsurf-kp';
export const ARRAY_SIZE = 8;
export const VALUE_LENGTH = 32;
export const IV_LENGTH = 12;
export const KEY_LENGTH = 256;
export const PBKDF2_ITERATIONS = 310000;
export const ALGORITHM = 'AES-GCM';
