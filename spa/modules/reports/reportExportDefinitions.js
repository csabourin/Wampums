/**
 * What each report puts in its CSV export.
 *
 * One definition per report, read from the fields the API really returns
 * (`routes/reports.js`). The export used to look for fields the API never
 * sends (`leave_alone`, `media_consent`, `total_days`…), so those columns were
 * empty or always "no", and it fell back to guessing columns for the reports
 * without a definition, which wrote internal ids and left out lists.
 */

/** Answers a form stores for "yes", compared in lower case. */
const AFFIRMATIVE_ANSWERS = new Set(['true', 'vrai', 'on', '1', 'yes', 'y', 'oui', 'o']);

/** Separator between the items of a list written in one cell. */
const LIST_SEPARATOR = ', ';

/** Separator between the contacts written in one cell. */
const CONTACT_SEPARATOR = ' | ';

/** Decimals of an amount of money. */
const MONEY_DECIMALS = 2;

/** Reports whose export has no data to offer. */
export const EXPORT_ERROR = Object.freeze({
  NO_DATA: 'no_data_to_export',
  UNSUPPORTED: 'export_not_supported_for_type',
});

/**
 * Read a form answer the way the server does (`utils/health-form.js`).
 *
 * @param {*} value - `true`, `1`, `'oui'`, `'on'`, `'1'`…
 * @returns {boolean} True when the answer is affirmative
 */
export function isAffirmativeAnswer(value) {
  if (value === true) {return true;}
  if (typeof value === 'number') {return value === 1;}
  if (typeof value !== 'string') {return false;}
  return AFFIRMATIVE_ANSWERS.has(value.trim().toLowerCase());
}

/**
 * @param {Object} helpers - `{ translate }`
 * @returns {Function} Column format writing a form answer as yes or no
 */
function yesNoFormat({ translate }) {
  return (value) => (isAffirmativeAnswer(value) ? translate('yes') : translate('no'));
}

/**
 * First name, last name and group: the first three columns of most reports.
 *
 * @param {Object} helpers - `{ translate }`
 * @returns {Array<Object>} Column definitions
 */
function identityColumns({ translate }) {
  return [
    { key: 'first_name', label: translate('first_name') },
    { key: 'last_name', label: translate('last_name') },
    { key: 'group_name', label: translate('group') },
  ];
}

/**
 * @param {Array<Object>} contacts - Emergency contacts of a health record
 * @returns {string} One line per contact, joined: name, relationship, phone
 */
function formatEmergencyContacts(contacts) {
  return (Array.isArray(contacts) ? contacts : [])
    .map((contact) => [
      contact.name,
      contact.relationship,
      contact.phone_mobile || contact.phone_home || contact.phone_work,
    ].filter(Boolean).join(' '))
    .join(CONTACT_SEPARATOR);
}

/**
 * @param {*} list - An array, an object of values or nothing
 * @returns {string} The items on one line
 */
function formatList(list) {
  if (Array.isArray(list)) {return list.join(LIST_SEPARATOR);}
  if (list && typeof list === 'object') {return Object.values(list).join(LIST_SEPARATOR);}
  return '';
}

/**
 * @param {Object} row - Attendance row with a `summary` of counts per status
 * @param {string} status - `present`, `absent`, `late` or `excused`
 * @returns {number} Days recorded with that status
 */
function summaryCount(row, status) {
  return Number(row?.summary?.[status]) || 0;
}

/**
 * Attendance has one column per date on top of the totals.
 *
 * @param {Array<Object>} rows - Attendance rows
 * @param {Object} helpers - `{ translate, lang, formatDateShort, isoToDateString }`
 * @returns {Array<Object>} Column definitions
 */
function attendanceColumns(rows, helpers) {
  const { translate, lang, formatDateShort, isoToDateString } = helpers;

  const columns = [
    ...identityColumns(helpers),
    {
      key: 'summary',
      label: translate('total_days'),
      format: (_, row) => ['present', 'absent', 'late', 'excused']
        .reduce((total, status) => total + summaryCount(row, status), 0),
    },
    { key: 'summary', label: translate('days_absent'), format: (_, row) => summaryCount(row, 'absent') },
    { key: 'summary', label: translate('excused'), format: (_, row) => summaryCount(row, 'excused') },
    { key: 'summary', label: translate('days_late'), format: (_, row) => summaryCount(row, 'late') },
  ];

  const dates = new Set();
  rows.forEach((participant) => {
    (participant.attendance || []).forEach((entry) => {
      if (entry.date) {dates.add(isoToDateString(entry.date));}
    });
  });

  Array.from(dates).sort().forEach((date) => {
    columns.push({
      key: `date_${date}`,
      label: formatDateShort(date, lang),
      format: (_, row) => {
        const entry = (row.attendance || []).find((item) => isoToDateString(item.date) === date);
        return entry ? (translate(entry.status) || entry.status) : '';
      },
    });
  });

  return columns;
}

/**
 * Columns of a report nobody described: every plain field, except the ids.
 *
 * @param {Object} sample - First row
 * @param {Object} helpers - `{ translate }`
 * @returns {Array<Object>} Column definitions
 */
function guessedColumns(sample, { translate }) {
  return Object.keys(sample)
    .filter((key) => key !== 'id' && !key.endsWith('_id'))
    .filter((key) => typeof sample[key] !== 'object' && typeof sample[key] !== 'function')
    .map((key) => ({ key, label: translate(key) || key }));
}

/**
 * Describe the CSV export of the report on screen.
 *
 * @param {string} reportType - The report's key (`allergies`, `health`…)
 * @param {*} reportData - What the report loaded
 * @param {{translate: Function, lang?: string, formatDateShort: Function, isoToDateString: Function}} helpers
 * @returns {{rows: Array<Object>, columns: Array<Object>}|{error: string}} What to export, or why nothing can be
 */
export function buildReportExport(reportType, reportData, helpers) {
  const { translate, lang, formatDateShort } = helpers;
  const yesNo = yesNoFormat(helpers);

  // Attendance keeps its rows under `data`; the other reports are the rows.
  const rows = reportType === 'attendance' ? reportData?.data : reportData;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: EXPORT_ERROR.NO_DATA };
  }

  let columns;

  switch (reportType) {
    case 'health':
      columns = [
        ...identityColumns(helpers),
        { key: 'allergies', label: translate('allergies') },
        { key: 'epipen', label: translate('epipen'), format: yesNo },
        { key: 'medications', label: translate('medication') },
        { key: 'probleme_sante', label: translate('health_issues') },
        { key: 'limitations', label: translate('limitations') },
        { key: 'blessures_operations', label: translate('injuries') },
        { key: 'niveau_natation', label: translate('swimming_level'), format: (value) => (value ? translate(value) : '') },
        { key: 'doit_porter_vfi', label: translate('doit_porter_vfi'), format: yesNo },
        { key: 'vaccins_a_jour', label: translate('vaccines_up_to_date'), format: yesNo },
        { key: 'nom_medecin', label: translate('nom_medecin_label') },
        { key: 'emergency_contacts', label: translate('emergency_contacts'), format: formatEmergencyContacts },
      ];
      break;
    case 'allergies':
      columns = [
        ...identityColumns(helpers),
        { key: 'allergies', label: translate('allergies') },
        { key: 'allergy_severity', label: translate('allergy_severity') },
        { key: 'allergy_reaction', label: translate('allergy_reaction') },
        { key: 'allergy_action', label: translate('allergy_action') },
        { key: 'epipen', label: translate('epipen'), format: yesNo },
        { key: 'emergency_medication', label: translate('emergency_medication') },
        // The screen shows the limitations when there is no note.
        { key: 'notes', label: translate('notes'), format: (note, row) => note || row.limitations || '' },
      ];
      break;
    case 'medication':
      columns = [
        ...identityColumns(helpers),
        { key: 'medication', label: translate('medication') },
      ];
      break;
    case 'vaccines':
      columns = [
        ...identityColumns(helpers),
        { key: 'vaccines_up_to_date', label: translate('vaccines_up_to_date'), format: yesNo },
      ];
      break;
    case 'leave-alone':
      columns = [
        ...identityColumns(helpers),
        { key: 'can_leave_alone', label: translate('can_leave_alone'), format: yesNo },
      ];
      break;
    case 'media-authorization':
      columns = [
        ...identityColumns(helpers),
        { key: 'media_authorized', label: translate('media_authorized'), format: yesNo },
      ];
      break;
    case 'attendance':
      columns = attendanceColumns(rows, helpers);
      break;
    case 'missing-documents':
      columns = [
        ...identityColumns(helpers),
        {
          key: 'missing_documents',
          label: translate('missing_documents'),
          format: (_, row) => formatList(row.missing_forms) || translate('no_missing_documents'),
        },
      ];
      break;
    case 'missing-fields':
      columns = [
        ...identityColumns(helpers),
        { key: 'missing_fields', label: translate('missing_fields') },
      ];
      break;
    case 'honors':
      columns = [
        { key: 'date', label: translate('date'), format: (date) => formatDateShort(date, lang) },
        { key: 'count', label: translate('count') },
        { key: 'recipients', label: translate('recipients'), format: formatList },
      ];
      break;
    case 'points':
      columns = [
        ...identityColumns(helpers),
        { key: 'total_points', label: translate('points') },
        { key: 'honors_count', label: translate('honors_count') },
      ];
      break;
    case 'financial':
      columns = [
        { key: 'first_name', label: translate('first_name') },
        { key: 'last_name', label: translate('last_name') },
        { key: 'total_billed', label: translate('total_billed'), format: (value) => Number(value || 0).toFixed(MONEY_DECIMALS) },
        { key: 'total_paid', label: translate('total_paid'), format: (value) => Number(value || 0).toFixed(MONEY_DECIMALS) },
        { key: 'total_outstanding', label: translate('outstanding_balance'), format: (value) => Number(value || 0).toFixed(MONEY_DECIMALS) },
      ];
      break;
    case 'participant-age':
      columns = [
        ...identityColumns(helpers),
        { key: 'date_naissance', label: translate('birthdate'), format: (value) => (value ? formatDateShort(value, lang) : '') },
        { key: 'age', label: translate('age') },
      ];
      break;
    default:
      if (typeof rows[0] !== 'object' || rows[0] === null) {
        return { error: EXPORT_ERROR.UNSUPPORTED };
      }
      columns = guessedColumns(rows[0], helpers);
  }

  return { rows, columns };
}
