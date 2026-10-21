/* Shim de google.script.* para las landings GAS servidas desde Ownia.
 * Reemplaza google.script.run por un POST a <BASE_PATH>/api/<modulo>/<funcion>, con la
 * misma semántica (withSuccessHandler / withFailureHandler / withUserObject), así el HTML
 * de cada landing no se toca. Lo inyecta server/render.js antes de cualquier otro script.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var API = script && script.getAttribute('data-api');

  function call(name, args, success, failure, userObject) {
    var body;
    try {
      body = JSON.stringify({ args: args });
    } catch (e) {
      setTimeout(function () { fail(e); }, 0);
      return;
    }
    function fail(err) {
      if (failure) failure(err, userObject);
      else console.error('google.script.run.' + name + ':', err);
    }
    fetch(API + '/' + encodeURIComponent(name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
      body: body,
    })
      .then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
          return { ok: r.ok, status: r.status, data: data, text: t };
        });
      })
      .then(function (res) {
        if (res.ok && res.data && 'result' in res.data) {
          if (success) success(res.data.result, userObject);
          return;
        }
        var msg = (res.data && res.data.error) || ('Error ' + res.status + (res.text ? ': ' + res.text.slice(0, 200) : ''));
        var err = new Error(msg);
        err.name = (res.data && res.data.name) || 'ScriptError';
        fail(err);
      }, fail);
  }

  function runner(success, failure, userObject) {
    return new Proxy({}, {
      get: function (_t, name) {
        if (name === 'withSuccessHandler') return function (fn) { return runner(fn, failure, userObject); };
        if (name === 'withFailureHandler') return function (fn) { return runner(success, fn, userObject); };
        if (name === 'withUserObject') return function (o) { return runner(success, failure, o); };
        if (typeof name !== 'string') return undefined;
        return function () {
          call(name, Array.prototype.slice.call(arguments), success, failure, userObject);
        };
      },
    });
  }

  function location_(cb) {
    var parameter = {};
    var parameters = {};
    new URLSearchParams(window.location.search).forEach(function (v, k) {
      if (!(k in parameter)) parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    cb({ hash: window.location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters });
  }

  window.google = window.google || {};
  window.google.script = {
    run: runner(null, null, undefined),
    url: { getLocation: location_ },
    host: {
      origin: window.location.origin,
      close: function () {},
      setHeight: function () {},
      setWidth: function () {},
      editor: { focus: function () {} },
    },
    history: {
      push: function (state, query, hash) { history.pushState(state, '', hash ? '#' + hash : window.location.href); },
      replace: function (state, query, hash) { history.replaceState(state, '', hash ? '#' + hash : window.location.href); },
      setChangeHandler: function (fn) { window.addEventListener('popstate', function (e) { fn({ state: e.state, location: {} }); }); },
    },
  };
})();
