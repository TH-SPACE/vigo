'use strict';

const Ocorrencia = require('../models/Ocorrencia');
const Config     = require('../models/Config');

const POR_PAGINA = 50;

async function getDataMinima() {
  const v = await Config.get('data_minima_ocorrencia', '');
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

module.exports = {
  // ── Painel operacional (visão geral / KPIs) ──
  async painel(req, res) {
    const [metricas, contagem, ultimasEntrantes, ultimaImportacao] = await Promise.all([
      Ocorrencia.metricas(),
      Ocorrencia.contarPorStatusTratativa(),
      Ocorrencia.ultimasAtivas(6),
      Config.get('ultima_importacao', null),
    ]);
    res.render('dashboard/painel', {
      titulo: 'Painel Operacional',
      metricas, contagem, ultimasEntrantes, ultimaImportacao, perfil: req.user.perfil,
    });
  },

  // ── Dados do painel em JSON (atualização ao vivo, sem recarregar) ──
  async dados(req, res) {
    const [metricas, contagem, alertas, ultimaImportacao] = await Promise.all([
      Ocorrencia.metricas(),
      Ocorrencia.contarPorStatusTratativa(),
      Ocorrencia.alertas(1),
      Config.get('ultima_importacao', null),
    ]);
    res.json({ metricas, contagem, alertasTotal: alertas.total, ultimaImportacao });
  },

  // ── Fila de ocorrências (abas fixas + paginação) ──
  async index(req, res) {
    const perfil = req.user.perfil;
    const busca  = (req.query.busca || '').trim();
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
    const data_minima = await getDataMinima();
    const minhas = req.query.minhas === '1';
    const statusQuery = req.query.status_tratativa || '';
    const filtros = {
      busca,
      municipio:   req.query.municipio || '',
      armario:     req.query.armario   || '',
      status:      req.query.status    || '',
      empresa:     req.query.empresa   || '',
      data_minima: data_minima || undefined,
      limit:       POR_PAGINA,
      offset:      (pagina - 1) * POR_PAGINA,
    };

    // Navegação por abas: todos os perfis veem as mesmas 4 abas, cada uma
    // cobrindo um status de tratativa (menos CANCELADA, que não aparece em
    // nenhuma). "Minhas" cruza qualquer status e mostra o que está vinculado
    // ao usuário logado (como vistoriador ou como analista).
    const ABA_TITULO = {
      pendentes:  'Pendentes Vistoria',
      minhas:     'Minhas Ocorrências',
      aguardando: 'Aguardando Correção',
      enviadas:   'Correções Enviadas',
    };
    const STATUS_DA_ABA = { pendentes: 'PENDENTE', aguardando: 'AGUARDANDO CORRECAO', enviadas: 'CORRECAO ENVIADA' };
    let abaAtiva = null;
    if (minhas) {
      filtros.meu_id = req.user.id;
      abaAtiva = 'minhas';
    } else if (statusQuery) {
      // Link legado/externo (ex.: chip do painel) — aplica o status pedido e só
      // acende a aba se ele corresponder a uma delas (VISTORIA SUPERVISOR e
      // CANCELADA não têm aba própria, mas continuam filtráveis por essa via).
      filtros.status_tratativa = statusQuery;
      abaAtiva = Object.keys(STATUS_DA_ABA).find(k => STATUS_DA_ABA[k] === statusQuery) || null;
    } else if (!filtros.status) {
      // Sem nenhum filtro explícito: aba padrão ao entrar na tela.
      filtros.status_tratativa = 'PENDENTE';
      abaAtiva = 'pendentes';
    }
    // filtros.status (ABERTO/FECHADO, vindo dos KPIs do painel) fica sem aba
    // acesa e sem restrição de tratativa — mostra o recorte em todas elas.
    const titulo = abaAtiva ? ABA_TITULO[abaAtiva] : 'Fila de Ocorrências';

    const escopo = filtros.status_tratativa || null;
    const [ocorrencias, total, municipios, armarios, empresas, contagemStatus, minhasTotal] = await Promise.all([
      Ocorrencia.listar(filtros),
      Ocorrencia.contar(filtros),
      Ocorrencia.distintos('municipio', escopo),
      Ocorrencia.distintos('armario', escopo),
      Ocorrencia.distintos('empresa', escopo),
      Ocorrencia.contarPorStatusTratativa(),
      Ocorrencia.contarMinhas(req.user.id),
    ]);

    const abas = [
      { key: 'pendentes',  label: 'Pendentes Vistoria', total: contagemStatus['PENDENTE'] || 0,
        dica: 'Nenhum supervisor assumiu ainda — disponível na fila' },
      { key: 'minhas',     label: 'Minhas',              total: minhasTotal,
        dica: 'Ocorrências vinculadas a você, como vistoriador ou analista' },
      { key: 'aguardando', label: 'Aguardando Correção', total: contagemStatus['AGUARDANDO CORRECAO'] || 0,
        dica: 'Vistoria concluída — falta o analista enviar a correção' },
      { key: 'enviadas',   label: 'Correções Enviadas',  total: contagemStatus['CORRECAO ENVIADA'] || 0,
        dica: 'Correção já enviada — ocorrência encerrada' },
    ];

    const temMais     = filtros.offset + ocorrencias.length < total;
    const temAnterior = pagina > 1;

    res.render('dashboard/index', {
      titulo, ocorrencias, perfil, busca, abas, abaAtiva,
      filtros, municipios, armarios, empresas,
      pagina, total, temMais, temAnterior, porPagina: POR_PAGINA,
    });
  },
};
