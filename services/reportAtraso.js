'use strict';

// Reports de Atraso — cobra no WhatsApp toda ocorrência ABERTA há muito tempo,
// de empresas específicas (ONDACOM, ABILITY), SEM filtro de cluster por padrão.
//
// Diferença para o módulo de Reports por Empresa: aquele hoje está preso a
// `rep_clusters_permitidos = GOIANIA` (um filtro só, valendo para as 4 empresas
// ao mesmo tempo). Este módulo é independente disso — cobra a empresa
// configurada em QUALQUER cluster.
//
// Só existe UM gatilho: ESCALADA — ocorrência que segue ABERTA há muito tempo.
// Não há aviso de entrada nem de fechamento aqui (isso já é coberto pelo
// módulo de Reports por Empresa); este módulo só cobra atraso.
//
// FUSO: o MySQL roda em UTC e `data_ocorrencia` é gravada em horário de Brasília.
// Toda conta de tempo é feita aqui no Node — mesma armadilha documentada em
// services/reportEmpresas.js.

const Config = require('../models/Config');
const Report = require('../models/ReportAtraso');
const { fetchComTimeout } = require('./net');

// Teto de mensagens por ciclo, por empresa. Se a cobrança ficar desligada por
// um tempo e voltar, isso impede uma enxurrada de uma vez no grupo — o resto
// sai nos ciclos seguintes.
const MAX_POR_CICLO = 25;

// "2026-07-14 08:42:55" em Brasília, no mesmo formato (sem fuso) que o banco usa.
const FMT_BRASILIA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function agoraBrasilia() {
  return FMT_BRASILIA.format(new Date());
}

// ABILITY -> "ability" -> destino "atraso_ability" no bridge (card do dashboard).
function slugEmpresa(empresa) {
  return String(empresa || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function targetDe(empresa) {
  return `atraso_${slugEmpresa(empresa)}`;
}

// Empresas configuradas E com o toggle individual ligado.
async function empresasAtivas() {
  const lista = await Config.getLista('repat_empresas');
  const ativas = [];
  for (const e of lista) {
    const on = await Config.get(`repat_empresa_${slugEmpresa(e)}_ativo`, '1');
    if (String(on) === '1') ativas.push(e);
  }
  return ativas;
}

async function lerConfig() {
  const [
    ativo, clustersPermitidos, dataMinima, escaladaAtiva,
    f1a, f1h, f1i, f2a, f2h, f2i, dias,
  ] = await Promise.all([
    Config.get('repat_ativo', '0'),
    Config.getLista('repat_clusters_permitidos'),
    Config.get('repat_data_minima', ''),
    Config.get('repat_escalada_ativa', '1'),
    Config.get('repat_escalada_faixa1_ativa', '1'),
    Config.get('repat_escalada_faixa1_horas', '12'),
    Config.get('repat_escalada_faixa1_intervalo', '2'),
    Config.get('repat_escalada_faixa2_ativa', '0'),
    Config.get('repat_escalada_faixa2_horas', '24'),
    Config.get('repat_escalada_faixa2_intervalo', '1'),
    Config.get('repat_escalada_dias', '0,1,2,3,4,5,6'),
  ]);

  const num = (v, padrao) => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? padrao : n; };
  const dm = /^\d{4}-\d{2}-\d{2}$/.test(String(dataMinima || '')) ? dataMinima : null;

  return {
    ativo:            String(ativo) === '1',
    clustersPermitidos,
    dataMinima:       dm,
    escaladaAtiva:    String(escaladaAtiva) === '1',
    faixa1Ativa:      String(f1a) === '1',
    faixa1Horas:      num(f1h, 12),
    faixa1Intervalo:  num(f1i, 2),
    faixa2Ativa:      String(f2a) === '1',
    faixa2Horas:      num(f2h, 24),
    faixa2Intervalo:  num(f2i, 1),
    dias:             String(dias || '').split(',').map(d => d.trim()).filter(Boolean),
  };
}

// ── Datas ────────────────────────────────────────────────────────────────────

// O pool abre com `dateStrings: true` (database/connection.js), então DATETIME
// chega como "2026-07-14 06:10:01" — string, nunca Date. Fixo -03:00 (Brasília,
// sem horário de verão desde 2019) para não depender do TZ do processo.
function paraDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00'] = m;
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}-03:00`);
  return isNaN(dt) ? null : dt;
}

// ── Mensagens ────────────────────────────────────────────────────────────────

function fmtDataBR(v) {
  const d = paraDate(v);
  if (!d) return null;
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuracao(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h ? `${h}h ${m}min` : `${m}min`;
}

// Mesmo estilo do módulo Regional (services/reportRegional.js), só acrescentando o
// endereço completo (rua/número/bairro) — útil aqui porque a ocorrência pode vir
// de qualquer cluster, não só o de sempre.
function corpoOcorrencia(o) {
  const afetacao = Number(o.afetacao || 0).toLocaleString('pt-BR');
  const local = [o.municipio, o.uf].filter(Boolean).join(' / ');
  const endereco = [o.logradouro, o.numero_logradouro, o.bairro].filter(Boolean).join(', ');
  const linhas = [`🆔 Ocorrência: ${o.id_ocorrencia}`];
  linhas.push(`📍 ${local || '—'}`);
  if (o.empresa)   linhas.push(`🏢 Empresa: ${o.empresa}`);
  if (o.status)    linhas.push(`📶 Status: ${o.status}`);
  if (o.armario)   linhas.push(`📦 Armário: ${o.armario}`);
  if (o.ta)        linhas.push(`🔧 TA: ${o.ta}`);
  if (o.causa)     linhas.push(`⚡ Causa: ${o.causa}`);
  if (endereco)    linhas.push(`🏠 Endereço: ${endereco}`);
  const dt = fmtDataBR(o.data_ocorrencia);
  if (dt)          linhas.push(`🕐 Abertura: ${dt}`);
  linhas.push(`👥 *Afetação: ${afetacao}*`);
  return linhas;
}

function msgEscalada(o, msAberta) {
  return [
    `⏰ *Em aberto há ${fmtDuracao(msAberta)} — ${o.empresa || '—'}*`,
    ``,
    ...corpoOcorrencia(o),
    ``,
    `⚠️ Ocorrência segue ABERTA.`,
  ].join('\n');
}

// ── Envio ────────────────────────────────────────────────────────────────────

// Manda o texto para o destino da empresa no bridge (`atraso_ability`,
// `atraso_ondacom`, ...). O bridge resolve o grupo pelo target.
async function enviarTexto(empresa, texto) {
  const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
  const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!webhookUrl) throw new Error('WHATSAPP_WEBHOOK_URL não configurado.');

  const target = targetDe(empresa);
  const r = await fetchComTimeout(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
    },
    body: JSON.stringify({ target, text: texto, linkPreview: false }),
  }, 15000);

  if (!r.ok) throw new Error(`Webhook retornou ${r.status}`);
  const d = await r.json();

  // Grupo ainda não cadastrado: o bridge responde 200 com enqueued=0. A mensagem
  // é DESCARTADA (não fica pendente) — mesma regra dos outros módulos, para que
  // o grupo não nasça com uma enxurrada de cobranças atrasadas.
  if (d && d.reason === 'no_group_configured') {
    const err = new Error(`Nenhum grupo cadastrado para "${target}". Selecione o grupo no card "Atraso · ${empresa}" do dashboard do reportb2b.`);
    err.semGrupo = true;
    throw err;
  }
  return d;
}

// ── Escalada das que seguem abertas ──────────────────────────────────────────

// A escalada cobra o dia inteiro — não há janela de horário. O único recorte é o
// dia da semana (ex.: só seg a sex). Dia marcado = cobra de madrugada também.
function diaPermitido(cfg, agora = new Date()) {
  if (!cfg.dias.length) return true;
  const diaSemana = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
  return cfg.dias.includes(String(diaSemana));
}

// Intervalo de cobrança conforme o tempo em aberto. null = ainda não escalou.
function intervaloHoras(cfg, horasAberta) {
  if (cfg.faixa2Ativa && horasAberta >= cfg.faixa2Horas) return cfg.faixa2Intervalo;
  if (cfg.faixa1Ativa && horasAberta >= cfg.faixa1Horas) return cfg.faixa1Intervalo;
  return null;
}

async function verificarEscalada() {
  const cfg = await lerConfig();
  if (!cfg.ativo || !cfg.escaladaAtiva) return { enviadas: 0 };
  if (!diaPermitido(cfg)) return { enviadas: 0 };

  const empresas = await empresasAtivas();
  if (!empresas.length) return { enviadas: 0 };

  const abertas = await Report.abertas(empresas, cfg.clustersPermitidos, cfg.dataMinima);
  if (!abertas.length) return { enviadas: 0 };

  const agora = new Date();
  const agoraStr = agoraBrasilia();
  let enviadas = 0;

  // Agrupa por empresa: o teto por ciclo vale por grupo.
  const porEmpresa = new Map();
  for (const o of abertas) {
    if (!porEmpresa.has(o.empresa)) porEmpresa.set(o.empresa, []);
    porEmpresa.get(o.empresa).push(o);
  }

  for (const [empresa, lista] of porEmpresa) {
    const devidas = [];
    for (const o of lista) {
      const abertura = paraDate(o.data_ocorrencia);
      if (!abertura) continue;

      const msAberta    = agora - abertura;
      const horasAberta = msAberta / 3600000;
      const intervalo   = intervaloHoras(cfg, horasAberta);
      if (intervalo == null) continue; // ainda não atingiu a 1ª faixa

      const ultimo = paraDate(o.ultimo_report_em);
      if (ultimo && (agora - ultimo) / 3600000 < intervalo) continue; // cobrada há pouco

      devidas.push({ o, msAberta });
    }

    const lote = devidas.slice(0, MAX_POR_CICLO);
    const enviadosIds = [];
    let semGrupo = false;

    for (const { o, msAberta } of lote) {
      try {
        await enviarTexto(empresa, msgEscalada(o, msAberta));
        enviadosIds.push(o.id_ocorrencia);
        enviadas++;
      } catch (e) {
        if (e.semGrupo) { semGrupo = true; break; }
        console.error(`[ReportAtraso] Falha na escalada #${o.id_ocorrencia} (${empresa}):`, e.message);
        break;
      }
    }

    if (semGrupo) {
      // Sem grupo: registra a cobrança como se tivesse saído, para zerar o relógio.
      // Senão, no dia em que o grupo fosse criado, TODAS as abertas vencidas seriam
      // cobradas de uma vez.
      await Report.marcarReportEnviado(devidas.map(d => d.o.id_ocorrencia), agoraStr);
      console.log(`[ReportAtraso] ${empresa} sem grupo cadastrado: ${devidas.length} cobrança(s) descartada(s) (relógio reiniciado).`);
      continue;
    }

    await Report.marcarReportEnviado(enviadosIds, agoraStr);
  }

  if (enviadas) console.log(`[ReportAtraso] ${enviadas} cobrança(s) de atraso enviada(s).`);
  return { enviadas };
}

module.exports = {
  verificarEscalada,
  empresasAtivas, slugEmpresa, targetDe, enviarTexto, lerConfig,
  msgEscalada, fmtDuracao, agoraBrasilia, paraDate,
  intervaloHoras, diaPermitido, MAX_POR_CICLO,
};
