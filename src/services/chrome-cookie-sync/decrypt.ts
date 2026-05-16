import { pbkdf2Sync, createDecipheriv } from 'crypto';

const SALT = Buffer.from('saltysalt');
const ITERATIONS = 1003;
const KEY_LENGTH = 16;

// Chrome macOS format: prefix(3) + AES-128-CBC ciphertext
// The IV is a hardcoded constant (16 × 0x20), NOT stored in the encrypted blob.
// v11 App-Bound Encryption is Windows-only; macOS v11 uses the same scheme as v10.
const VERSIONED_PREFIX_LEN = 3;
const CIPHER_START = VERSIONED_PREFIX_LEN; // 3 — ciphertext begins immediately after prefix
const CBC_IV = Buffer.alloc(16, 0x20);     // hardcoded, matches Chrome source

export function deriveKey(password: string): Buffer {
    return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function decryptValue(encryptedHex: string, key: Buffer): string {
    if (!encryptedHex) return '';
    const encrypted = Buffer.from(encryptedHex, 'hex');
    if (encrypted.length === 0) return '';

    const prefix = encrypted.slice(0, VERSIONED_PREFIX_LEN).toString('ascii');

    if (prefix !== 'v10' && prefix !== 'v11') {
        // Legacy: plaintext stored directly in encrypted_value
        return encrypted.toString('utf-8');
    }

    if (encrypted.length < CIPHER_START) {
        throw new Error('Encrypted blob too short to contain a valid versioned header');
    }

    const payload = encrypted.slice(CIPHER_START);
    const decipher = createDecipheriv('aes-128-cbc', key, CBC_IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

    // Remove PKCS7 padding: last byte is the pad length
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 16 || padLen > decrypted.length) {
        throw new Error('Invalid PKCS7 padding — AES key may be wrong');
    }
    const unpadded = decrypted.slice(0, decrypted.length - padLen);

    // Primary: direct UTF-8 decode
    const value = unpadded.toString('utf-8');
    if (!value.includes('�')) return value;

    // Fallback: some cookies have a 32-byte SHA256(host) prefix before the value
    if (unpadded.length > 32) {
        const stripped = unpadded.slice(32).toString('utf-8');
        if (!stripped.includes('�')) return stripped;
    }

    return value;
}
