'use strict';

/* ============================================================
   Painel operacional — "Ao vivo · sincronizado há X" + sino
   ============================================================ */
(function () {
  const aoVivo   = document.querySelector('.ao-vivo');
  const syncLab  = document.getElementById('sync-label');
  // ---- "sincronizado há X" (relativo, calculado do data-sync) ----
  function haTexto(ms) {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60)  return 'há ' + s + 's';
    const m = Math.floor(s / 60);
    if (m < 60)  return 'há ' + m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24)  return 'há ' + h + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
    return 'há ' + Math.floor(h / 24) + 'd';
  }
  function tickSync() {
    if (!aoVivo || !syncLab) return;
    const iso = aoVivo.getAttribute('data-sync');
    const ms = iso ? Date.parse(iso) : NaN;
    syncLab.textContent = isNaN(ms) ? 'aguardando importação' : haTexto(ms);
  }

  // ---- atualização ao vivo (sem recarregar) ----
  function setNum(sel, valor) {
    const novo = String(valor);
    document.querySelectorAll(sel).forEach(el => {
      if (el.textContent === novo) return;       // só anima quando muda de verdade
      el.textContent = novo;
      el.classList.remove('valor-flash');
      void el.offsetWidth;                        // reinicia a animação
      el.classList.add('valor-flash');
    });
  }
  async function atualizar() {
    try {
      const r = await fetch('/painel/dados', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      const m = d.metricas || {};
      setNum('[data-kpi="abertas"]',  m.abertas  || 0);
      setNum('[data-kpi="fechadas"]', m.fechadas || 0);
      setNum('[data-kpi="pendentes"]', m.pendentes || 0);

      const c = d.contagem || {};
      document.querySelectorAll('[data-status]').forEach(el => {
        el.textContent = c[el.getAttribute('data-status')] || 0;
      });

      if (aoVivo && d.ultimaImportacao) aoVivo.setAttribute('data-sync', d.ultimaImportacao);
      tickSync();
    } catch (_) { /* silencioso */ }
  }

  tickSync();
  setInterval(tickSync, 15000);   // atualiza o "há X" a cada 15s
  setInterval(atualizar, 60000);  // busca números novos a cada 60s

})();
