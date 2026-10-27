import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function encryptReport(filename, report) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(report)), cipher.final()]);
  const encryptedKey = publicEncrypt({
    key: readFileSync(new URL('./inspection-public.pem', import.meta.url)),
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, key);
  writeFileSync(filename, JSON.stringify({ key: encryptedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
}
