'use strict';

// Agendador da importação automática.
// Executa em intervalos ALEATÓRIOS entre intervalo_minimo e intervalo_maximo
// (em minutos), ambos configuráveis pelo Painel Admin (tabela config).

const { importar } = require('./importador');
const { importarObservacoes } = require('./importadorObservacoes');
const Config = require('../models/Config');
const Auditoria = require('../models/Auditoria');
const { verificarEnvio: verificarResumoDiario } = require('./resumoDiario');
const { verificarEnvio: verificarReportAbertos } = require('./reportAbertos');
const { importar: importarReports } = require('./importadorReports');
const {
  verificarEscalada, processarNotificacoes,
  agoraBrasilia: agoraBrasiliaEmpresas, paraDate: paraDateEmpresas,
} = require('./reportEmpresas');
const { importar: importarRegional } = require('./importadorRegional');
const {
  verificarEscalada: verificarEscaladaRegional,
  processarNotificacoes: processarNotificacoesRegional,
  agoraBrasilia: agoraBrasiliaRegional, paraDate: paraDateRegional,
} = require('./reportRegional');
const { importar: importarAtraso } = require('./importadorAtraso');
const { verificarEscalada: verificarEscaladaAtraso, agoraBrasilia: agoraBrasiliaAtraso, paraDate: paraDateAtraso } = require('./reportAtraso');
const ReportAtraso = require('../models/ReportAtraso');
const ReportRegional = require('../models/ReportRegional');
const ReportOcorrencia = require('../models/ReportOcorrencia');

let timer = null;
let rodando = false;

// Ciclo próprio do módulo de Reports por Empresa — intervalo e liga/desliga
// independentes da importação do VIGO (config rep_*).
let timerReports = null;
let rodandoReports = false;

// Ciclo próprio do módulo de Reports Regional — idem, independente (config repreg_*).
let timerRegional = null;
let rodandoRegional = false;

// Ciclo próprio do módulo de Reports de Atraso — idem, independente (config repat_*).
let timerAtraso = null;
let rodandoAtraso = false;

// Limpa a auditoria conforme a retenção configurável (padrão 15 dias).
async function limparAuditoria() {
  try {
    const diasRaw = parseInt(await Config.get('auditoria_retencao_dias', '15'), 10);
    const dias = isNaN(diasRaw) ? 15 : diasRaw;
    const n = await Auditoria.limparAntigas(dias);
    if (n) console.log(`[Auditoria] ${n} registro(s) com mais de ${dias} dias removidos.`);
  } catch (e) {
    console.error('[Auditoria] limpeza falhou:', e.message);
  }
}

function minutosAleatorios(min, max) {
  if (max < min) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function ciclo() {
  await limparAuditoria(); // mantém a auditoria dentro da janela de retenção
  try {
    const ativo = await Config.get('import_ativo', '1');
    if (String(ativo) === '1') {
      if (!rodando) {
        rodando = true;
        try { await importar(); }
        finally { rodando = false; }
      }
    } else {
      console.log('[Scheduler] Importação automática desativada (import_ativo=0).');
    }

    const obsAtivo = await Config.get('import_observacoes_ativo', '1');
    if (String(obsAtivo) === '1') {
      try { await importarObservacoes(); }
      catch (eObs) { console.error('[Scheduler] Erro ao importar observações:', eObs.message); }
    }
  } catch (e) {
    rodando = false;
    console.error('[Scheduler] Erro no ciclo de importação:', e.message);
  } finally {
    await agendarProximo();
  }
}

async function agendarProximo() {
  const min = parseInt(await Config.get('intervalo_minimo', process.env.IMPORT_INTERVALO_MIN || '10'), 10) || 10;
  const max = parseInt(await Config.get('intervalo_maximo', process.env.IMPORT_INTERVALO_MAX || '25'), 10) || 25;
  const minutos = minutosAleatorios(min, max);
  if (timer) clearTimeout(timer);
  timer = setTimeout(ciclo, minutos * 60 * 1000);
  console.log(`[Scheduler] Próxima importação em ~${minutos} min.`);
}

// ── Módulo Reports por Empresa ───────────────────────────────────────────────

// Limpa quem já fechou (saiu de ABERTO), a cada N dias configurável
// (rep_limpeza_dias, padrão 7) — mesmo desenho do módulo de Atraso (ver
// limparAtrasoAntigas). A regra de quando cada linha pode sair é decidida em
// ReportOcorrencia.limparFechadas().
async function limparReportsAntigas() {
  try {
    const ativa = await Config.get('rep_limpeza_ativa', '1');
    if (String(ativa) !== '1') return 0;

    const dias = parseInt(await Config.get('rep_limpeza_dias', '7'), 10) || 7;
    const ultima = paraDateEmpresas(await Config.get('rep_limpeza_ultima_em', ''));
    if (ultima && (Date.now() - ultima.getTime()) / 86400000 < dias) return 0;

    const n = await ReportOcorrencia.limparFechadas();
    await Config.set('rep_limpeza_ultima_em', agoraBrasiliaEmpresas());
    if (n) console.log(`[ReportEmpresas] ${n} ocorrência(s) fechada(s) removida(s).`);
    return n;
  } catch (e) {
    console.error('[ReportEmpresas] Limpeza falhou:', e.message);
    return 0;
  }
}

async function cicloReports() {
  await limparReportsAntigas();
  try {
    const ativo = await Config.get('rep_ativo', '0');
    if (String(ativo) === '1' && !rodandoReports) {
      rodandoReports = true;
      try { await importarReports(); }
      finally { rodandoReports = false; }
    }
  } catch (e) {
    rodandoReports = false;
    console.error('[ReportImport] Erro no ciclo:', e.message);
  } finally {
    await agendarProximoReports();
  }
}

async function agendarProximoReports() {
  const min = parseInt(await Config.get('rep_intervalo_minimo', '10'), 10) || 10;
  const max = parseInt(await Config.get('rep_intervalo_maximo', '20'), 10) || 20;
  const minutos = minutosAleatorios(min, max);
  if (timerReports) clearTimeout(timerReports);
  timerReports = setTimeout(cicloReports, minutos * 60 * 1000);
}

// Importação manual do módulo (botão da tela de config); reagenda o ciclo.
async function importarReportsAgora() {
  if (rodandoReports) throw new Error('Já existe uma importação de reports em andamento.');
  rodandoReports = true;
  try { return await importarReports(); }
  finally {
    rodandoReports = false;
    await agendarProximoReports();
  }
}

// Limpeza manual (botão da tela); roda na hora, mesmo com a limpeza automática
// desligada ou o prazo não vencido. Também reseta o relógio.
async function limparReportsAgora() {
  const n = await ReportOcorrencia.limparFechadas();
  await Config.set('rep_limpeza_ultima_em', agoraBrasiliaEmpresas());
  return { removidas: n };
}

// ── Módulo Reports Regional ──────────────────────────────────────────────

// Limpa quem já fechou (saiu de ABERTO), a cada N dias configurável
// (repreg_limpeza_dias, padrão 7) — mesmo desenho do módulo de Atraso (ver
// limparAtrasoAntigas). A regra de quando cada linha pode sair é decidida em
// ReportRegional.limparFechadas().
async function limparRegionalAntigas() {
  try {
    const ativa = await Config.get('repreg_limpeza_ativa', '1');
    if (String(ativa) !== '1') return 0;

    const dias = parseInt(await Config.get('repreg_limpeza_dias', '7'), 10) || 7;
    const ultima = paraDateRegional(await Config.get('repreg_limpeza_ultima_em', ''));
    if (ultima && (Date.now() - ultima.getTime()) / 86400000 < dias) return 0;

    const n = await ReportRegional.limparFechadas();
    await Config.set('repreg_limpeza_ultima_em', agoraBrasiliaRegional());
    if (n) console.log(`[ReportRegional] ${n} ocorrência(s) fechada(s) removida(s).`);
    return n;
  } catch (e) {
    console.error('[ReportRegional] Limpeza falhou:', e.message);
    return 0;
  }
}

async function cicloRegional() {
  await limparRegionalAntigas();
  try {
    const ativo = await Config.get('repreg_ativo', '0');
    if (String(ativo) === '1' && !rodandoRegional) {
      rodandoRegional = true;
      try { await importarRegional(); }
      finally { rodandoRegional = false; }
    }
  } catch (e) {
    rodandoRegional = false;
    console.error('[RegionalImport] Erro no ciclo:', e.message);
  } finally {
    await agendarProximoRegional();
  }
}

async function agendarProximoRegional() {
  const min = parseInt(await Config.get('repreg_intervalo_minimo', '10'), 10) || 10;
  const max = parseInt(await Config.get('repreg_intervalo_maximo', '20'), 10) || 20;
  const minutos = minutosAleatorios(min, max);
  if (timerRegional) clearTimeout(timerRegional);
  timerRegional = setTimeout(cicloRegional, minutos * 60 * 1000);
}

// Importação manual do módulo (botão da tela de config); reagenda o ciclo.
async function importarRegionalAgora() {
  if (rodandoRegional) throw new Error('Já existe uma importação regional em andamento.');
  rodandoRegional = true;
  try { return await importarRegional(); }
  finally {
    rodandoRegional = false;
    await agendarProximoRegional();
  }
}

// Limpeza manual (botão da tela); roda na hora, mesmo com a limpeza automática
// desligada ou o prazo não vencido. Também reseta o relógio.
async function limparRegionalAgora() {
  const n = await ReportRegional.limparFechadas();
  await Config.set('repreg_limpeza_ultima_em', agoraBrasiliaRegional());
  return { removidas: n };
}

// ── Módulo Reports de Atraso ──────────────────────────────────────────────

// Limpa quem já fechou (saiu de ABERTO), a cada N dias configurável
// (repat_limpeza_dias, padrão 7) — não a cada ciclo de importação (esse roda
// de 10 em 10min, cedo demais). `repat_limpeza_ultima_em` guarda quando rodou
// pela última vez; só dispara de novo depois de vencido o prazo.
async function limparAtrasoAntigas() {
  try {
    const ativa = await Config.get('repat_limpeza_ativa', '1');
    if (String(ativa) !== '1') return 0;

    const dias = parseInt(await Config.get('repat_limpeza_dias', '7'), 10) || 7;
    const ultima = paraDateAtraso(await Config.get('repat_limpeza_ultima_em', ''));
    if (ultima && (Date.now() - ultima.getTime()) / 86400000 < dias) return 0;

    const n = await ReportAtraso.limparFechadas();
    await Config.set('repat_limpeza_ultima_em', agoraBrasiliaAtraso());
    if (n) console.log(`[ReportAtraso] ${n} ocorrência(s) fechada(s) removida(s).`);
    return n;
  } catch (e) {
    console.error('[ReportAtraso] Limpeza falhou:', e.message);
    return 0;
  }
}

async function cicloAtraso() {
  await limparAtrasoAntigas();
  try {
    const ativo = await Config.get('repat_ativo', '0');
    if (String(ativo) === '1' && !rodandoAtraso) {
      rodandoAtraso = true;
      try { await importarAtraso(); }
      finally { rodandoAtraso = false; }
    }
  } catch (e) {
    rodandoAtraso = false;
    console.error('[AtrasoImport] Erro no ciclo:', e.message);
  } finally {
    await agendarProximoAtraso();
  }
}

async function agendarProximoAtraso() {
  const min = parseInt(await Config.get('repat_intervalo_minimo', '10'), 10) || 10;
  const max = parseInt(await Config.get('repat_intervalo_maximo', '20'), 10) || 20;
  const minutos = minutosAleatorios(min, max);
  if (timerAtraso) clearTimeout(timerAtraso);
  timerAtraso = setTimeout(cicloAtraso, minutos * 60 * 1000);
}

// Importação manual do módulo (botão da tela de config); reagenda o ciclo.
async function importarAtrasoAgora() {
  if (rodandoAtraso) throw new Error('Já existe uma importação de atraso em andamento.');
  rodandoAtraso = true;
  try { return await importarAtraso(); }
  finally {
    rodandoAtraso = false;
    await agendarProximoAtraso();
  }
}

// Limpeza manual (botão da tela); roda na hora, mesmo com a limpeza automática
// desligada ou o prazo dos 7 dias não vencido — é uma ação explícita do
// usuário. Também reseta o relógio, pra não rodar nos 7 dias seguintes.
async function limparAtrasoAgora() {
  const n = await ReportAtraso.limparFechadas();
  await Config.set('repat_limpeza_ultima_em', agoraBrasiliaAtraso());
  return { removidas: n };
}

// Importação manual (botão do admin); reagenda o ciclo.
async function importarAgora(usuario) {
  if (rodando) throw new Error('Já existe uma importação em andamento.');
  rodando = true;
  try {
    const r = await importar({ usuario });
    return r;
  } finally {
    rodando = false;
    await agendarProximo();
  }
}

// Importação manual de observações (botão do admin).
async function importarObservacoesAgora() {
  return importarObservacoes();
}

function iniciarScheduler() {
  console.log('[Scheduler] Importação automática iniciada.');
  timer = setTimeout(ciclo, 30 * 1000);
  // Verifica envios agendados a cada minuto
  setInterval(verificarResumoDiario, 60 * 1000);
  setInterval(verificarReportAbertos, 60 * 1000);

  // Reports por empresa: ciclo de importação próprio + escalada a cada minuto.
  // A escalada roda separada da importação porque cobra por tempo em aberto,
  // não por chegada de dado novo.
  timerReports = setTimeout(cicloReports, 60 * 1000);
  setInterval(() => {
    verificarEscalada().catch(e => console.error('[ReportEmpresas] Erro na escalada:', e.message));
  }, 60 * 1000);
  // Rede de segurança: reenvia o que ficou pendente se o bridge estava fora do ar.
  setInterval(() => {
    processarNotificacoes().catch(e => console.error('[ReportEmpresas] Erro nas notificações:', e.message));
  }, 60 * 1000);

  // Reports Regional: mesmo desenho do módulo de empresas, ciclo próprio.
  timerRegional = setTimeout(cicloRegional, 60 * 1000);
  setInterval(() => {
    verificarEscaladaRegional().catch(e => console.error('[ReportRegional] Erro na escalada:', e.message));
  }, 60 * 1000);
  setInterval(() => {
    processarNotificacoesRegional().catch(e => console.error('[ReportRegional] Erro nas notificações:', e.message));
  }, 60 * 1000);

  // Reports de Atraso: ciclo próprio + escalada a cada minuto. Só tem o
  // gatilho de escalada — não há notificação de entrada para reenviar.
  timerAtraso = setTimeout(cicloAtraso, 60 * 1000);
  setInterval(() => {
    verificarEscaladaAtraso().catch(e => console.error('[ReportAtraso] Erro na escalada:', e.message));
  }, 60 * 1000);
}

module.exports = {
  iniciarScheduler, importarAgora, importarObservacoesAgora, minutosAleatorios,
  importarReportsAgora, importarRegionalAgora, importarAtrasoAgora, limparAtrasoAgora,
  limparRegionalAgora, limparReportsAgora,
};
