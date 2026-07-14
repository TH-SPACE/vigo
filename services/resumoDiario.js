'use strict';

const db     = require('../database/connection');
const Config = require('../models/Config');
const { fetchComTimeout } = require('./net');

async function buildTexto() {
  const [[statusRows], [[cnt24h]], [top3]] = await Promise.all([
    db.query(`SELECT status_tratativa, COUNT(*) AS total FROM ocorrencias GROUP BY status_tratativa`),
    db.query(`SELECT COUNT(*) AS total FROM historico WHERE acao = 'IMPORTADA' AND criado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`),
    db.query(`SELECT id_ocorrencia, municipio, afetacao FROM ocorrencias WHERE status_tratativa = 'PENDENTE' ORDER BY afetacao DESC LIMIT 3`),
  ]);

  const s = Object.fromEntries(statusRows.map(r => [r.status_tratativa, Number(r.total)]));
  const novas24h = Number(cnt24h.total);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dtBR = now.toLocaleDateString('pt-BR');
  const hrBR = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const linhas = [
    `📊 *Resumo Diário — VIGO*`,
    `📅 ${dtBR} — ${hrBR}`,
    ``,
    `🔴 *Pendentes: ${s['PENDENTE'] || 0}*`,
    `🔵 Em vistoria: ${s['VISTORIA SUPERVISOR'] || 0}`,
    `🟡 Aguardando correção: ${s['AGUARDANDO CORRECAO'] || 0}`,
    `✅ Correção enviada: ${s['CORRECAO ENVIADA'] || 0}`,
    ``,
    `📥 Novas nas últimas 24h: *${novas24h}*`,
  ];

  if (top3.length) {
    linhas.push(``, `🏆 *Top pendentes por afetação:*`);
    for (const o of top3) {
      linhas.push(`• #${o.id_ocorrencia} · ${o.municipio || '—'} — ${Number(o.afetacao).toLocaleString('pt-BR')} afet.`);
    }
  }

  linhas.push(``, `🔗 https://ocorrencias.thanos-online.shop`);
  return linhas.join('\n');
}

async function enviarResumoDiario() {
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

// Chamado a cada minuto pelo scheduler; só envia quando bater o horário configurado.
async function verificarEnvio() {
  try {
    const ativo = await Config.get('whatsapp_resumo_ativo', '0');
    if (ativo !== '1') return;

    const hora    = await Config.get('whatsapp_resumo_hora', '07:00');
    const diasStr = await Config.get('whatsapp_resumo_dias', '1,2,3,4,5');
    const dias    = diasStr.split(',').map(Number).filter(n => !isNaN(n));

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const horaAgora = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    if (horaAgora !== hora) return;
    if (!dias.includes(now.getDay())) return;

    const hoje  = now.toLocaleDateString('pt-BR');
    const ultimo = await Config.get('whatsapp_resumo_ultimo_envio', '');
    if (ultimo === hoje) return;

    await Config.set('whatsapp_resumo_ultimo_envio', hoje);
    await enviarResumoDiario();
    console.log('[ResumoDiario] Resumo enviado:', hoje);
  } catch (e) {
    console.error('[ResumoDiario] Erro:', e.message);
  }
}

module.exports = { verificarEnvio, enviarResumoDiario, buildTexto };
