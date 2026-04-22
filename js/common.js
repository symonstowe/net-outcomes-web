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

  function formatUtcDateTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(dt);
  }

  function formatVenueDateTime(value, venueTimeZone, venueUtcOffset) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);

    const tz = String(venueTimeZone || '').trim();
    if (tz) {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: tz,
          timeZoneName: 'short',
        }).format(dt);
      } catch (error) {
        // Fall through to the offset fallback below.
      }
    }

    const offsetText = String(venueUtcOffset || '').trim();
    if (offsetText) {
      const match = offsetText.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (match) {
        const [, sign, hoursText, minutesText] = match;
        const totalMinutes = (Number(hoursText) * 60 + Number(minutesText))
          * (sign === '-' ? -1 : 1);
        const shifted = new Date(dt.getTime() + totalMinutes * 60 * 1000);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[shifted.getUTCMonth()] || '';
        const day = shifted.getUTCDate();
        const year = shifted.getUTCFullYear();
        const rawHours = shifted.getUTCHours();
        const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
        const meridiem = rawHours >= 12 ? 'PM' : 'AM';
        const hour12 = rawHours % 12 || 12;
        return `${month} ${day}, ${year} ${hour12}:${minutes} ${meridiem} UTC${offsetText}`;
      }
    }

    return formatUtcDateTime(value);
  }

  function formatGameDateTime(row) {
    if (!row || typeof row !== 'object') {
      return formatVenueDateTime(row);
    }
    if (row.start_time_label) return String(row.start_time_label);
    return formatVenueDateTime(row.start_time_utc || row.game_date, row.venue_timezone, row.venue_utc_offset);
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
    formatUtcDateTime,
    formatVenueDateTime,
    formatGameDateTime,
    formatLocalDate,
    normalizeText,
    updateSortableHeaders,
    bindSortableHeaders,
    emptyRow,
  };
})();
