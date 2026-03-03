function pad(value) {
  return String(value).padStart(2, '0');
}

function hasTimeHint(value) {
  if (!value) return false;
  const text = String(value);
  return /T\d{2}:\d{2}/.test(text) || /\d{1,2}:\d{2}/.test(text);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+/.test(text)) {
    const date = new Date(text.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const mmdd = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?)?/i
  );
  if (mmdd) {
    const month = Number(mmdd[1]);
    const day = Number(mmdd[2]);
    const year = Number(mmdd[3]);
    let hours = Number(mmdd[4] || 0);
    const minutes = Number(mmdd[5] || 0);
    const seconds = Number(mmdd[6] || 0);
    const ampm = mmdd[7] ? String(mmdd[7]).toUpperCase() : '';

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatDisplayDate(value, options = {}) {
  const { fallback = '', includeTime = true } = options;
  if (!value) return fallback;

  const date = parseDate(value);
  if (!date) return String(value);

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();

  if (!includeTime || !hasTimeHint(value)) {
    return `${day}/${month}/${year}`;
  }

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function formatIsoDateToDmy(value) {
  if (!value) return '';
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

export function parseDmyToIso(value) {
  if (!value) return '';
  const text = String(value).trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return '';
  }

  return `${year}-${pad(month)}-${pad(day)}`;
}
