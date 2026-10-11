'use strict';

function verifyEmailMessage({ login, url }) {
  return {
    subject: 'ANOMA WIKI: подтвердите почту',
    text:
      `Здравствуйте, ${login}!\n\n` +
      'Чтобы завершить регистрацию на ANOMA WIKI, подтвердите адрес почты по ссылке:\n\n' +
      `${url}\n\n` +
      'Ссылка действует 24 часа.\n\n' +
      'Если вы не регистрировались на сайте, просто проигнорируйте это письмо.\n',
  };
}

function resetPasswordMessage({ login, url }) {
  return {
    subject: 'ANOMA WIKI: сброс пароля',
    text:
      `Здравствуйте, ${login}!\n\n` +
      'Для аккаунта на ANOMA WIKI запрошен сброс пароля. Задайте новый пароль по ссылке:\n\n' +
      `${url}\n\n` +
      'Ссылка действует 1 час и работает один раз.\n\n' +
      'Если вы не запрашивали сброс, ничего не делайте: пароль останется прежним.\n',
  };
}

module.exports = { verifyEmailMessage, resetPasswordMessage };
