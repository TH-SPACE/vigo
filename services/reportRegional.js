'use strict';

// Reports Regional — envia 1 mensagem por ocorrência para UM único grupo de
// WhatsApp (target `regional` no bridge do reportb2b, ligado a um número próprio).
// Enquanto o módulo de empresas cobre só as 4 empresas de Goiânia, este é regional:
// gatilho por afetação alta (>= corte configurável), de qualquer empresa.
//
// Dois gatilhos independentes (iguais aos do módulo de empresas):
//   1. ENTRADA   — ocorrência nova (ABERTO) ou que acabou de fechar (FECHADO).
//   2. ESCALADA  — ocorrência que segue ABERTA há muito tempo: passou de 12h,
//                  cobra a cada 2h; passou de 24h, a cada 1h (tudo configurável).
//
// FUSO: o MySQL roda em UTC e `data_ocorrencia` é gravada em horário de Brasília.
// Toda conta de tempo é feita aqui no Node — ver nota em models/ReportRegional.js.

const Config = require('../models/Config');
const Report = require('../models/ReportRegional');
const { fetchComTimeout } = require('./net');

// Destino único no bridge (número próprio). O grupo é cadastrado na página nova
// do reportb2b (/regional).
const TARGET = 'regional';

// Teto de mensagens por ciclo. Se a notificação ficar desligada por um tempo e
// voltar, isso impede uma enxurrada de uma vez no grupo — o resto sai nos ciclos
// seguintes.
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

// Só ABERTO e FECHADO viram mensagem — são os dois eventos que o módulo carimba.
const STATUS_NOTIFICAVEIS = ['ABERTO', 'FECHADO'];

async function lerConfig() {
  const [
    ativo, notifAtiva, statusPermitidos, dataMinima, escaladaAtiva,
    f1a, f1h, f1i, f2a, f2h, f2i, dias,
  ] = await Promise.all([
    Config.get('repreg_ativo', '0'),
    Config.get('repreg_notificacao_ativa', '1'),
    Config.get('repreg_status_permitidos', ''),
    Config.get('repreg_data_minima', ''),
    Config.get('repreg_escalada_ativa', '1'),
    Config.get('repreg_escalada_faixa1_ativa', '1'),
    Config.get('repreg_escalada_faixa1_horas', '12'),
    Config.get('repreg_escalada_faixa1_intervalo', '2'),
    Config.get('repreg_escalada_faixa2_ativa', '1'),
    Config.get('repreg_escalada_faixa2_horas', '24'),
    Config.get('repreg_escalada_faixa2_intervalo', '1'),
    Config.get('repreg_escalada_dias', '0,1,2,3,4,5,6'),
  ]);

  const num = (v, padrao) => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? padrao : n; };
  const dm = /^\d{4}-\d{2}-\d{2}$/.test(String(dataMinima || '')) ? dataMinima : null;

  const permitidos = String(statusPermitidos || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const notificar = permitidos.length
    ? STATUS_NOTIFICAVEIS.filter(s => permitidos.includes(s))
    : [...STATUS_NOTIFICAVEIS];

  return {
    ativo:            String(ativo) === '1',
    notifAtiva:       String(notifAtiva) === '1',
    statusNotificar:  notificar,
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

function corpoOcorrencia(o) {
  const afetacao = Number(o.afetacao || 0).toLocaleString('pt-BR');
  const endereco = [o.logradouro, o.numero_logradouro, o.bairro].filter(Boolean).join(', ');
  const linhas = [`*#${o.id_ocorrencia} · ${o.municipio || '—'}*`];
  if (o.empresa)   linhas.push(`🏢 Empresa: ${o.empresa}`);
  if (o.status)    linhas.push(`📶 Status: ${o.status}`);
  if (o.armario)   linhas.push(`📦 Armário: ${o.armario}${o.ta ? ` | TA ${o.ta}` : ''}`);
  else if (o.ta)   linhas.push(`🔧 TA: ${o.ta}`);
  if (o.cluster)   linhas.push(`🗂️ ${o.cluster}${o.uf ? ` / ${o.uf}` : ''}`);
  if (o.causa)     linhas.push(`⚡ Causa: ${o.causa}`);
  if (endereco)    linhas.push(`📍 ${endereco}`);
  const dt = fmtDataBR(o.data_ocorrencia);
  if (dt)          linhas.push(`🕐 Abertura: ${dt}`);
  linhas.push(`👥 *Afetados: ${afetacao}*`);
  return linhas;
}

function msgNova(o) {
  return [`🚨 *Nova Ocorrência — Regional*`, ``, ...corpoOcorrencia(o)].join('\n');
}

function msgFechada(o, agora = new Date()) {
  const linhas = [`✅ *Ocorrência Fechada — Regional*`, ``, ...corpoOcorrencia(o)];
  const dtFim = fmtDataBR(o.data_encerramento);
  if (dtFim) linhas.push(`🏁 Encerramento: ${dtFim}`);
  const inicio = paraDate(o.data_ocorrencia);
  if (inicio) {
    const fim = paraDate(o.data_encerramento) || agora;
    linhas.push(`⏱️ Duração: ${fmtDuracao(fim - inicio)}`);
  }
  return linhas.join('\n');
}

function msgEscalada(o, msAberta) {
  return [
    `⏰ *Em aberto há ${fmtDuracao(msAberta)} — Regional*`,
    ``,
    ...corpoOcorrencia(o),
    ``,
    `⚠️ Ocorrência segue ABERTA.`,
  ].join('\n');
}

// ── Envio ────────────────────────────────────────────────────────────────────

// Manda o texto para o destino `regional` no bridge. O bridge resolve o grupo e
// o número (instância própria) pelo target — cadastrados na página /regional do reportb2b.
async function enviarTexto(texto) {
  const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
  const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!webhookUrl) throw new Error('WHATSAPP_WEBHOOK_URL não configurado.');

  const r = await fetchComTimeout(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
    },
    body: JSON.stringify({ target: TARGET, text: texto, linkPreview: false }),
  }, 15000);

  if (!r.ok) throw new Error(`Webhook retornou ${r.status}`);
  const d = await r.json();

  // Grupo ainda não cadastrado: o bridge responde 200 com enqueued=0. A mensagem
  // é DESCARTADA (não fica pendente), senão o grupo nasceria com uma enxurrada de
  // avisos atrasados no dia em que fosse criado.
  if (d && d.reason === 'no_group_configured') {
    const err = new Error('Nenhum grupo cadastrado para o destino "regional". Cadastre o grupo na página /regional do dashboard do reportb2b.');
    err.semGrupo = true;
    throw err;
  }
  return d;
}

// ── Gatilho 1: entrada (nova / fechada) ──────────────────────────────────────

// Roda depois de cada importação e também a cada minuto (pega o que sobrou de um
// ciclo anterior). É idempotente: o carimbo notificado_*_em garante 1 aviso só.
async function processarNotificacoes() {
  const cfg = await lerConfig();
  if (!cfg.ativo) return { enviadas: 0, descartadas: 0 };

  const agora = new Date();
  const agoraStr = agoraBrasilia();

  // ── Regra "nada acumula" ────────────────────────────────────────────────────
  // Antes de enviar, carimba tudo que NÃO sairia agora (envio desligado, status
  // que não notifica, ocorrência anterior à data de corte). Sem isto, esse
  // material ficaria represado e explodiria de uma vez no grupo ao religar.
  let descartadas = 0;
  for (const status of STATUS_NOTIFICAVEIS) {
    const vaiEnviar = cfg.notifAtiva && cfg.statusNotificar.includes(status);
    const n = await Report.descartarPendentes(status, agoraStr, {
      enviar: vaiEnviar,
      dataMinima: vaiEnviar ? cfg.dataMinima : null,
    });
    descartadas += n;
  }
  if (descartadas) {
    console.log(`[ReportRegional] ${descartadas} aviso(s) descartado(s) — envio desligado para eles (não acumulam).`);
  }

  if (!cfg.notifAtiva || !cfg.statusNotificar.length) {
    return { enviadas: 0, descartadas };
  }

  let enviadas = 0;

  for (const status of cfg.statusNotificar) {
    const pendentes = await Report.pendentesNotificacao(status, cfg.dataMinima);
    if (!pendentes.length) continue;

    const lote = pendentes.slice(0, MAX_POR_CICLO);
    const enviadosIds = [];
    let semGrupo = false;

    for (const o of lote) {
      try {
        await enviarTexto(status === 'FECHADO' ? msgFechada(o, agora) : msgNova(o));
        enviadosIds.push(o.id_ocorrencia);
        enviadas++;
      } catch (e) {
        if (e.semGrupo) { semGrupo = true; break; }
        // Falha de rede/bridge: NÃO carimba — tenta de novo no próximo ciclo.
        console.error(`[ReportRegional] Falha ao notificar #${o.id_ocorrencia}:`, e.message);
        break;
      }
    }

    if (semGrupo) {
      // Sem grupo cadastrado: descarta o que estava pendente em vez de acumular.
      // Quando o grupo for criado, ele começa limpo e só recebe o que entrar
      // dali pra frente — nada de enxurrada de avisos atrasados.
      const descarta = pendentes.map(o => o.id_ocorrencia);
      await Report.marcarNotificado(descarta, status, agoraBrasilia());
      console.log(`[ReportRegional] sem grupo cadastrado: ${descarta.length} aviso(s) de ${status} descartado(s) (não ficam pendentes).`);
      continue;
    }

    await Report.marcarNotificado(enviadosIds, status, agoraBrasilia());
    if (pendentes.length > lote.length) {
      console.log(`[ReportRegional] ${pendentes.length - lote.length} ${status} na fila para o próximo ciclo.`);
    }
  }

  if (enviadas) console.log(`[ReportRegional] ${enviadas} notificação(ões) de entrada enviada(s).`);
  return { enviadas, descartadas };
}

// ── Gatilho 2: escalada das que seguem abertas ───────────────────────────────

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

  const abertas = await Report.abertas(cfg.dataMinima);
  if (!abertas.length) return { enviadas: 0 };

  const agora = new Date();
  const agoraStr = agoraBrasilia();

  const devidas = [];
  for (const o of abertas) {
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
  let enviadas = 0;
  let semGrupo = false;

  for (const { o, msAberta } of lote) {
    try {
      await enviarTexto(msgEscalada(o, msAberta));
      enviadosIds.push(o.id_ocorrencia);
      enviadas++;
    } catch (e) {
      if (e.semGrupo) { semGrupo = true; break; }
      console.error(`[ReportRegional] Falha na escalada #${o.id_ocorrencia}:`, e.message);
      break;
    }
  }

  if (semGrupo) {
    // Sem grupo: registra a cobrança como se tivesse saído, para zerar o relógio.
    // Senão, no dia em que o grupo fosse criado, TODAS as abertas vencidas seriam
    // cobradas de uma vez.
    await Report.marcarReportEnviado(devidas.map(d => d.o.id_ocorrencia), agoraStr);
    console.log(`[ReportRegional] sem grupo cadastrado: ${devidas.length} cobrança(s) descartada(s) (relógio reiniciado).`);
    return { enviadas: 0 };
  }

  await Report.marcarReportEnviado(enviadosIds, agoraStr);
  if (enviadas) console.log(`[ReportRegional] ${enviadas} cobrança(s) de escalada enviada(s).`);
  return { enviadas };
}

module.exports = {
  processarNotificacoes, verificarEscalada,
  enviarTexto, lerConfig, TARGET,
  msgNova, msgFechada, msgEscalada, fmtDuracao, agoraBrasilia, paraDate,
  intervaloHoras, diaPermitido, MAX_POR_CICLO,
};
