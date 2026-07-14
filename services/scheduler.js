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
const { verificarEscalada, processarNotificacoes } = require('./reportEmpresas');

let timer = null;
let rodando = false;

// Ciclo próprio do módulo de Reports por Empresa — intervalo e liga/desliga
// independentes da importação do VIGO (config rep_*).
let timerReports = null;
let rodandoReports = false;

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

async function cicloReports() {
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
}

module.exports = {
  iniciarScheduler, importarAgora, importarObservacoesAgora, minutosAleatorios,
  importarReportsAgora,
};
