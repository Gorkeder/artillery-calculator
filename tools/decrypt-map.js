// Расшифровывает map.enc -> map.js, используя ключ из переменной окружения MAP_KEY
// (64 hex-символа = 32 байта). Формат map.enc: base64( iv(12) || authTag(16) || ciphertext ).
const fs = require('fs');
const crypto = require('crypto');

const keyHex = (process.env.MAP_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error('MAP_KEY должен содержать ровно 64 hex-символа');
  process.exit(1);
}

const key = Buffer.from(keyHex, 'hex');
const blob = Buffer.from(fs.readFileSync('map.enc', 'utf8').trim(), 'base64');
const iv = blob.subarray(0, 12);
const tag = blob.subarray(12, 28);
const ct = blob.subarray(28);

const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const out = Buffer.concat([decipher.update(ct), decipher.final()]);

fs.writeFileSync('map.js', out);
console.error('map.js записан:', out.length, 'байт');
