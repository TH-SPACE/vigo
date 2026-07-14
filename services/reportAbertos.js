'use strict';

const db     = require('../database/connection');
const Config = require('../models/Config');
const { ID_MANUAL_MIN } = require('../models/Ocorrencia');
const { fetchComTimeout } = require('./net');

// Ocorrências manuais (id >= ID_MANUAL_MIN) ficam fora deste report: elas já
// notificam o grupo na criação e não devem repetir o aviso enquanto abertas.
async function buildTexto() {
  const [abertos] = await db.query(`
    SELECT id_ocorrencia, municipio, bairro, armario, afetacao,
           status, status_tratativa, ta, empresa, data_ocorrencia
      FROM ocorrencias
     WHERE status = 'ABERTO' AND id_ocorrencia < ?
     ORDER BY data_ocorrencia DESC
  `, [ID_MANUAL_MIN]);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dtBR = now.toLocaleDateString('pt-BR');
  const hrBR = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function fmtDataBR(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d)) return v;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const linhas = [
    `⚠️ *Ocorrências em Aberto — VIGO*`,
    `📅 ${dtBR} — ${hrBR}`,
    ``,
    `Total: *${abertos.length}* ocorrência${abertos.length !== 1 ? 's' : ''} com status ABERTO`,
    ``,
  ];

  if (!abertos.length) {
    linhas.push(`✅ Nenhuma ocorrência em aberto no momento.`);
  } else {
    for (const o of abertos) {
      const afet  = Number(o.afetacao || 0).toLocaleString('pt-BR');
      const local = [o.municipio, o.bairro].filter(Boolean).join(' / ') || '—';
      linhas.push(`🔴 *#${o.id_ocorrencia}* — ${local}`);
      if (o.armario) linhas.push(`   📦 ${o.armario}  |  👥 ${afet} afet.`);
      else           linhas.push(`   👥 ${afet} afetados`);
      linhas.push(`   🏢 ${o.empresa || '—'}  |  🔧 TA: ${o.ta || '—'}`);
      linhas.push(`   📶 Status: ${o.status || '—'}`);
      linhas.push(`   📆 Abertura: ${fmtDataBR(o.data_ocorrencia)}`);
    }
  }

  linhas.push(``, `🔗 https://ocorrencias.thanos-online.shop`);
  return linhas.join('\n');
}

async function enviarReport() {
  const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
  const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!webhookUrl) throw new Error('WHATSAPP_WEBHOOK_URL não configurado.');

  const text = await buildTexto();
  const r = await fetchComTimeout(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
    },
    body: JSON.stringify({ text, linkPreview: false }),
  }, 15000);
  if (!r.ok) throw new Error(`Webhook retornou ${r.status}`);
  return await r.json();
}

// Chamado a cada minuto pelo scheduler.
// Dispara quando o intervalo configurado (em minutos) tiver passado desde o último envio.
async function verificarEnvio() {
  try {
    const ativo = await Config.get('whatsapp_report_abertos_ativo', '0');
    if (ativo !== '1') return;

    const intervalo = parseInt(await Config.get('whatsapp_report_abertos_intervalo', '60'), 10) || 60;
    const ultimoStr = await Config.get('whatsapp_report_abertos_ultimo_envio', '');

    if (ultimoStr) {
      const ultimo   = new Date(ultimoStr);
      const diffMin  = (Date.now() - ultimo.getTime()) / 60000;
      if (diffMin < intervalo) return;
    }

    // Só reporta se houver ao menos uma ocorrência em aberto — evita mandar
    // "0 ocorrências" de hora em hora. Não atualiza o carimbo de último envio
    // ao pular: assim que abrir uma, o próximo ciclo já dispara (respeitando o intervalo).
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM ocorrencias WHERE status = 'ABERTO' AND id_ocorrencia < ?`,
      [ID_MANUAL_MIN]);
    if (!Number(total)) return;

    await Config.set('whatsapp_report_abertos_ultimo_envio', new Date().toISOString());
    await enviarReport();
    console.log('[ReportAbertos] Report enviado.');
  } catch (e) {
    console.error('[ReportAbertos] Erro:', e.message);
  }
}

module.exports = { verificarEnvio, enviarReport, buildTexto };
