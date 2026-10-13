(function () {
  'use strict';

  function request(method, url, options) {
    options = options || {};
    var headers = { 'X-Requested-With': 'anoma' };
    var body;
    if (options.raw) {
      body = options.raw;
      if (options.raw.type) headers['Content-Type'] = options.raw.type;
    } else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    return fetch(url, { method: method, headers: headers, body: body, credentials: 'same-origin' }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
        if (!res.ok) {
          var err = new Error((data && data.error) || 'HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  window.MapApi = {
    get: function (url) { return request('GET', url); },
    post: function (url, json) { return request('POST', url, { json: json }); },
    patch: function (url, json) { return request('PATCH', url, { json: json }); },
    put: function (url, json) { return request('PUT', url, { json: json }); },
    del: function (url) { return request('DELETE', url); },
    upload: function (method, url, blob) { return request(method, url, { raw: blob }); },
  };

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  // h('div', {class: 'x', onclick: fn}, 'text', childNode, [more, nodes])
  window.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') el.className = value;
        else if (key === 'style') el.setAttribute('style', value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key in el) el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };
})();
