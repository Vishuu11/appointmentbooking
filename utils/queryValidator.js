const DEFAULT_ALLOWED_FIELDS = [
  'start',
  'end',
  'summary',
  'status',
  'email',
  'organizerEmail',
  'creatorEmail',
];

const DEFAULT_ALLOWED_OPERATORS = ['$eq', '$gte', '$lte', '$and', '$or', '$regex'];

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeFieldCondition(field, condition, allowedOperators) {
  if (isPlainObject(condition)) {
    const cleaned = {};
    for (const [op, val] of Object.entries(condition)) {
      if (!allowedOperators.has(op)) {
        throw new Error(`Operator ${op} is not allowed.`);
      }
      if (op === '$regex') {
        if (typeof val !== 'string') {
          throw new Error(`$regex value for ${field} must be a string.`);
        }
        cleaned[op] = new RegExp(val, 'i');
        continue;
      }
      if (op === '$eq' || op === '$gte' || op === '$lte') {
        if (val === undefined) {
          throw new Error(`Operator ${op} on ${field} requires a value.`);
        }
        if (field === 'summary' && op === '$eq' && typeof val === 'string') {
          cleaned.$regex = new RegExp(val, 'i');
        } else {
          cleaned[op] = val;
        }
        continue;
      }
    }
    if (!Object.keys(cleaned).length) {
      throw new Error(`No valid operators for ${field}.`);
    }
    return cleaned;
  }

  if (Array.isArray(condition)) {
    throw new Error(`Array conditions are not allowed for ${field}.`);
  }

  if (field === 'summary' && typeof condition === 'string') {
    return { $regex: new RegExp(condition, 'i') };
  }
  return { $eq: condition };
}

function sanitizeNode(node, allowedFields, allowedOperators) {
  if (!isPlainObject(node)) {
    throw new Error('Filter must be a JSON object.');
  }

  const cleaned = {};

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) {
      if (!allowedOperators.has(key)) {
        throw new Error(`Operator ${key} is not allowed.`);
      }
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`${key} must be a non-empty array.`);
        }
        cleaned[key] = value.map((child) => sanitizeNode(child, allowedFields, allowedOperators));
        continue;
      }
      throw new Error(`Operator ${key} is not allowed at top level.`);
    }

    if (!allowedFields.has(key)) {
      throw new Error(`Field ${key} is not allowed.`);
    }

    cleaned[key] = sanitizeFieldCondition(key, value, allowedOperators);
  }

  return cleaned;
}

function stripSystemFields(node, systemFields) {
  if (!isPlainObject(node)) return node;
  const cleaned = {};
  for (const [key, value] of Object.entries(node)) {
    if (systemFields.has(key)) {
      continue;
    }
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        const stripped = value
          .map((child) => stripSystemFields(child, systemFields))
          .filter((child) => isPlainObject(child) && Object.keys(child).length > 0);
        if (stripped.length) {
          cleaned[key] = stripped;
        }
      }
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function validateAndSanitizeFilter(filter, options = {}) {
  const allowedFields = new Set(options.allowedFields || DEFAULT_ALLOWED_FIELDS);
  const allowedOperators = new Set(options.allowedOperators || DEFAULT_ALLOWED_OPERATORS);

  if (!filter || !isPlainObject(filter)) {
    throw new Error('Filter must be a JSON object.');
  }

  return sanitizeNode(filter, allowedFields, allowedOperators);
}

module.exports = {
  validateAndSanitizeFilter,
  stripSystemFields,
  DEFAULT_ALLOWED_FIELDS,
  DEFAULT_ALLOWED_OPERATORS,
};
