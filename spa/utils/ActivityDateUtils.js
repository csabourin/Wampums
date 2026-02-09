import { formatDateShort, isoToDateString, parseDate } from './DateUtils.js';

export function getActivityStartDate(activity) {
  const safeActivity = activity || {};
  return isoToDateString(safeActivity.activity_start_date || safeActivity.activity_date || '');
}

export function getActivityEndDate(activity) {
  const safeActivity = activity || {};
  return isoToDateString(
    safeActivity.activity_end_date ||
    safeActivity.activity_date ||
    safeActivity.activity_start_date ||
    ''
  );
}

export function getActivityStartTime(activity) {
  const safeActivity = activity || {};
  return safeActivity.activity_start_time || safeActivity.meeting_time_going || '';
}

export function getActivityEndTime(activity) {
  const safeActivity = activity || {};
  return safeActivity.activity_end_time || safeActivity.departure_time_return || safeActivity.departure_time_going || '';
}

export function getActivityStartDateObj(activity) {
  return parseDate(getActivityStartDate(activity));
}

export function getActivityEndDateObj(activity) {
  return parseDate(getActivityEndDate(activity));
}

export function formatActivityDateRange(activity = {}, lang = 'en') {
  const startDate = getActivityStartDate(activity);
  const endDate = getActivityEndDate(activity);
  const startTime = getActivityStartTime(activity);
  const endTime = getActivityEndTime(activity);

  if (!startDate && !endDate) return '';

  const startLabel = startDate ? formatDateShort(startDate, lang) : '';
  const endLabel = endDate ? formatDateShort(endDate, lang) : '';
  const startTimeLabel = startTime ? ` ${startTime}` : '';
  const endTimeLabel = endTime ? ` ${endTime}` : '';

  if (startDate && endDate && startDate === endDate) {
    if (startTime && endTime) {
      return `${startLabel}${startTimeLabel} - ${endTime}`;
    }
    return `${startLabel}${startTimeLabel}${endTimeLabel}`;
  }

  return `${startLabel}${startTimeLabel} - ${endLabel}${endTimeLabel}`;
}
