'use strict';

const XLSX       = require('xlsx');
const Usuario    = require('../models/Usuario');
const Config     = require('../models/Config');
const Causa      = require('../models/Causa');
const Checklist  = require('../models/Checklist');
const Ocorrencia = require('../models/Ocorrencia');
const Observacao = require('../models/Observacao');
const Vistoria   = require('../models/Vistoria');
const Foto       = require('../models/Foto');
const Historico  = require('../models/Historico');
const Auditoria  = require('../models/Auditoria');
const { importarAgora, importarObservacoesAgora, importarReportsAgora } = require('../services/scheduler');
const { enviarResumoDiario } = require('../services/resumoDiario');
const { enviarReport: enviarReportAbertos } = require('../services/reportAbertos');
const { fetchComTimeout } = require('../services/net');
const db = require('../database/connection');
const Report = require('../models/ReportOcorrencia');
const reportEmpresas = require('../services/reportEmpresas');

const PERFIL_ID = { admin: 1, gm: 2, vistoriador: 3, analista: 4 };

function flash(res, tipo, msg) {
  res.cookie('flash', JSON.stringify({ tipo, msg }), { httpOnly: false, maxAge: 12000 });
}
const ehAdmin = req => req.user.perfil === 'admin';

// "2026-07-14 08:42:55" no horário de Brasília, no mesmo formato que o banco
// guarda em data_ocorrencia (sem fuso). toISOString() não serve aqui: devolve
// UTC, que gravado como se fosse local adianta a ocorrência em 3h.
const FMT_BRASILIA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function agoraBrasilia() {
  return FMT_BRASILIA.format(new Date());
}

// Envia uma ocorrência (já escolhida pelo chamador) no formato de "nova ocorrência",
// usado tanto pelo teste padrão quanto pelo teste filtrado por status ABERTO.
async function enviarTesteNovaOcorrencia(req, res, o, mensagemVazia) {
  const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
  const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!webhookUrl) {
    flash(res, 'erro', 'WHATSAPP_WEBHOOK_URL não configurado no .env.');
    return res.redirect('/admin/whatsapp');
  }
  if (!o) {
    flash(res, 'erro', mensagemVazia);
    return res.redirect('/admin/whatsapp');
  }
  try {
    const r = await fetchComTimeout(webhookUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify({
        ocorrencias: [{
          id_ocorrencia:     o.id_ocorrencia,
          municipio:         o.municipio,
          empresa:           o.empresa,
          status:            o.status,
          armario:           o.armario,
          ta:                o.ta,
          cluster:           o.cluster,
          afetacao:          o.afetacao,
          causa:             o.causa,
          logradouro:        o.logradouro,
          numero_logradouro: o.numero_logradouro,
          bairro:            o.bairro,
          data_ocorrencia:   o.data_ocorrencia,
        }],
      }),
    }, 15000);
    const d = await r.json();
    if (d.reason === 'no_group_configured') {
      flash(res, 'erro', 'Grupo WhatsApp não configurado. Acesse o dashboard do reportb2b e configure o grupo "VIGO · Nova Ocorrência".');
    } else {
      flash(res, 'ok', `Mensagem de teste enviada! Ocorrência #${o.id_ocorrencia} (${o.municipio || '—'})`);
      await Auditoria.log(req, 'TESTE WHATSAPP', `Ocorrência #${o.id_ocorrencia}`);
    }
  } catch (e) {
    flash(res, 'erro', 'Falha ao enviar para o WhatsApp: ' + e.message);
  }
  res.redirect('/admin/whatsapp');
}

module.exports = {
  // ───────────────────────── Painel Admin (hub) ─────────────────────────
  async hub(req, res) {
    const [usuarios, causas, checklist, metricas, auditTotal, baseContagem] = await Promise.all([
      Usuario.findAll(),
      Causa.listar(),
      Checklist.listar(),
      Ocorrencia.metricas(),
      Auditoria.total(),
      Ocorrencia.contarBase(),
    ]);
    res.render('admin/index', {
      titulo: 'Administração',
      isAdmin: ehAdmin(req),
      contadores: {
        usuarios: usuarios.length,
        causas: causas.length,
        checklist: checklist.length,
        ativas: metricas.ativas,
        auditoria: auditTotal,
        total: baseContagem.total,
      },
    });
  },

  // ───────────────────────── Auditoria ─────────────────────────
  async auditoria(req, res) {
    const filtros = { acao: req.query.acao || '', busca: (req.query.busca || '').trim() };
    const [registros, acoes, total, retencao] = await Promise.all([
      Auditoria.listar({ acao: filtros.acao || null, busca: filtros.busca || null, limit: 300 }),
      Auditoria.acoesDistintas(),
      Auditoria.total(),
      Config.get('auditoria_retencao_dias', '15'),
    ]);
    res.render('admin/auditoria', {
      titulo: 'Auditoria', registros, acoes, filtros, total,
      retencao: isNaN(parseInt(retencao, 10)) ? 15 : parseInt(retencao, 10),
    });
  },

  async salvarRetencaoAuditoria(req, res) {
    let dias = parseInt(req.body.retencao, 10);
    if (isNaN(dias) || dias < 0) dias = 0;
    if (dias > 365) dias = 365;
    await Config.set('auditoria_retencao_dias', String(dias));
    await Auditoria.log(req, 'CONFIG AUDITORIA', `Retenção definida para ${dias} dias`);
    flash(res, 'ok', `Retenção da auditoria definida para ${dias} dias.`);
    res.redirect('/admin/auditoria');
  },

  async limparAuditoria(req, res) {
    const diasRaw = parseInt(await Config.get('auditoria_retencao_dias', '15'), 10);
    const dias = isNaN(diasRaw) ? 15 : diasRaw;
    const apagados = await Auditoria.limparAntigas(dias);
    flash(res, 'ok', `Limpeza concluída: ${apagados} registro(s) com mais de ${dias} dias removido(s).`);
    res.redirect('/admin/auditoria');
  },

  // ───────────────────────── Usuários ─────────────────────────
  async usuarios(req, res) {
    const usuarios = await Usuario.findAll();
    res.render('admin/usuarios', { titulo: 'Usuários', usuarios });
  },

  async criarUsuario(req, res) {
    try {
      const { nome, email, matricula, cluster, perfil } = req.body;
      if (!nome || !email) { flash(res, 'erro', 'Nome e e-mail são obrigatórios.'); return res.redirect('/admin/usuarios'); }
      if (await Usuario.emailExiste(email.trim().toLowerCase())) {
        flash(res, 'erro', 'Já existe usuário com este e-mail.'); return res.redirect('/admin/usuarios');
      }
      await Usuario.create({
        nome: nome.trim(), email: email.trim().toLowerCase(), matricula: matricula?.trim() || null,
        cluster: cluster || 'GOIANIA', perfil_id: PERFIL_ID[perfil] || 3,
      });
      await Auditoria.log(req, 'CRIOU USUÁRIO', email.trim().toLowerCase());
      flash(res, 'ok', `Usuário criado. Senha inicial: ${Usuario.senhaInicialDeMatricula(matricula)}`);
    } catch (e) { flash(res, 'erro', 'Erro ao criar usuário: ' + e.message); }
    res.redirect('/admin/usuarios');
  },

  async criarUsuariosMassa(req, res) {
    try {
      if (!req.file) { flash(res, 'erro', 'Envie uma planilha.'); return res.redirect('/admin/usuarios'); }
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      let criados = 0, pulados = 0;
      for (const l of linhas) {
        const nome = l.Nome || l.nome, email = (l.Email || l.email || '').toString().trim().toLowerCase();
        const matricula = (l.Matricula || l.matricula || '').toString().trim();
        const cluster = (l.Cluster || l.cluster || 'GOIANIA').toString().trim();
        if (!nome || !email || await Usuario.emailExiste(email)) { pulados++; continue; }
        await Usuario.create({ nome, email, matricula: matricula || null, cluster, perfil_id: 3 });
        criados++;
      }
      await Auditoria.log(req, 'IMPORTOU USUÁRIOS', `${criados} criados, ${pulados} ignorados`);
      flash(res, 'ok', `Importação concluída: ${criados} criados, ${pulados} ignorados.`);
    } catch (e) { flash(res, 'erro', 'Erro na planilha: ' + e.message); }
    res.redirect('/admin/usuarios');
  },

  async editarUsuario(req, res) {
    try {
      const { nome, email, matricula, cluster, perfil } = req.body;
      await Usuario.atualizar(req.params.id, {
        nome, email: email.trim().toLowerCase(), matricula: matricula?.trim() || null,
        cluster, perfil_id: PERFIL_ID[perfil] || 3,
      });
      await Auditoria.log(req, 'EDITOU USUÁRIO', `#${req.params.id} ${(email || '').trim().toLowerCase()}`);
      flash(res, 'ok', 'Usuário atualizado.');
    } catch (e) { flash(res, 'erro', 'Erro: ' + e.message); }
    res.redirect('/admin/usuarios');
  },

  async alterarStatusUsuario(req, res) {
    const novo = req.body.status === 'ativo' ? 'ativo' : 'inativo';
    await Usuario.alterarStatus(req.params.id, novo);
    await Auditoria.log(req, 'ALTEROU STATUS DE USUÁRIO', `#${req.params.id} → ${novo}`);
    flash(res, 'ok', 'Status do usuário atualizado.');
    res.redirect('/admin/usuarios');
  },

  async resetarSenhaUsuario(req, res) {
    const u = await Usuario.findById(req.params.id);
    if (!u) { flash(res, 'erro', 'Usuário não encontrado.'); return res.redirect('/admin/usuarios'); }
    const senha = await Usuario.resetarSenha(u.id, u.matricula);
    await Auditoria.log(req, 'RESETOU SENHA', `Usuário #${u.id} ${u.email}`);
    flash(res, 'ok', `Senha redefinida para: ${senha} (troca obrigatória no próximo login).`);
    res.redirect('/admin/usuarios');
  },

  // ───────────────────────── Gerenciamento da base ────────────
  async base(req, res) {
    const contadores = await Ocorrencia.contarBase();
    res.render('admin/base', { titulo: 'Gerenciamento da Base', contadores });
  },

  async limparBase(req, res) {
    const tipo = req.body.tipo;
    if (tipo === 'tudo' && req.body.confirmar !== 'APAGAR') {
      flash(res, 'erro', 'Para apagar tudo, você deve digitar APAGAR no campo de confirmação.');
      return res.redirect('/admin/base');
    }
    if (!['encerradas','tudo'].includes(tipo)) return res.redirect('/admin/base');
    const qtd = await Ocorrencia.limparBase(tipo);
    await Auditoria.log(req, 'LIMPEZA DE BASE',
      tipo === 'tudo' ? `Apagou TODAS as ocorrências (${qtd} registros)` : `Apagou encerradas (${qtd} registros)`);
    flash(res, 'ok', `${qtd} ocorrência(s) apagada(s) com sucesso.`);
    res.redirect('/admin/base');
  },

  // ───────────────────────── Configuração ─────────────────────
  async config(req, res) {
    const cfg = await Config.getAll();
    res.render('admin/config', { titulo: 'Configuração de Importação', cfg });
  },

  async salvarConfig(req, res) {
    const campos = ['import_url','intervalo_minimo','intervalo_maximo','afetacao_minima',
                    'data_minima_ocorrencia',
                    'empresas_permitidas','clusters_permitidos','status_permitidos','import_ativo',
                    'import_observacoes_url'];
    const dados = {};
    for (const c of campos) if (req.body[c] !== undefined) dados[c] = req.body[c];
    dados.import_ativo                    = req.body.import_ativo                    ? '1' : '0';
    dados.import_observacoes_ativo        = req.body.import_observacoes_ativo        ? '1' : '0';
    dados.autocadastro_ativo              = req.body.autocadastro_ativo              ? '1' : '0';
    await Config.setMany(dados);
    await Auditoria.log(req, 'SALVOU CONFIGURAÇÃO', 'Configuração de importação');
    flash(res, 'ok', 'Configurações salvas.');
    res.redirect('/admin/config');
  },

  // ───────────────────────── WhatsApp ─────────────────────────
  async whatsapp(req, res) {
    const cfg = await Config.getAll();
    res.render('admin/whatsapp', { titulo: 'WhatsApp', cfg });
  },

  async salvarWhatsapp(req, res) {
    const campos = ['whatsapp_resumo_hora', 'whatsapp_report_abertos_intervalo'];
    const dados = {};
    for (const c of campos) if (req.body[c] !== undefined) dados[c] = req.body[c];
    dados.whatsapp_notificacao_nova_ativo = req.body.whatsapp_notificacao_nova_ativo ? '1' : '0';
    dados.whatsapp_notificacao_cancelada_ativo = req.body.whatsapp_notificacao_cancelada_ativo ? '1' : '0';
    dados.whatsapp_resumo_ativo           = req.body.whatsapp_resumo_ativo           ? '1' : '0';
    dados.whatsapp_report_abertos_ativo   = req.body.whatsapp_report_abertos_ativo   ? '1' : '0';
    // dias marcados chegam como array; converte para string CSV
    const diasArr = Array.isArray(req.body.whatsapp_resumo_dias)
      ? req.body.whatsapp_resumo_dias
      : (req.body.whatsapp_resumo_dias ? [req.body.whatsapp_resumo_dias] : []);
    dados.whatsapp_resumo_dias = diasArr.join(',');
    await Config.setMany(dados);
    await Auditoria.log(req, 'SALVOU CONFIGURAÇÃO', 'WhatsApp');
    flash(res, 'ok', 'Configurações de WhatsApp salvas.');
    res.redirect('/admin/whatsapp');
  },

  // ─────────────── Reports por Empresa (módulo separado do VIGO) ───────────────
  async reportsEmpresas(req, res) {
    const cfg = await Config.getAll();
    const nomes = await Config.getLista('rep_empresas');
    const [resumo, total, pendentes] = await Promise.all([
      Report.resumoPorEmpresa(nomes),
      Report.total(),
      Report.pendentesTotal(),
    ]);
    const porNome = new Map(resumo.map(r => [String(r.empresa).toUpperCase(), r]));

    const empresas = nomes.map(nome => {
      const slug = reportEmpresas.slugEmpresa(nome);
      const r = porNome.get(nome) || {};
      return {
        nome, slug,
        target:  reportEmpresas.targetDe(nome),
        ativo:   String(cfg[`rep_empresa_${slug}_ativo`] ?? '1') === '1',
        total:   Number(r.total || 0),
        abertas: Number(r.abertas || 0),
      };
    });

    res.render('admin/reports-empresas', {
      titulo: 'Reports por Empresa', cfg, empresas, totalBase: total, pendentes,
    });
  },

  async salvarReportsEmpresas(req, res) {
    const texto = ['rep_import_url', 'rep_intervalo_minimo', 'rep_intervalo_maximo',
                   'rep_empresas', 'rep_clusters_permitidos', 'rep_status_permitidos',
                   'rep_afetacao_minima', 'rep_data_minima',
                   'rep_escalada_faixa1_horas', 'rep_escalada_faixa1_intervalo',
                   'rep_escalada_faixa2_horas', 'rep_escalada_faixa2_intervalo'];
    const dados = {};
    for (const c of texto) if (req.body[c] !== undefined) dados[c] = req.body[c];

    dados.rep_ativo                  = req.body.rep_ativo                  ? '1' : '0';
    dados.rep_notificacao_ativa      = req.body.rep_notificacao_ativa      ? '1' : '0';
    dados.rep_escalada_ativa         = req.body.rep_escalada_ativa         ? '1' : '0';
    dados.rep_escalada_faixa1_ativa  = req.body.rep_escalada_faixa1_ativa  ? '1' : '0';
    dados.rep_escalada_faixa2_ativa  = req.body.rep_escalada_faixa2_ativa  ? '1' : '0';

    const diasArr = Array.isArray(req.body.rep_escalada_dias)
      ? req.body.rep_escalada_dias
      : (req.body.rep_escalada_dias ? [req.body.rep_escalada_dias] : []);
    dados.rep_escalada_dias = diasArr.join(',');

    // Toggle de cada empresa. A lista de empresas é editável, então o toggle é
    // derivado do que foi salvo agora — não do que existia antes.
    const empresas = String(dados.rep_empresas ?? await Config.get('rep_empresas', ''))
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const marcadas = Array.isArray(req.body.empresas_ativas)
      ? req.body.empresas_ativas
      : (req.body.empresas_ativas ? [req.body.empresas_ativas] : []);
    for (const e of empresas) {
      const slug = reportEmpresas.slugEmpresa(e);
      dados[`rep_empresa_${slug}_ativo`] = marcadas.includes(slug) ? '1' : '0';
    }

    // Ligar o módulo significa "começar do zero a partir de agora": re-arma o
    // backfill, então a 1ª importação depois disso carrega o período em que ele
    // ficou parado SEM notificar. Sem isto, religar após dias desligado despejaria
    // todas as ocorrências acumuladas no grupo de uma só vez.
    const estavaDesligado = String(await Config.get('rep_ativo', '0')) !== '1';
    const vaiLigar = dados.rep_ativo === '1';
    if (estavaDesligado && vaiLigar) dados.rep_backfill_feito = '0';

    await Config.setMany(dados);
    await Auditoria.log(req, 'SALVOU CONFIGURAÇÃO', 'Reports por Empresa');
    flash(res, 'ok', estavaDesligado && vaiLigar
      ? 'Módulo ligado. A próxima importação carrega a base sem notificar — só o que entrar depois dela vira mensagem.'
      : 'Configurações do módulo de reports salvas.');
    res.redirect('/admin/reports-empresas');
  },

  async reportsImportarAgora(req, res) {
    try {
      const r = await importarReportsAgora();
      await Auditoria.log(req, 'IMPORTAÇÃO REPORTS', r.resultado);
      flash(res, 'ok', `Importação concluída: ${r.resultado}.` +
        (r.notificadas ? ` ${r.notificadas} notificação(ões) enviada(s).` : ''));
    } catch (e) { flash(res, 'erro', 'Falha na importação: ' + e.message); }
    res.redirect('/admin/reports-empresas');
  },

  // Silencia a base atual: carimba tudo como já avisado, sem enviar nada. Use
  // depois de limpar/recarregar a tabela, senão ligar o módulo dispararia uma
  // mensagem para cada ocorrência que voltou sem carimbo.
  async reportsMarcarAvisadas(req, res) {
    try {
      const n = await Report.marcarTudoComoAvisado(reportEmpresas.agoraBrasilia());
      await Auditoria.log(req, 'REPORTS SILENCIAR BASE', `${n} ocorrência(s) marcadas como avisadas`);
      flash(res, 'ok', `${n} ocorrência(s) marcadas como já avisadas. Só o que entrar a partir de agora gera mensagem.`);
    } catch (e) { flash(res, 'erro', 'Falha ao marcar: ' + e.message); }
    res.redirect('/admin/reports-empresas');
  },

  // Manda uma ocorrência real da empresa (ou uma mensagem de sonda, se não houver
  // nenhuma aberta) para o grupo dela — serve para validar o cadastro do grupo.
  async reportsTestar(req, res) {
    const empresa = String(req.params.empresa || '').toUpperCase();
    try {
      const permitidas = await Config.getLista('rep_empresas');
      if (!permitidas.includes(empresa)) throw new Error(`Empresa "${empresa}" não está na lista do módulo.`);

      const o = await Report.umaAberta(empresa);
      const texto = o
        ? reportEmpresas.msgNova(o)
        : `🧪 *Teste — ${empresa}*\n\nGrupo configurado corretamente.\nNenhuma ocorrência ABERTA no momento para esta empresa.`;

      await reportEmpresas.enviarTexto(empresa, texto);
      await Auditoria.log(req, 'TESTE REPORT EMPRESA', empresa);
      flash(res, 'ok', `Mensagem de teste enviada para o grupo da ${empresa}.`);
    } catch (e) { flash(res, 'erro', `Falha no teste (${empresa}): ${e.message}`); }
    res.redirect('/admin/reports-empresas');
  },

  async importarAgora(req, res) {
    try {
      const r = await importarAgora(req.user);
      await Auditoria.log(req, 'IMPORTAÇÃO MANUAL', `${r.inseridos} novas, ${r.atualizados} atualizadas`);
      flash(res, 'ok', `Importação concluída: ${r.inseridos} novas, ${r.atualizados} atualizadas.`);
    } catch (e) { flash(res, 'erro', 'Falha na importação: ' + e.message); }
    res.redirect('/admin/config');
  },

  async importarObservacoesAgora(req, res) {
    try {
      const r = await importarObservacoesAgora();
      await Auditoria.log(req, 'IMPORTAÇÃO OBSERVAÇÕES', `filtradas=${r.filtradas} inseridas=${r.inseridas}`);
      flash(res, 'ok', `Observações importadas: ${r.inseridas} registros de ${r.filtradas} filtrados.`);
    } catch (e) { flash(res, 'erro', 'Falha ao importar observações: ' + e.message); }
    res.redirect('/admin/config');
  },

  async whatsappResumoAgora(req, res) {
    try {
      const d = await enviarResumoDiario();
      if (d?.reason === 'no_group_configured') {
        flash(res, 'erro', 'Grupo WhatsApp não configurado. Configure o grupo "VIGO · Ocorrências" no dashboard do reportb2b.');
      } else {
        flash(res, 'ok', 'Resumo diário enviado para o WhatsApp.');
        await Auditoria.log(req, 'RESUMO WHATSAPP', 'Envio manual do resumo diário');
      }
    } catch (e) { flash(res, 'erro', 'Falha ao enviar resumo: ' + e.message); }
    res.redirect('/admin/whatsapp');
  },

  async reportAbertosAgora(req, res) {
    try {
      const d = await enviarReportAbertos();
      if (d?.reason === 'no_group_configured') {
        flash(res, 'erro', 'Grupo WhatsApp não configurado. Configure o grupo "VIGO · Ocorrências" no dashboard do reportb2b.');
      } else {
        flash(res, 'ok', 'Report de ocorrências abertas enviado para o WhatsApp.');
        await Auditoria.log(req, 'REPORT ABERTOS WHATSAPP', 'Envio manual');
      }
    } catch (e) { flash(res, 'erro', 'Falha ao enviar report: ' + e.message); }
    res.redirect('/admin/whatsapp');
  },

  async analytics(req, res) {
    const dados = await Ocorrencia.analytics();
    res.render('admin/analytics', { titulo: 'Analytics', dados });
  },

  async exportarBase(req, res) {
    const [rows] = await db.query(`SELECT * FROM ocorrencias ORDER BY data_ocorrencia DESC`);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ocorrências');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `vger_base_${agoraBrasilia().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  },

  async whatsappTeste(req, res) {
    await enviarTesteNovaOcorrencia(req, res, await Ocorrencia.ultimaPorDataOcorrencia(), 'Nenhuma ocorrência encontrada na base.');
  },

  async whatsappTesteAberta(req, res) {
    await enviarTesteNovaOcorrencia(req, res, await Ocorrencia.ultimaAbertaPorDataOcorrencia(), 'Nenhuma ocorrência com status ABERTO encontrada.');
  },

  // ───────────────────────── Causas ───────────────────────────
  async causas(req, res) {
    res.render('admin/causas', { titulo: 'Causas', causas: await Causa.listar() });
  },
  async criarCausa(req, res) {
    if (req.body.nome?.trim()) await Causa.criar(req.body.nome.trim());
    flash(res, 'ok', 'Causa salva.'); res.redirect('/admin/causas');
  },
  async editarCausa(req, res) {
    await Causa.atualizar(req.params.id, { nome: req.body.nome.trim(), ativo: req.body.ativo ? 1 : 0 });
    flash(res, 'ok', 'Causa atualizada.'); res.redirect('/admin/causas');
  },
  async excluirCausa(req, res) {
    if (!ehAdmin(req)) { flash(res, 'erro', 'Apenas Admin pode excluir.'); return res.redirect('/admin/causas'); }
    await Causa.excluir(req.params.id);
    await Auditoria.log(req, 'EXCLUIU CAUSA', `#${req.params.id}`);
    flash(res, 'ok', 'Causa excluída.'); res.redirect('/admin/causas');
  },

  // ───────────────────────── Checklist ────────────────────────
  async checklist(req, res) {
    res.render('admin/checklist', { titulo: 'Checklist', perguntas: await Checklist.listar() });
  },
  async criarPergunta(req, res) {
    if (req.body.pergunta?.trim()) await Checklist.criar({
      pergunta: req.body.pergunta.trim(), obrigatoria: req.body.obrigatoria ? 1 : 0, ordem: parseInt(req.body.ordem) || 0,
    });
    flash(res, 'ok', 'Pergunta salva.'); res.redirect('/admin/checklist');
  },
  async editarPergunta(req, res) {
    await Checklist.atualizar(req.params.id, {
      pergunta: req.body.pergunta.trim(), ativo: req.body.ativo ? 1 : 0,
      obrigatoria: req.body.obrigatoria ? 1 : 0, ordem: parseInt(req.body.ordem) || 0,
    });
    flash(res, 'ok', 'Pergunta atualizada.'); res.redirect('/admin/checklist');
  },
  async excluirPergunta(req, res) {
    if (!ehAdmin(req)) { flash(res, 'erro', 'Apenas Admin pode excluir.'); return res.redirect('/admin/checklist'); }
    if (await Checklist.possuiRespostas(req.params.id)) {
      // Força a exclusão mesmo com respostas de vistorias/correções já
      // registradas: apaga a pergunta e as respostas vinculadas (irreversível).
      const removidas = await Checklist.excluirComRespostas(req.params.id);
      await Auditoria.log(req, 'EXCLUIU PERGUNTA (FORÇADO)', `#${req.params.id} + ${removidas} resposta(s) vinculada(s) removida(s)`);
      flash(res, 'ok', `Pergunta excluída junto com ${removidas} resposta(s) de vistorias/correções que já haviam sido registradas.`);
      return res.redirect('/admin/checklist');
    }
    await Checklist.excluir(req.params.id);
    await Auditoria.log(req, 'EXCLUIU PERGUNTA', `#${req.params.id}`);
    flash(res, 'ok', 'Pergunta excluída.'); res.redirect('/admin/checklist');
  },

  // ───────────────────────── Ocorrências ──────────────────────
  async ocorrencias(req, res) {
    const dmStr = await Config.get('data_minima_ocorrencia', '');
    const data_minima = dmStr && /^\d{4}-\d{2}-\d{2}$/.test(dmStr) ? dmStr : undefined;
    const filtros = {
      busca: (req.query.busca || '').trim(),
      status_tratativa: req.query.status_tratativa || '',
      cluster: req.query.cluster || '', empresa: req.query.empresa || '',
      data_minima,
      limit: 500,
    };
    const ocorrencias = await Ocorrencia.listar(filtros);
    res.render('admin/ocorrencias', {
      titulo: 'Gestão de Ocorrências', ocorrencias, filtros,
      clusters: await Ocorrencia.distintos('cluster'),
      empresas: await Ocorrencia.distintos('empresa'),
    });
  },

  // Ocorrência avulsa, digitada manualmente (ex.: TA aberta que ainda não caiu
  // na base TXT importada da Vivo). Ganha um id_ocorrencia placeholder — ver
  // Ocorrencia.proximoIdManual — para não colidir com uma importação futura.
  async criarOcorrenciaManual(req, res) {
    try {
      const {
        ta, armario, municipio, uf, cluster, empresa, status, sub_status,
        tipo_servico, fluxo, afetacao, data_ocorrencia, observacao, observacao_usuario,
      } = req.body;

      if (!armario?.trim() && !ta?.trim()) {
        flash(res, 'erro', 'Informe ao menos o Armário ou a TA.');
        return res.redirect('/admin/ocorrencias');
      }

      const m = String(data_ocorrencia || '').trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      const dataOc = m ? `${m[1]} ${m[2]}:00` : agoraBrasilia();

      const id = await Ocorrencia.criarManual({
        armario:      armario?.trim() || null,
        municipio:    municipio?.trim().toUpperCase() || null,
        uf:           uf?.trim().toUpperCase() || null,
        cluster:      (cluster || 'GOIANIA').trim().toUpperCase(),
        empresa:      empresa?.trim().toUpperCase() || null,
        status:       status || 'ABERTO',
        sub_status:   sub_status?.trim() || null,
        tipo_servico: tipo_servico?.trim() || null,
        fluxo:        fluxo?.trim() || null,
        ta:           ta?.trim() || null,
        afetacao:     parseInt(afetacao, 10) || 0,
        data_ocorrencia: dataOc,
      });

      await Historico.registrar({
        ocorrencia_id: id, usuario: req.user, acao: 'CRIADA_MANUAL', status_novo: 'PENDENTE',
        observacao: `Ocorrência cadastrada manualmente pelo painel admin (TA ${ta?.trim() || '—'}, ${armario?.trim() || municipio?.trim() || '—'}).`,
      });

      if (observacao?.trim()) {
        await Observacao.adicionar(id, observacao.trim(), observacao_usuario?.trim() || req.user.nome, dataOc);
      }

      // Notificação de nova ocorrência no WhatsApp (mesmo formato do importador).
      // Só na criação — o report recorrente de abertas ignora as manuais.
      const notifNovaAtiva = String(await Config.get('whatsapp_notificacao_nova_ativo', '1')) === '1';
      const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
      const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
      if (notifNovaAtiva && webhookUrl) {
        fetchComTimeout(webhookUrl, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
          },
          body: JSON.stringify({
            ocorrencias: [{
              id_ocorrencia:     id,
              municipio:         municipio?.trim().toUpperCase() || null,
              empresa:           empresa?.trim().toUpperCase() || null,
              status:            status || 'ABERTO',
              armario:           armario?.trim() || null,
              ta:                ta?.trim() || null,
              cluster:           (cluster || 'GOIANIA').trim().toUpperCase(),
              afetacao:          parseInt(afetacao, 10) || 0,
              causa:             null,
              logradouro:        null,
              numero_logradouro: null,
              bairro:            null,
              data_ocorrencia:   dataOc,
            }],
          }),
        }, 15000).catch(e => console.warn('[WhatsApp] Falha ao notificar ocorrência manual:', e.message));
      }

      await Auditoria.log(req, 'CRIOU OCORRÊNCIA MANUAL', `Ocorrência #${id} (TA ${ta?.trim() || '—'})`);
      flash(res, 'ok', `Ocorrência #${id} criada manualmente.`);
    } catch (e) {
      flash(res, 'erro', 'Erro ao criar ocorrência: ' + e.message);
    }
    res.redirect('/admin/ocorrencias');
  },

  async cancelarOcorrencia(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (o) {
      await Ocorrencia.mudarStatusTratativa(o.id_ocorrencia, 'CANCELADA');
      await Historico.registrar({
        ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'CANCELADA',
        status_anterior: o.status_tratativa, status_novo: 'CANCELADA',
      });
      await Auditoria.log(req, 'CANCELOU OCORRÊNCIA', `Ocorrência #${o.id_ocorrencia}`);
      flash(res, 'ok', 'Ocorrência cancelada.');
    }
    res.redirect('/admin/ocorrencias');
  },

  async encerrarOcorrencia(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (o) {
      await Ocorrencia.mudarStatusTratativa(o.id_ocorrencia, 'CORRECAO ENVIADA');
      await Historico.registrar({
        ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'ENCERRADA PELO ADMIN',
        status_anterior: o.status_tratativa, status_novo: 'CORRECAO ENVIADA',
      });
      await Auditoria.log(req, 'ENCERROU OCORRÊNCIA', `Ocorrência #${o.id_ocorrencia}`);
      flash(res, 'ok', 'Ocorrência encerrada como Correção Enviada.');
    }
    res.redirect('/admin/ocorrencias');
  },

  async resetarVistoria(req, res) {
    const o = await Ocorrencia.buscarPorId(req.params.id);
    if (!o) { flash(res, 'erro', 'Ocorrência não encontrada.'); return res.redirect('/admin/ocorrencias'); }

    const vistoria = await Vistoria.porOcorrencia(o.id_ocorrencia);
    if (vistoria) {
      await Checklist.limparRespostas('vistoria', vistoria.id);
      await Foto.deletarDe('vistoria', vistoria.id);
      await Vistoria.deletar(vistoria.id);
    }

    await Ocorrencia.devolverParaFila(o.id_ocorrencia);
    await Historico.registrar({
      ocorrencia_id: o.id_ocorrencia, usuario: req.user, acao: 'VISTORIA RESETADA',
      status_anterior: o.status_tratativa, status_novo: 'PENDENTE',
      observacao: 'Vistoria apagada pelo admin. Ocorrência devolvida à fila.',
    });
    await Auditoria.log(req, 'RESETOU VISTORIA', `Ocorrência #${o.id_ocorrencia}`);
    flash(res, 'ok', 'Vistoria apagada. Ocorrência devolvida à fila (PENDENTE) para qualquer supervisor assumir.');
    res.redirect('/admin/ocorrencias');
  },

  async excluirOcorrencia(req, res) {
    if (!ehAdmin(req)) { flash(res, 'erro', 'Apenas Admin pode excluir ocorrências.'); return res.redirect('/admin/ocorrencias'); }
    await Ocorrencia.excluir(req.params.id);
    await Auditoria.log(req, 'EXCLUIU OCORRÊNCIA', `Ocorrência #${req.params.id}`);
    flash(res, 'ok', 'Ocorrência excluída.');
    res.redirect('/admin/ocorrencias');
  },
};
