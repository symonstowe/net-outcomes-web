(() => {
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function signed(value, digits = 3) {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    const s = n.toFixed(digits);
    return n > 0 ? `+${s}` : s;
  }

  function classForSigned(value) {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return n > 0 ? 'pos' : 'neg';
  }

  function pct(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(digits)}%`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '');
  }

  function formatLocalDateTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(dt);
  }

  function formatLocalDate(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(dt);
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function updateSortableHeaders(tableId, sortState) {
    const headers = Array.from(document.querySelectorAll(`#${tableId} th.sf-sortable`));
    headers.forEach((header) => {
      const sortKey = String(header.dataset.sortKey || '');
      const active = sortKey === String(sortState?.key || '');
      header.classList.toggle('is-active', active);
      header.dataset.sortDir = active ? String(sortState?.direction || 'desc') : '';
      header.setAttribute(
        'aria-sort',
        active ? (sortState?.direction === 'asc' ? 'ascending' : 'descending') : 'none',
      );
      const arrow = header.querySelector('.sf-sort-arrow');
      if (arrow) {
        arrow.textContent = active ? (sortState?.direction === 'asc' ? '↑' : '↓') : '';
      }
    });
  }

  function bindSortableHeaders(tableId, getSortState, setSortState, refreshFn) {
    const headers = Array.from(document.querySelectorAll(`#${tableId} th.sf-sortable`));
    headers.forEach((header) => {
      if (header.dataset.sortBound === 'true') return;
      header.dataset.sortBound = 'true';
      header.tabIndex = 0;
      header.setAttribute('role', 'button');
      const triggerSort = () => {
        const sortKey = String(header.dataset.sortKey || '').trim();
        if (!sortKey) return;
        const defaultDirection = String(header.dataset.sortDefault || 'desc');
        const current = getSortState() || {};
        const isSameKey = String(current.key || '') === sortKey;
        setSortState({
          key: sortKey,
          direction: isSameKey ? (current.direction === 'desc' ? 'asc' : 'desc') : defaultDirection,
        });
        updateSortableHeaders(tableId, getSortState());
        refreshFn();
      };
      header.addEventListener('click', triggerSort);
      header.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          triggerSort();
        }
      });
    });
    updateSortableHeaders(tableId, getSortState());
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}">${esc(text)}</td></tr>`;
  }

  window.NetOutcomesCommon = {
    esc,
    signed,
    classForSigned,
    pct,
    fetchJson,
    setText,
    formatLocalDateTime,
    formatLocalDate,
    normalizeText,
    updateSortableHeaders,
    bindSortableHeaders,
    emptyRow,
  };
})();
