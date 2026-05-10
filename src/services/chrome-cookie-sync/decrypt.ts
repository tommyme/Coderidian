import { pbkdf2Sync, createDecipheriv } from 'crypto';

const SALT = Buffer.from('saltysalt');
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, 0x20); // 16 space characters
const V10_PREFIX = Buffer.from('v10');

export function deriveKey(password: string): Buffer {
    return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function decryptValue(encryptedHex: string, key: Buffer): string {
    const encrypted = Buffer.from(encryptedHex, 'hex');

    // Non-v10 prefix means plaintext stored in encrypted_value (rare, legacy)
    if (!encrypted.slice(0, 3).equals(V10_PREFIX)) {
        return encrypted.toString('utf-8');
    }

    const payload = encrypted.slice(3);
    const decipher = createDecipheriv('aes-128-cbc', key, IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

    // Strip PKCS7 padding: last byte is the pad length
    const padLen = decrypted[decrypted.length - 1];
    return decrypted.slice(0, decrypted.length - padLen).toString('utf-8');
}
