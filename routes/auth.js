'use strict';

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const auth = require('../controllers/authController');

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.get('/login',  auth.telaLogin);
router.post('/login', loginLimiter, auth.login);

router.get('/cadastro',  auth.telaCadastro);
router.post('/cadastro', loginLimiter, auth.cadastrar);

router.get('/trocar-senha',  auth.telaTrocarSenha);
router.post('/trocar-senha', auth.trocarSenha);

router.get('/perfil', auth.telaPerfil);

// POST (não GET): evita logout forçado via link/imagem cross-site (CSRF).
router.post('/logout', auth.logout);

module.exports = router;
