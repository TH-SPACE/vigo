'use strict';

const Ocorrencia  = require('../models/Ocorrencia');
const Vistoria    = require('../models/Vistoria');
const Correcao    = require('../models/Correcao');
const Tratativa   = require('../models/Tratativa');
const Causa       = require('../models/Causa');
const Checklist   = require('../models/Checklist');
const Foto        = require('../models/Foto');
const Historico   = require('../models/Historico');
const Auditoria   = require('../models/Auditoria');
const Observacao  = require('../models/Observacao');
const { processarFoto } = require('../middlewares/upload');

function flash(res, tipo, msg) {
  res.cookie('flash', JSON.stringify({ tipo, msg }), { httpOnly: false, maxAge: 10000 });
}

// Extrai respostas do checklist do corpo do form: resposta_<id> + obs_<id>
function lerChecklist(body, perguntas) {
  const respostas = [];
  for (const p of perguntas) {
    const r = body[`resposta_${p.id}`];
    if (r === 'SIM' || r === 'NAO') {
      respostas.push({ pergunta_id: p.id, resposta: r, observacao: body[`obs_${p.id}`] || null });
    } else if (p.obrigatoria) {
      respostas.push({ pergunta_id: p.id, resposta: 'NAO', observacao: body[`obs_${p.id}`] || null });
    }
  }
  return respostas;
}

const VISTORIA_FOTOS = [
  { campo: 'foto_causa',      rotulo: 'Foto da Causa' },
  { campo: 'foto_panoramica', rotulo: 'Foto Panorâmica' },
  { campo: 'foto_local',      rotulo: 'Foto do Local' },
];
const CORRECAO_FOTOS = [
  { campo: 'evidencia_1', rotulo: 'Evidência 1' },
  { campo: 'evidencia_2', rotulo: 'Evidência 2' },
  { campo: 'evidencia_3', rotulo: 'Evidência 3' },
];

async function processarCampos(files, defs, tipoPasta) {
  const out = [];
  for (const d of defs) {
    const arq = files?.[d.campo]?.[0];
    if (arq) out.push({ rotulo: d.rotulo, arquivo: await processarFoto(arq, tipoPasta) });
  }
  return out;
}

module.exports = {
  async detalhes(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.status(404).render('error', { titulo: 'Não encontrada', mensagem: 'Ocorrência inexistente.', code: 404 });

    const [vistoria, correcoes, tratativas, historico, observacoes] = await Promise.all([
      Vistoria.porOcorrencia(o.id_ocorrencia),
      Correcao.porOcorrencia(o.id_ocorrencia),
      Tratativa.porOcorrencia(o.id_ocorrencia),
      Historico.porOcorrencia(o.id_ocorrencia),
      Observacao.porOcorrencia(o.id_ocorrencia),
    ]);

    const vistoriaChecklist = vistoria ? await Checklist.respostasDe('vistoria', vistoria.id) : [];
    const vistoriaFotos = vistoria ? await Foto.listar('vistoria', vistoria.id) : [];

    for (const c of correcoes) {
      c.checklist = await Checklist.respostasDe('correcao', c.id);
      c.fotos = await Foto.listar('correcao', c.id);
    }

    const baseUrl = req.protocol + '://' + req.get('host');
    const afetacaoFmt = Number(o.afetacao || 0).toLocaleString('pt-BR');
    const ogDescParts = [`Afetados: ${afetacaoFmt}`];
    if (o.causa) ogDescParts.push(`Causa: ${o.causa}`);
    if (o.armario) ogDescParts.push(`Armário: ${o.armario}`);

    res.render('ocorrencias/detalhes', {
      titulo: `Ocorrência ${o.id_ocorrencia}`,
      o, vistoria, vistoriaChecklist, vistoriaFotos,
      ehManual: Number(o.id_ocorrencia) >= Ocorrencia.ID_MANUAL_MIN,
      correcoes, tratativas, historico, observacoes, perfil: req.user.perfil,
      ogTitle: `#${o.id_ocorrencia} · ${o.municipio || '—'} — Nova Ocorrência VIGO`,
      ogDesc:  ogDescParts.join(' · '),
      ogUrl:   `${baseUrl}/ocorrencias/${o.id_ocorrencia}`,
      ogImage: `${baseUrl}/icons/icon-512.png`,
    });
  },

  // ── Qualquer usuário logado: alternar ABERTO/FECHADO de ocorrência manual ──
  async alternarStatus(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');
    if (Number(o.id_ocorrencia) < Ocorrencia.ID_MANUAL_MIN) {
      flash(res, 'erro', 'Esta ocorrência veio da base importada — o status é atualizado automaticamente.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    const novo = o.status === 'ABERTO' ? 'FECHADO' : 'ABERTO';
    const alterado = await Ocorrencia.alternarStatus(o.id_ocorrencia);
    if (alterado) {
      await Historico.registrar({
        ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'STATUS ALTERADO',
        observacao: `Status alterado manualmente de ${o.status || '—'} para ${novo}.`,
      });
      await Auditoria.log(req, 'ALTEROU STATUS (MANUAL)', `Ocorrência #${o.id_ocorrencia} → ${novo}`);
      flash(res, 'ok', `Status alterado para ${novo}.`);
    }
    res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
  },

  // ── Vistoriador: assumir ──
  async assumir(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');
    if (o.status_tratativa !== 'PENDENTE') {
      flash(res, 'erro', 'Esta ocorrência não está mais pendente.');
      return res.redirect('/dashboard');
    }
    // A guarda atômica no UPDATE decide o "vencedor" quando dois vistoriadores
    // clicam quase ao mesmo tempo; quem perder recebe o aviso e volta à fila.
    const assumida = await Ocorrencia.assumir(o.id_ocorrencia, req.user.id);
    if (!assumida) {
      flash(res, 'erro', 'Outro supervisor assumiu esta ocorrência primeiro.');
      return res.redirect('/dashboard');
    }
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'ASSUMIU VISTORIA',
      status_anterior: 'PENDENTE', status_novo: 'VISTORIA SUPERVISOR',
    });
    await Auditoria.log(req, 'ASSUMIU OCORRÊNCIA', `Ocorrência #${o.id_ocorrencia}`);
    res.redirect(`/ocorrencias/${o.id_ocorrencia}/vistoria`);
  },

  // ── Vistoriador: devolver para a fila (assumiu sem querer) ──
  async devolver(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');

    // Só quem assumiu (ou admin) pode devolver, e só enquanto está em vistoria.
    const ehDono = o.vistoriador_id === req.user.id;
    if (req.user.perfil !== 'admin' && !ehDono) {
      flash(res, 'erro', 'Você não pode devolver esta ocorrência.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    if (o.status_tratativa !== 'VISTORIA SUPERVISOR') {
      flash(res, 'erro', 'Só é possível devolver enquanto a ocorrência está em vistoria.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }

    await Ocorrencia.devolverParaFila(o.id_ocorrencia);
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'DEVOLVEU PARA A FILA',
      status_anterior: 'VISTORIA SUPERVISOR', status_novo: 'PENDENTE',
      observacao: 'Ocorrência devolvida para a fila pelo vistoriador.',
    });
    await Auditoria.log(req, 'DEVOLVEU OCORRÊNCIA', `Ocorrência #${o.id_ocorrencia}`);
    flash(res, 'ok', `Ocorrência #${o.id_ocorrencia} devolvida para a fila.`);
    res.redirect('/dashboard');
  },

  async telaVistoria(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');

    const editando = o.status_tratativa === 'AGUARDANDO CORRECAO';
    const nova     = ['VISTORIA SUPERVISOR', 'PENDENTE'].includes(o.status_tratativa);
    if (!nova && !editando) {
      flash(res, 'erro', 'Vistoria não disponível para esta ocorrência.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    if (editando) {
      const ehDono = o.vistoriador_id === req.user.id;
      if (req.user.perfil !== 'admin' && !ehDono) {
        flash(res, 'erro', 'Apenas o supervisor que realizou a vistoria pode editá-la.');
        return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
      }
    }

    const [causas, perguntas] = await Promise.all([Causa.listar(true), Checklist.listar(true)]);
    let vistoria = null, respostas = [], fotosExistentes = {};
    if (editando) {
      vistoria = await Vistoria.porOcorrencia(o.id_ocorrencia);
      if (vistoria) {
        const [rs, fs] = await Promise.all([
          Checklist.respostasDe('vistoria', vistoria.id),
          Foto.listar('vistoria', vistoria.id),
        ]);
        respostas = rs;
        for (const f of fs) fotosExistentes[f.rotulo] = f.arquivo;
      }
    }
    res.render('ocorrencias/vistoria', {
      titulo: `${editando ? 'Editar' : ''} Vistoria — ${o.id_ocorrencia}`,
      o, causas, perguntas, fotos: VISTORIA_FOTOS,
      editando, vistoria, respostas, fotosExistentes,
    });
  },

  async salvarVistoria(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');

    const editando = o.status_tratativa === 'AGUARDANDO CORRECAO';
    const { causa_id, sugestao_correcao, correcao_definitiva } = req.body;

    if (!sugestao_correcao || !sugestao_correcao.trim()) {
      flash(res, 'erro', 'A sugestão de correção é obrigatória.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}/vistoria`);
    }

    const perguntas = await Checklist.listar(true);

    if (editando) {
      const ehDono = o.vistoriador_id === req.user.id;
      if (req.user.perfil !== 'admin' && !ehDono) {
        flash(res, 'erro', 'Sem permissão para editar esta vistoria.');
        return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
      }

      const vistoria = await Vistoria.porOcorrencia(o.id_ocorrencia);
      if (!vistoria) {
        flash(res, 'erro', 'Vistoria original não encontrada.');
        return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
      }

      await Vistoria.atualizar(vistoria.id, { causa_id, sugestao_correcao: sugestao_correcao.trim(), correcao_definitiva });

      await Checklist.limparRespostas('vistoria', vistoria.id);
      await Checklist.salvarRespostas('vistoria', vistoria.id, lerChecklist(req.body, perguntas));

      // Substitui apenas as fotos que o usuário enviou
      for (const d of VISTORIA_FOTOS) {
        const arq = req.files?.[d.campo]?.[0];
        if (arq) {
          const arquivo = await processarFoto(arq, 'vistorias');
          await Foto.substituirPorRotulo('vistoria', vistoria.id, d.rotulo, arquivo);
        }
      }

      await Historico.registrar({
        ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'VISTORIA EDITADA',
        status_anterior: 'AGUARDANDO CORRECAO', status_novo: 'AGUARDANDO CORRECAO',
        observacao: sugestao_correcao.trim(),
      });
      await Auditoria.log(req, 'VISTORIA EDITADA', `Ocorrência #${o.id_ocorrencia}`);

      flash(res, 'ok', 'Vistoria atualizada com sucesso.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }

    // Criação nova
    for (const d of VISTORIA_FOTOS) {
      if (!req.files?.[d.campo]?.[0]) {
        flash(res, 'erro', `Foto obrigatória ausente: ${d.rotulo}.`);
        return res.redirect(`/ocorrencias/${o.id_ocorrencia}/vistoria`);
      }
    }

    const vistoriaId = await Vistoria.criar({
      ocorrencia_id: o.id_ocorrencia, vistoriador_id: req.user.id,
      causa_id, sugestao_correcao: sugestao_correcao.trim(), correcao_definitiva,
    });

    await Checklist.salvarRespostas('vistoria', vistoriaId, lerChecklist(req.body, perguntas));
    await Foto.salvar('vistoria', vistoriaId, await processarCampos(req.files, VISTORIA_FOTOS, 'vistorias'));

    if (!o.vistoriador_id) await Ocorrencia.assumir(o.id_ocorrencia, req.user.id);

    await Ocorrencia.mudarStatusTratativa(o.id_ocorrencia, 'AGUARDANDO CORRECAO');
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'VISTORIA CONCLUÍDA',
      status_anterior: o.status_tratativa, status_novo: 'AGUARDANDO CORRECAO',
      observacao: sugestao_correcao.trim(),
    });
    await Auditoria.log(req, 'VISTORIA CONCLUÍDA', `Ocorrência #${o.id_ocorrencia}`);

    flash(res, 'ok', 'Vistoria registrada! Ocorrência enviada para correção.');
    res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
  },

  // ── Analista: tratativa (não altera status) ──
  async tratativa(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');
    const { observacao } = req.body;
    if (!observacao || !observacao.trim()) {
      flash(res, 'erro', 'Informe a observação da tratativa.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    await Tratativa.criar({ ocorrencia_id: o.id_ocorrencia, usuario_id: req.user.id, observacao: observacao.trim() });
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'TRATATIVA', observacao: observacao.trim(),
    });
    await Auditoria.log(req, 'TRATATIVA', `Ocorrência #${o.id_ocorrencia}`);
    flash(res, 'ok', 'Tratativa registrada.');
    res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
  },

  async telaCorrecao(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');
    if (o.status_tratativa !== 'AGUARDANDO CORRECAO') {
      flash(res, 'erro', 'Correção não disponível para esta ocorrência.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    const perguntas = await Checklist.listar(true);
    res.render('ocorrencias/correcao', { titulo: `Correção — ${o.id_ocorrencia}`, o, perguntas, fotos: CORRECAO_FOTOS });
  },

  async salvarCorrecao(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) return res.redirect('/dashboard');
    if (o.status_tratativa !== 'AGUARDANDO CORRECAO') {
      flash(res, 'erro', 'Correção não disponível.');
      return res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
    }
    for (const d of CORRECAO_FOTOS) {
      if (!req.files?.[d.campo]?.[0]) {
        flash(res, 'erro', `Foto obrigatória ausente: ${d.rotulo}.`);
        return res.redirect(`/ocorrencias/${o.id_ocorrencia}/correcao`);
      }
    }

    const correcaoId = await Correcao.criar({
      ocorrencia_id: o.id_ocorrencia, analista_id: req.user.id, observacao: req.body.observacao,
    });
    const perguntas = await Checklist.listar(true);
    await Checklist.salvarRespostas('correcao', correcaoId, lerChecklist(req.body, perguntas));
    await Foto.salvar('correcao', correcaoId, await processarCampos(req.files, CORRECAO_FOTOS, 'correcoes'));

    await Ocorrencia.mudarStatusTratativa(o.id_ocorrencia, 'CORRECAO ENVIADA', { analista_id: req.user.id });
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'CORREÇÃO ENVIADA',
      status_anterior: 'AGUARDANDO CORRECAO', status_novo: 'CORRECAO ENVIADA',
      observacao: req.body.observacao || null,
    });
    await Auditoria.log(req, 'CORREÇÃO ENVIADA', `Ocorrência #${o.id_ocorrencia}`);

    flash(res, 'ok', 'Correção enviada com sucesso!');
    res.redirect(`/ocorrencias/${o.id_ocorrencia}`);
  },
};
