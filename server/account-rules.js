'use strict';

const { LOGIN_RE } = require('./auth');

const RESERVED_LOGINS = new Set(['admin', 'administrator', 'moderator', 'support', 'root', 'system', 'anoma']);
const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function checkLogin(login) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) return 'login_invalid';
  if (RESERVED_LOGINS.has(login.toLowerCase())) return 'login_reserved';
  return null;
}

function checkPassword(password, login) {
  if (typeof password !== 'string' || password.length < 8) return 'password_short';
  if (password.length > 128) return 'password_long';
  if (login && password.toLowerCase() === String(login).toLowerCase()) return 'password_equals_login';
  return null;
}

module.exports = { normalizeEmail, checkLogin, checkPassword, RESERVED_LOGINS };
