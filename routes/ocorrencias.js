'use strict';

const express = require('express');
const router  = express.Router();
const { requireLogin, requirePerfil } = require('../middlewares/auth');
const { upload } = require('../middlewares/upload');
const oc = require('../controllers/ocorrenciasController');

const camposVistoria = upload.fields([
  { name: 'foto_causa', maxCount: 1 },
  { name: 'foto_panoramica', maxCount: 1 },
  { name: 'foto_local', maxCount: 1 },
]);
const camposCorrecao = upload.fields([
  { name: 'evidencia_1', maxCount: 1 },
  { name: 'evidencia_2', maxCount: 1 },
  { name: 'evidencia_3', maxCount: 1 },
]);

// Tratamento de erro do multer (tamanho/formato) para não derrubar a rota
function comUpload(mw) {
  return (req, res, next) => mw(req, res, err => {
    if (err) {
      res.cookie('flash', JSON.stringify({ tipo: 'erro', msg: err.message }), { maxAge: 10000 });
      return res.redirect(req.originalUrl);
    }
    next();
  });
}

router.use(requireLogin);

router.get('/:id', oc.detalhes);

// Qualquer usuário logado (restrito a ocorrências manuais dentro do controller)
router.post('/:id/status', oc.alternarStatus);

// Vistoriador
router.post('/:id/assumir',   requirePerfil('vistoriador', 'admin'), oc.assumir);
router.post('/:id/devolver',  requirePerfil('vistoriador', 'admin'), oc.devolver);
router.get('/:id/vistoria',   requirePerfil('vistoriador', 'admin'), oc.telaVistoria);
router.post('/:id/vistoria',  requirePerfil('vistoriador', 'admin'), comUpload(camposVistoria), oc.salvarVistoria);

// Analista
router.post('/:id/tratativa', requirePerfil('analista', 'admin', 'gm'), oc.tratativa);
router.get('/:id/correcao',   requirePerfil('analista', 'admin'), oc.telaCorrecao);
router.post('/:id/correcao',  requirePerfil('analista', 'admin'), comUpload(camposCorrecao), oc.salvarCorrecao);

module.exports = router;
