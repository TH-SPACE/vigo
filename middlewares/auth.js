'use strict';

const jwt = require('jsonwebtoken');

// Em produção o segredo é obrigatório: aborta o boot em vez de assinar tokens
// com um segredo conhecido (qualquer um poderia forjar sessões). Em dev, permite
// um fallback só para conveniência local.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET não definido — obrigatório em produção.');
}
const JWT_SECRET  = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const COOKIE_NAME = 'token';

function gerarToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Lê o JWT do cookie e injeta req.user / res.locals.user em TODAS as requisições.
function carregarUsuario(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  res.locals.user = null;
  req.user = null;
  if (token) {
    try {
      const dados = jwt.verify(token, JWT_SECRET);
      req.user = dados;
      res.locals.user = dados;
    } catch {
      clearAuthCookie(res);
    }
  }
  // mensagens flash via cookie de uma só leitura
  if (req.cookies?.flash) {
    try { res.locals.flash = JSON.parse(req.cookies.flash); } catch { res.locals.flash = null; }
    res.clearCookie('flash');
  } else {
    res.locals.flash = null;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ erro: 'Não autenticado.' });
  }
  // Primeiro login / troca de senha obrigatória: prende na tela de troca.
  if (req.user.primeiro_login && !['/trocar-senha', '/logout'].includes(req.path)) {
    return res.redirect('/trocar-senha');
  }
  next();
}

function requirePerfil(...perfis) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!perfis.includes(req.user.perfil)) {
      return res.status(403).render('error', {
        titulo: 'Acesso negado',
        mensagem: 'Você não tem permissão para acessar esta página.',
        code: 403,
      });
    }
    next();
  };
}

// Atalho: admin OU gm (administração)
const requireAdminOuGm = requirePerfil('admin', 'gm');

module.exports = {
  gerarToken, setAuthCookie, clearAuthCookie, carregarUsuario,
  requireLogin, requirePerfil, requireAdminOuGm, COOKIE_NAME,
};
