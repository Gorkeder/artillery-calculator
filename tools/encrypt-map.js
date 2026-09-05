// Шифрует map.js -> map.enc, используя ключ из переменной окружения MAP_KEY
// (64 hex-символа = 32 байта). Формат map.enc: base64( iv(12) || authTag(16) || ciphertext ).
const fs = require('fs');
const crypto = require('crypto');

const keyHex = (process.env.MAP_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error('MAP_KEY должен содержать ровно 64 hex-символа');
  process.exit(1);
}

const key = Buffer.from(keyHex, 'hex');
const plain = fs.readFileSync('map.js');
const iv = crypto.randomBytes(12);

const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();

const blob = Buffer.concat([iv, tag, ct]).toString('base64');
fs.writeFileSync('map.enc', blob + '\n');
console.error('map.enc записан:', blob.length, 'символов base64');
