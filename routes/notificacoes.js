'use strict';

const express    = require('express');
const router     = express.Router();
const { requireLogin } = require('../middlewares/auth');
const db         = require('../database/connection');
const Ocorrencia = require('../models/Ocorrencia');
const sseBus     = require('../services/sse');

router.use(requireLogin);

// ── Server-Sent Events: atualizações em tempo real ───────────────────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write('event: conectado\ndata: {}\n\n');

  const onImportacao = (data) => {
    res.write(`event: importacao\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sseBus.on('importacao', onImportacao);

  // Heartbeat a cada 25s para manter a conexão viva por proxies/nginx
  const hb = setInterval(() => { res.write(': hb\n\n'); }, 25000);

  req.on('close', () => {
    sseBus.off('importacao', onImportacao);
    clearInterval(hb);
  });
});

router.get('/', async (req, res) => {
  try {
    const { desde } = req.query;
    if (!desde) return res.json({ total: 0, mensagem: null, link: '/dashboard' });

    const perfil = req.user.perfil;
    const userId = req.user.id;
    let total = 0;
    let mensagem = null;
    const link = '/dashboard';

    if (perfil === 'vistoriador') {
      // Novas ocorrências PENDENTE (import ou devolvidas por outro vistoriador)
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM historico
          WHERE criado_em > ? AND status_novo = 'PENDENTE'
            AND (usuario_id IS NULL OR usuario_id != ?)`,
        [desde, userId]);
      total = Number(row.total);
      if (total > 0)
        mensagem = total === 1
          ? '1 nova ocorrência disponível para vistoria'
          : `${total} novas ocorrências disponíveis para vistoria`;

    } else if (perfil === 'analista') {
      // Novas ocorrências prontas para correção
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM historico
          WHERE criado_em > ? AND status_novo = 'AGUARDANDO CORRECAO'
            AND (usuario_id IS NULL OR usuario_id != ?)`,
        [desde, userId]);
      total = Number(row.total);
      if (total > 0)
        mensagem = total === 1
          ? '1 ocorrência aguardando correção'
          : `${total} ocorrências aguardando correção`;

    } else {
      // admin / gm: novas importações
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM historico
          WHERE criado_em > ? AND acao = 'IMPORTADA'`,
        [desde]);
      total = Number(row.total);
      if (total > 0)
        mensagem = total === 1
          ? '1 nova ocorrência importada'
          : `${total} novas ocorrências importadas`;
    }

    res.json({ total, mensagem, link });
  } catch (e) {
    console.error('[notificacoes]', e.message);
    res.json({ total: 0, mensagem: null, link: '/dashboard' });
  }
});

// Dados para o dropdown do sino (estado atual, por perfil)
router.get('/alertas', async (req, res) => {
  try {
    const perfil = req.user.perfil;
    let itens = [], total = 0, titulo = 'Notificações';

    if (perfil === 'analista') {
      const [rows] = await db.query(
        `SELECT id_ocorrencia, municipio, armario, afetacao, ta
           FROM ocorrencias
          WHERE status_tratativa = 'AGUARDANDO CORRECAO' AND status = 'ABERTO'
          ORDER BY assumida_em ASC
          LIMIT 15`);
      itens = rows; total = rows.length;
      titulo = 'Aguardando correção';

    } else if (perfil === 'vistoriador') {
      const [rows] = await db.query(
        `SELECT id_ocorrencia, municipio, armario, afetacao, ta
           FROM ocorrencias
          WHERE status_tratativa = 'PENDENTE' AND status = 'ABERTO'
          ORDER BY data_ocorrencia DESC
          LIMIT 15`);
      itens = rows; total = rows.length;
      titulo = 'Ocorrências pendentes';

    } else {
      // admin / gm — todas as ocorrências ainda ABERTAS, independente da etapa, mais recentes primeiro
      const [rows] = await db.query(
        `SELECT id_ocorrencia, municipio, armario, afetacao, ta
           FROM ocorrencias
          WHERE status = 'ABERTO'
          ORDER BY data_ocorrencia DESC
          LIMIT 50`);
      const [[cnt]] = await db.query(
        `SELECT COUNT(*) AS total FROM ocorrencias WHERE status = 'ABERTO'`);
      itens = rows; total = Number(cnt.total);
      titulo = 'Ocorrências pendentes';
    }

    res.json({ itens, total, titulo });
  } catch (e) {
    console.error('[notificacoes/alertas]', e.message);
    res.json({ itens: [], total: 0, titulo: 'Notificações' });
  }
});

module.exports = router;
