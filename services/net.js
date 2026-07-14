'use strict';

// Utilitários de rede para as chamadas HTTP de saída (importação e webhooks).

// fetch com timeout: aborta a requisição se o servidor remoto pendurar a
// conexão. Sem isto, uma origem lenta deixaria a importação "presa" (a flag
// `rodando` do scheduler nunca voltaria a false) e travaria importações futuras.
const TIMEOUT_PADRAO_MS = 20000;

function fetchComTimeout(url, opts = {}, timeoutMs = TIMEOUT_PADRAO_MS) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
}

// Valida uma URL FORNECIDA PELO USUÁRIO (config de importação) para mitigar SSRF:
// exige http/https e bloqueia loopback e o IP de metadados de nuvem. NÃO usar
// nos webhooks (esses apontam legitimamente para localhost via .env).
function assertUrlImportacaoSegura(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de importação inválida.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL de importação deve usar http ou https.');
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const bloqueados = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254']);
  if (bloqueados.has(host) || host.endsWith('.localhost')) {
    throw new Error('URL de importação aponta para um endereço interno não permitido.');
  }
  return u;
}

module.exports = { fetchComTimeout, assertUrlImportacaoSegura, TIMEOUT_PADRAO_MS };
