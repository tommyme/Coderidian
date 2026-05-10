import { pbkdf2Sync, createDecipheriv } from 'crypto';

const SALT = Buffer.from('saltysalt');
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const V10_PREFIX = Buffer.from('v10');
const V11_PREFIX = Buffer.from('v11');

// Chrome macOS v10 layout: v10(3) + nonce(16) + IV(16) + AES-128-CBC ciphertext
const V10_NONCE_START = 3;
const V10_IV_START = 19;
const V10_CIPHER_START = 35;

export function deriveKey(password: string): Buffer {
    return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function decryptValue(encryptedHex: string, key: Buffer): string {
    const encrypted = Buffer.from(encryptedHex, 'hex');

    if (encrypted.slice(0, 3).equals(V11_PREFIX)) {
        throw new Error('v11 (App-Bound Encryption) not supported on this Chrome version');
    }

    // Non-v10 prefix means plaintext stored in encrypted_value (rare, legacy)
    if (!encrypted.slice(0, 3).equals(V10_PREFIX)) {
        return encrypted.toString('utf-8');
    }

    if (encrypted.length < V10_CIPHER_START) {
        throw new Error('Encrypted value too short to contain v10 header');
    }

    const iv = encrypted.slice(V10_IV_START, V10_CIPHER_START);
    const payload = encrypted.slice(V10_CIPHER_START);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

    // Strip PKCS7 padding: last byte is the pad length
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 16 || padLen > decrypted.length) {
        throw new Error('Invalid PKCS7 padding — AES decryption key may be wrong');
    }
    return decrypted.slice(0, decrypted.length - padLen).toString('utf-8');
}
