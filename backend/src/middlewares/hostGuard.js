'use strict';

// Proteção contra DNS rebinding: só atende requisições cujo `Host` é `localhost` ou `127.0.0.1`
// (com ou sem porta). A porta não importa: o que um site malicioso não consegue forjar é o hostname.
// `[::1]` fica de fora de propósito: o servidor escuta só em 127.0.0.1 (D135), então esse Host nunca chega.
const { AppError } = require('../errors/AppError');

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

function hostGuard(req, res, next) {
  const host = String(req.get('host') || '');
  if (!LOCAL_HOST_PATTERN.test(host)) {
    return next(new AppError(403, 'FORBIDDEN_HOST', 'Requisição recusada: o endereço de acesso não é local.'));
  }
  return next();
}

module.exports = { hostGuard };
