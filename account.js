(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var app = document.getElementById('app');

  var MESSAGES = {
    login_taken: 'Этот логин уже занят.',
    login_invalid: 'Логин: 3–32 символа — латинские буквы, цифры, _ . -',
    login_reserved: 'Этот логин зарезервирован, выберите другой.',
    email_invalid: 'Проверьте адрес почты.',
    password_short: 'Пароль: минимум 8 символов.',
    password_long: 'Пароль: максимум 128 символов.',
    password_equals_login: 'Пароль не должен совпадать с логином.',
    consent_required: 'Нужно согласие на обработку персональных данных.',
    token_invalid: 'Ссылка недействительна или уже использована.',
    current_password_wrong: 'Текущий пароль указан неверно.',
    mail_not_configured: 'Регистрация временно недоступна. Загляните позже.',
    'invalid login or password': 'Неверный логин или пароль.',
    email_not_verified: 'Почта ещё не подтверждена.',
  };

  function errorText(ex) {
    if (ex && ex.status === 429) return 'Слишком много попыток, попробуйте чуть позже.';
    return (ex && MESSAGES[ex.message]) || 'Что-то пошло не так. Попробуйте ещё раз.';
  }

  // Only same-site absolute paths: "/map?m=a" yes, "//evil", "/\evil", "http://…" no.
  function safeNext() {
    var next = new URLSearchParams(location.search).get('next');
    if (!next || !/^\/(?![\/\\])/.test(next) || /[\u0000-\u001f]/.test(next)) return null;
    return next;
  }

  function show() {
    app.textContent = '';
    for (var i = 0; i < arguments.length; i++) app.appendChild(arguments[i]);
  }

  function field(label, attrs) {
    var input = h('input', attrs);
    return { el: h('label', null, label, input), input: input };
  }

  // Disables the submit button while the request runs and prints errors into errEl.
  function bind(formEl, errEl, work) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = formEl.querySelector('button[type=submit]');
      errEl.textContent = '';
      btn.disabled = true;
      Promise.resolve()
        .then(work)
        .catch(function (ex) { errEl.textContent = errorText(ex); })
        .then(function () { btn.disabled = false; });
    });
  }

  function afterLogin(me) {
    var next = safeNext();
    if (next) location.href = next;
    else showProfile(me);
  }

  // ---------- guest ----------

  function showGuest(tab) {
    var tabs = h('div', { class: 'tabs' },
      h('button', { type: 'button', class: tab === 'login' ? 'on' : '', onclick: function () { showGuest('login'); } }, 'Вход'),
      h('button', { type: 'button', class: tab === 'register' ? 'on' : '', onclick: function () { showGuest('register'); } }, 'Регистрация'));
    show(h('h1', null, 'Аккаунт'), tabs, tab === 'register' ? registerForm() : loginForm());
  }

  function loginForm() {
    var login = field('Логин или почта', { name: 'login', type: 'text', autocomplete: 'username', required: true });
    var pass = field('Пароль', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, login.el, pass.el, err, h('button', { type: 'submit', class: 'primary' }, 'Войти'),
      h('div', { class: 'links' },
        h('button', { type: 'button', onclick: showForgot }, 'Забыли пароль?')));
    bind(form, err, function () {
      return api.post('/api/login', { login: login.input.value, password: pass.input.value }).then(afterLogin, function (ex) {
        if (ex.message === 'email_not_verified') return showResend(login.input.value);
        throw ex;
      });
    });
    return form;
  }

  function registerForm() {
    var login = field('Логин (публичное имя)', { name: 'login', type: 'text', autocomplete: 'username', required: true, maxLength: 32 });
    var email = field('Почта (не показывается другим)', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    var pass = field('Пароль (минимум 8 символов)', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var pass2 = field('Пароль ещё раз', { name: 'password2', type: 'password', autocomplete: 'new-password', required: true });
    var trap = h('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });
    var consent = h('input', { type: 'checkbox', name: 'consent', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null,
      login.el, email.el, pass.el, pass2.el,
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', null, 'Не заполняйте это поле', trap)),
      h('label', { class: 'check' }, consent,
        h('span', null, 'Согласен на обработку персональных данных (', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'политика'), ')')),
      err,
      h('button', { type: 'submit', class: 'primary' }, 'Зарегистрироваться'));
    bind(form, err, function () {
      if (pass.input.value !== pass2.input.value) { err.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/register', {
        login: login.input.value.trim(),
        email: email.input.value,
        password: pass.input.value,
        consent: consent.checked,
        website: trap.value,
      }).then(function () { showCheckMail(email.input.value.trim()); });
    });
    return form;
  }

  // ---------- mail states ----------

  function showCheckMail(email) {
    var info = h('p', { class: 'ok', role: 'status' });
    var btn = h('button', { type: 'button' }, 'Выслать письмо ещё раз');
    var wait = 0;
    function tick() {
      if (wait > 0) { btn.disabled = true; btn.textContent = 'Выслать ещё раз (' + wait + ' с)'; wait--; setTimeout(tick, 1000); }
      else { btn.disabled = false; btn.textContent = 'Выслать письмо ещё раз'; }
    }
    btn.addEventListener('click', function () {
      btn.disabled = true;
      api.post('/api/resend-verification', { email: email }).then(function () {
        info.textContent = 'Письмо отправлено повторно.';
        wait = 60; tick();
      }, function (ex) { info.textContent = errorText(ex); btn.disabled = false; });
    });
    wait = 60; tick();
    show(h('h1', null, 'Проверьте почту'),
      h('p', null, 'Мы отправили письмо со ссылкой на ', h('strong', null, email), '. Перейдите по ссылке, чтобы подтвердить адрес. Ссылка действует 24 часа.'),
      h('p', { class: 'muted' }, 'Не пришло? Проверьте «Спам».'),
      info, btn);
  }

  function showResend(prefill) {
    var email = field('Почта, указанная при регистрации', { name: 'email', type: 'email', autocomplete: 'email', required: true, value: prefill && prefill.indexOf('@') > 0 ? prefill : '' });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, email.el, err, h('button', { type: 'submit', class: 'primary' }, 'Выслать письмо'));
    bind(form, err, function () {
      return api.post('/api/resend-verification', { email: email.input.value }).then(function () { showCheckMail(email.input.value.trim()); });
    });
    show(h('h1', null, 'Почта не подтверждена'), h('p', null, 'Войти можно только после подтверждения почты. Мы вышлем письмо ещё раз.'), form);
  }

  function showForgot() {
    var email = field('Почта', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var ok = h('p', { class: 'ok', role: 'status' });
    var form = h('form', null, email.el, err, ok, h('button', { type: 'submit', class: 'primary' }, 'Выслать ссылку'),
      h('div', { class: 'links' }, h('button', { type: 'button', onclick: function () { showGuest('login'); } }, '← Ко входу')));
    bind(form, err, function () {
      return api.post('/api/forgot-password', { email: email.input.value }).then(function () {
        ok.textContent = 'Если такой адрес зарегистрирован, мы отправили на него ссылку для сброса пароля.';
      });
    });
    show(h('h1', null, 'Сброс пароля'), form);
  }

  function showVerify(token) {
    show(h('h1', null, 'Подтверждение почты'), h('p', { class: 'muted' }, 'Проверяем ссылку…'));
    api.post('/api/verify-email', { token: token }).then(function (me) {
      afterLogin(me);
    }, function (ex) {
      var box = h('div', null, h('h1', null, 'Ссылка не сработала'), h('p', { class: 'err' }, errorText(ex)),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: function () { showResend(''); } }, 'Выслать новую ссылку')));
      show(box);
    });
  }

  function showReset(token) {
    var pass = field('Новый пароль (минимум 8 символов)', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var pass2 = field('Новый пароль ещё раз', { name: 'password2', type: 'password', autocomplete: 'new-password', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, pass.el, pass2.el, err, h('button', { type: 'submit', class: 'primary' }, 'Сохранить пароль'));
    bind(form, err, function () {
      if (pass.input.value !== pass2.input.value) { err.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/reset-password', { token: token, password: pass.input.value }).then(function () {
        show(h('h1', null, 'Пароль изменён'), h('p', { class: 'ok' }, 'Теперь войдите с новым паролем.'), loginForm());
      });
    });
    show(h('h1', null, 'Новый пароль'), form);
  }

  // ---------- profile ----------

  function fmt(ms) {
    return ms ? new Date(ms).toLocaleString('ru-RU') : '—';
  }

  function shortAgent(ua) {
    if (!ua) return 'Неизвестное устройство';
    var m = /(Firefox|Edg|OPR|Chrome|Safari)\/[\d.]+/.exec(ua);
    var os = /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/.exec(ua);
    return (m ? m[1].replace('Edg', 'Edge').replace('OPR', 'Opera') : 'Браузер') + (os ? ' · ' + os[1] : '');
  }

  function showProfile(me) {
    var user = me.user;
    var list = h('ul', { class: 'sessions' }, h('li', { class: 'muted' }, 'Загрузка…'));

    function loadSessions() {
      api.get('/api/sessions').then(function (data) {
        list.textContent = '';
        data.sessions.forEach(function (s) {
          var row = h('li', null,
            h('div', { class: 'what' },
              h('div', null, shortAgent(s.userAgent), ' ', s.current ? h('span', { class: 'badge' }, 'эта') : null),
              h('div', { class: 'when' }, (s.ip || '—') + ' · вход ' + fmt(s.createdAt) + ' · активность ' + fmt(s.lastSeenAt || s.createdAt))));
          if (!s.current) {
            row.appendChild(h('button', { type: 'button', onclick: function () {
              api.del('/api/sessions/' + s.id).then(loadSessions);
            } }, 'Завершить'));
          }
          list.appendChild(row);
        });
      }, function () { list.textContent = 'Не удалось загрузить сессии.'; });
    }

    var cur = field('Текущий пароль', { name: 'current', type: 'password', autocomplete: 'current-password', required: true });
    var nw = field('Новый пароль', { name: 'next', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var nw2 = field('Новый пароль ещё раз', { name: 'next2', type: 'password', autocomplete: 'new-password', required: true });
    var pwErr = h('p', { class: 'err', role: 'alert' });
    var pwOk = h('p', { class: 'ok', role: 'status' });
    var pwForm = h('form', null, cur.el, nw.el, nw2.el, pwErr, pwOk, h('button', { type: 'submit' }, 'Сменить пароль'));
    bind(pwForm, pwErr, function () {
      pwOk.textContent = '';
      if (nw.input.value !== nw2.input.value) { pwErr.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/change-password', { current: cur.input.value, next: nw.input.value }).then(function () {
        pwForm.reset();
        pwOk.textContent = 'Пароль изменён. Остальные устройства разлогинены.';
        loadSessions();
      });
    });

    var revoke = h('button', { type: 'button', onclick: function () {
      api.post('/api/sessions/revoke-others', {}).then(loadSessions);
    } }, 'Выйти на всех остальных устройствах');

    var logout = h('button', { type: 'button', class: 'primary', onclick: function () {
      api.post('/api/logout', {}).then(function () { showGuest('login'); });
    } }, 'Выйти');

    show(
      h('h1', null, user.login),
      h('p', { class: 'muted' }, user.email ? 'Почта: ' + user.email : 'Почта не указана'),
      user.role === 'admin' ? h('p', null, h('a', { href: '/map' }, 'Открыть карту (редактор)')) : h('p', null, h('a', { href: '/map' }, 'Открыть карту')),
      h('h2', null, 'Смена пароля'), pwForm,
      h('h2', null, 'Где выполнен вход'), list, h('div', { class: 'row' }, revoke),
      h('div', { class: 'row' }, logout));
    loadSessions();
  }

  // ---------- start ----------

  function start() {
    var m = /^#(verify|reset)=([0-9a-f]{64})$/.exec(location.hash);
    if (m) {
      // The token must not stay in the address bar, history or Referer.
      history.replaceState(null, '', location.pathname + location.search);
      if (m[1] === 'verify') showVerify(m[2]);
      else showReset(m[2]);
      return;
    }
    api.get('/api/me').then(function (me) {
      if (me && me.user) showProfile(me);
      else showGuest('login');
    }, function () { showGuest('login'); });
  }

  start();
})();
