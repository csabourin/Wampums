const { AI_LIMITS } = require('../config/constants');

const AI_MODES = new Set(['meeting_plan', 'rewrite', 'translate', 'risk_suggest']);
const SUPPORTED_LOCALES = new Set(['en', 'fr', 'it', 'uk']);
const REWRITE_TONES = new Set(['professional', 'friendly', 'concise', 'clear']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^\d{1,3}:\d{2}$/u;
const TERM_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addError(errors, field, message) {
  errors.push({ field, msg: message });
}

function normalizeText(value, field, errors, options = {}) {
  const {
    required = true,
    maxLength = AI_LIMITS.MAX_SHORT_TEXT_LENGTH,
    defaultValue = '',
  } = options;

  if (value === undefined || value === null) {
    if (required) addError(errors, field, 'Field is required');
    return defaultValue;
  }
  if (typeof value !== 'string') {
    addError(errors, field, 'Field must be text');
    return defaultValue;
  }

  const normalized = value.trim();
  if (required && !normalized) addError(errors, field, 'Field cannot be empty');
  if (normalized.length > maxLength) {
    addError(errors, field, `Field must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    addError(errors, field, 'Field contains unsupported control characters');
  }
  return normalized.slice(0, maxLength);
}

function normalizeInteger(value, field, errors, minimum, maximum, defaultValue) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    addError(errors, field, `Field must be an integer between ${minimum} and ${maximum}`);
    return defaultValue;
  }
  return normalized;
}

function normalizeMeetingPlan(payload, errors) {
  const isActivityPlan = payload.durationMinutes !== undefined
    || payload.badgeFocus !== undefined
    || payload.participantsCount !== undefined;

  if (isActivityPlan) {
    return {
      requestType: 'activity_plan',
      durationMinutes: normalizeInteger(
        payload.durationMinutes,
        'payload.durationMinutes',
        errors,
        AI_LIMITS.MIN_DURATION_MINUTES,
        AI_LIMITS.MAX_DURATION_MINUTES,
        60
      ),
      badgeFocus: normalizeText(payload.badgeFocus, 'payload.badgeFocus', errors),
      participantsCount: normalizeInteger(
        payload.participantsCount,
        'payload.participantsCount',
        errors,
        1,
        AI_LIMITS.MAX_PARTICIPANTS,
        20
      ),
    };
  }

  const locale = typeof payload.locale === 'string' ? payload.locale.toLowerCase() : 'fr';
  if (!SUPPORTED_LOCALES.has(locale)) addError(errors, 'payload.locale', 'Unsupported locale');

  const date = normalizeText(payload.date, 'payload.date', errors, { maxLength: 10 });
  if (date && !DATE_PATTERN.test(date)) addError(errors, 'payload.date', 'Date must use YYYY-MM-DD');

  if (payload.activityTemplates !== undefined && !Array.isArray(payload.activityTemplates)) {
    addError(errors, 'payload.activityTemplates', 'Activity templates must be an array');
  }
  const activityTemplates = Array.isArray(payload.activityTemplates)
    ? payload.activityTemplates.slice(0, AI_LIMITS.MAX_ACTIVITY_TEMPLATES).map((template, index) => {
      if (!isPlainObject(template)) {
        addError(errors, `payload.activityTemplates.${index}`, 'Activity template must be an object');
        return null;
      }
      const time = normalizeText(template.time, `payload.activityTemplates.${index}.time`, errors, { maxLength: 8 });
      const duration = normalizeText(template.duration, `payload.activityTemplates.${index}.duration`, errors, { maxLength: 8 });
      if (time && !TIME_PATTERN.test(time)) addError(errors, `payload.activityTemplates.${index}.time`, 'Invalid time');
      if (duration && !TIME_PATTERN.test(duration)) addError(errors, `payload.activityTemplates.${index}.duration`, 'Invalid duration');
      return {
        time,
        duration,
        activity: normalizeText(template.activity, `payload.activityTemplates.${index}.activity`, errors),
        type: normalizeText(template.type, `payload.activityTemplates.${index}.type`, errors, { required: false }),
      };
    }).filter(Boolean)
    : [];
  if (Array.isArray(payload.activityTemplates) && payload.activityTemplates.length > AI_LIMITS.MAX_ACTIVITY_TEMPLATES) {
    addError(errors, 'payload.activityTemplates', 'Too many activity templates');
  }

  const vocabulary = {};
  if (payload.vocabulary !== undefined && !isPlainObject(payload.vocabulary)) {
    addError(errors, 'payload.vocabulary', 'Vocabulary must be an object');
  } else {
    const entries = Object.entries(payload.vocabulary || {});
    if (entries.length > AI_LIMITS.MAX_VOCABULARY_TERMS) {
      addError(errors, 'payload.vocabulary', 'Too many vocabulary terms');
    }
    entries.slice(0, AI_LIMITS.MAX_VOCABULARY_TERMS).forEach(([key, value]) => {
      if (!TERM_KEY_PATTERN.test(key)) {
        addError(errors, `payload.vocabulary.${key}`, 'Invalid vocabulary key');
        return;
      }
      vocabulary[key] = normalizeText(value, `payload.vocabulary.${key}`, errors, { maxLength: 80 });
    });
  }

  let recentHonor = null;
  if (payload.recentHonor !== undefined && payload.recentHonor !== null) {
    if (!isPlainObject(payload.recentHonor)) {
      addError(errors, 'payload.recentHonor', 'Recent recognition must be an object');
    } else {
      recentHonor = {
        name: normalizeText(payload.recentHonor.name, 'payload.recentHonor.name', errors, { maxLength: 120 }),
        honor: normalizeText(payload.recentHonor.honor, 'payload.recentHonor.honor', errors, { maxLength: 120 }),
        date: normalizeText(payload.recentHonor.date, 'payload.recentHonor.date', errors, { maxLength: 10 }),
      };
      if (recentHonor.date && !DATE_PATTERN.test(recentHonor.date)) {
        addError(errors, 'payload.recentHonor.date', 'Date must use YYYY-MM-DD');
      }
    }
  }

  return {
    requestType: 'meeting_plan',
    locale: SUPPORTED_LOCALES.has(locale) ? locale : 'fr',
    date,
    section: normalizeText(payload.section, 'payload.section', errors, { maxLength: 120 }),
    duration: normalizeText(payload.duration, 'payload.duration', errors, { maxLength: 40 }),
    focus: normalizeText(payload.focus, 'payload.focus', errors, {
      required: false,
      maxLength: AI_LIMITS.MAX_FOCUS_LENGTH,
    }),
    theme: normalizeText(payload.theme, 'payload.theme', errors, { required: false }),
    activityTemplates,
    recentHonor,
    vocabulary,
  };
}

/**
 * Validate and copy mode-specific AI input into a bounded, plain object. Unknown
 * properties are discarded so client-provided prompt instructions cannot become
 * trusted service configuration.
 */
function validateAIPayload(mode, input) {
  const errors = [];
  if (!AI_MODES.has(mode)) {
    addError(errors, 'mode', 'Invalid AI mode');
    return { value: null, errors };
  }
  if (!isPlainObject(input)) {
    addError(errors, 'payload', 'Payload must be an object');
    return { value: null, errors };
  }

  let value;
  if (mode === 'meeting_plan') {
    value = normalizeMeetingPlan(input, errors);
  } else if (mode === 'rewrite') {
    const tone = typeof input.tone === 'string' ? input.tone.toLowerCase() : '';
    if (!REWRITE_TONES.has(tone)) addError(errors, 'payload.tone', 'Unsupported rewrite tone');
    value = {
      tone: REWRITE_TONES.has(tone) ? tone : 'professional',
      text: normalizeText(input.text, 'payload.text', errors, { maxLength: AI_LIMITS.MAX_TEXT_LENGTH }),
    };
  } else if (mode === 'translate') {
    const from = typeof input.from === 'string' ? input.from.toLowerCase() : '';
    const to = typeof input.to === 'string' ? input.to.toLowerCase() : '';
    if (!SUPPORTED_LOCALES.has(from)) addError(errors, 'payload.from', 'Unsupported source locale');
    if (!SUPPORTED_LOCALES.has(to)) addError(errors, 'payload.to', 'Unsupported target locale');
    if (from && from === to) addError(errors, 'payload.to', 'Target locale must differ from source locale');
    value = {
      from: SUPPORTED_LOCALES.has(from) ? from : 'fr',
      to: SUPPORTED_LOCALES.has(to) ? to : 'en',
      text: normalizeText(input.text, 'payload.text', errors, { maxLength: AI_LIMITS.MAX_TEXT_LENGTH }),
    };
  } else {
    value = {
      activityDescription: normalizeText(
        input.activityDescription,
        'payload.activityDescription',
        errors,
        { maxLength: AI_LIMITS.MAX_TEXT_LENGTH }
      ),
    };
  }

  return { value, errors };
}

module.exports = { AI_MODES, validateAIPayload };
