/* V-GER – Sino de notificações (polling 30 s + dropdown) */
'use strict';

(function () {
  if (!window.VGER_USER) return;

  const USER_ID   = window.VGER_USER.id;
  const LS_KEY    = 'vger_notif_desde_' + USER_ID;
  const INTERVALO = 30 * 1000;

  let badgeEl   = null;
  let bellBtn   = null;
  let popEl     = null;
  let wrapEl    = null;
  let pollTimer = null;

  /* ── Badge ──────────────────────────────────────────────── */
  function setBadge(n) {
    if (!badgeEl) return;
    if (n > 0) {
      badgeEl.textContent = n > 99 ? '99+' : String(n);
      badgeEl.hidden = false;
    } else {
      badgeEl.hidden = true;
    }
  }

  /* ── Polling de novos eventos ───────────────────────────── */
  async function verificar() {
    const desde = localStorage.getItem(LS_KEY);
    const agora = new Date().toISOString();

    if (!desde) { localStorage.setItem(LS_KEY, agora); return; }

    try {
      const r = await fetch('/api/notificacoes?desde=' + encodeURIComponent(desde));
      if (r.status === 401) { clearInterval(pollTimer); return; }
      if (!r.ok) return;

      const data = await r.json();
      localStorage.setItem(LS_KEY, agora);

      if (data.total > 0 && data.mensagem) {
        // Sem som/notificação de desktop: o alerta ativo é feito pelo WhatsApp.
        // Aqui apenas atualizamos o badge do sino com o total real de pendentes.
        fetch('/api/notificacoes/alertas')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setBadge(d.total); })
          .catch(() => {});
      }
    } catch {}
  }

  /* ── Dropdown: carregar alertas ─────────────────────────── */
  async function carregarAlertas() {
    const corpo    = document.getElementById('notif-pop-corpo');
    const tituloEl = document.getElementById('notif-pop-titulo');
    if (!corpo) return;

    corpo.innerHTML = '<div class="sino-vazio">Carregando...</div>';

    try {
      const r = await fetch('/api/notificacoes/alertas');
      if (!r.ok) throw new Error();
      const { itens, total, titulo } = await r.json();

      setBadge(total); // badge reflete o total real, não os "novos desde última vez"

      if (tituloEl) {
        tituloEl.textContent = titulo + (total > itens.length ? ` · ${total} total` : ` · ${total}`);
      }

      if (!itens.length) {
        corpo.innerHTML = '<div class="sino-vazio">Nenhuma ocorrência no momento. 🎉</div>';
        return;
      }

      const ul = document.createElement('ul');
      ul.className = 'sino-lista';
      itens.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML =
          `<a href="/ocorrencias/${item.id_ocorrencia}">` +
            `<span class="sino-af">${(item.afetacao || 0).toLocaleString('pt-BR')}<small>afet.</small></span>` +
            `<span class="sino-info">` +
              `<b>#${item.id_ocorrencia} · ${item.municipio || '—'}</b>` +
              `<small>${item.armario || 'sem armário'}${item.ta ? ' · TA ' + item.ta : ''}</small>` +
            `</span>` +
          `</a>`;
        ul.appendChild(li);
      });

      corpo.innerHTML = '';
      corpo.appendChild(ul);
    } catch {
      corpo.innerHTML = '<div class="sino-vazio">Erro ao carregar.</div>';
    }
  }

  /* ── Toggle do dropdown ─────────────────────────────────── */
  function abrirDropdown() {
    if (!popEl) return;
    const estaAberto = !popEl.hidden;
    popEl.hidden = estaAberto;
    if (!estaAberto) {
      carregarAlertas(); // badge é atualizado pelo total real do dropdown
    }
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    badgeEl = document.getElementById('notif-badge');
    bellBtn = document.getElementById('notif-btn');
    popEl   = document.getElementById('notif-pop');
    wrapEl  = document.getElementById('notif-wrap');

    if (bellBtn) {
      bellBtn.addEventListener('click', e => {
        e.stopPropagation();
        abrirDropdown();
      });
    }

    // Fecha o dropdown ao clicar fora
    document.addEventListener('click', e => {
      if (popEl && !popEl.hidden && wrapEl && !wrapEl.contains(e.target)) {
        popEl.hidden = true;
      }
    });

    // Badge inicial: total real de pendentes no momento
    fetch('/api/notificacoes/alertas')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.total > 0) setBadge(d.total); })
      .catch(() => {});

    verificar();

    // SSE (preferido) com fallback automático para polling
    if (window.EventSource) {
      iniciarSSE();
    } else {
      pollTimer = setInterval(verificar, INTERVALO);
    }
  }

  function iniciarSSE() {
    let src        = null;
    let retryTimer = null;
    let pollCurto  = null;

    function conectar() {
      src = new EventSource('/api/notificacoes/stream');

      src.addEventListener('importacao', () => { verificar(); });

      src.onopen = () => {
        // reconectou: dispensa o polling curto de fallback
        if (pollCurto) { clearInterval(pollCurto); pollCurto = null; }
      };

      src.onerror = () => {
        src.close();
        if (!pollCurto) pollCurto = setInterval(verificar, INTERVALO);
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; conectar(); }, 15000);
      };
    }

    // Fecha o EventSource e cancela os timers de reconexão.
    function encerrar() {
      if (src)        { src.close(); src = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (pollCurto)  { clearInterval(pollCurto); pollCurto = null; }
    }

    conectar();

    // Fallback poll longo: atualiza badge mesmo em janelas sem novas importações
    pollTimer = setInterval(verificar, 5 * 60 * 1000);

    // CRÍTICO: fecha o SSE ao sair/ocultar a página. Sem isto, cada navegação
    // deixa uma conexão SSE presa; como o navegador só permite ~6 conexões
    // HTTP/1.1 por host, após poucas páginas ele trava sem conseguir abrir
    // novas requisições. `pagehide` cobre navegação normal e entrada no bfcache.
    window.addEventListener('pagehide', encerrar);
    // Se a página voltar do bfcache, reabre a conexão.
    window.addEventListener('pageshow', (e) => { if (e.persisted && !src) conectar(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
