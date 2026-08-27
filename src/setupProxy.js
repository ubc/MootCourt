// Development-only proxy, picked up automatically by react-scripts.
//
// This is what makes CWL login possible in development. SAML sends the browser
// to the IdP and the IdP posts the assertion back to a callback URL; that URL
// and the app itself have to be the same origin, or the session cookie set by
// the callback is invisible to the app. Proxying /auth and /api from the React
// dev server to the Node server means the browser only ever sees
// http://localhost:43127, which is the origin registered as the SAML service
// provider. In production the Node server serves the built app directly, so
// this file is not involved.
// CommonJS on purpose. react-scripts loads this with
// `require(setupProxy)(app)` and calls the result, so it has to export a
// function — an ES module namespace is not callable and the dev server would
// die before binding (ERR_CONNECTION_REFUSED). The root package.json therefore
// must not set "type": "module"; the server's own ESM lives in .mjs files,
// which are ESM by extension regardless.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const target = process.env.MOOTCOURT_API_TARGET || 'http://127.0.0.1:43128';

  app.use(
    ['/api', '/auth'],
    createProxyMiddleware({
      target,
      changeOrigin: false,
      // The SAML callback is a form POST from the IdP, not an XHR.
      xfwd: true,
      logLevel: 'warn',
    }),
  );
};
