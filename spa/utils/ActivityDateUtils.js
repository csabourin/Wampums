import { formatDateShort, isoToDateString, parseDate } from './DateUtils.js';

export function getActivityStartDate(activity = {}) {
  return isoToDateString(activity.activity_start_date || activity.activity_date || '');
}

export function getActivityEndDate(activity = {}) {
  return isoToDateString(
    activity.activity_end_date ||
    activity.activity_date ||
    activity.activity_start_date ||
    ''
  );
}

export function getActivityStartTime(activity = {}) {
  return activity.activity_start_time || activity.meeting_time_going || '';
}

export function getActivityEndTime(activity = {}) {
  return activity.activity_end_time || activity.departure_time_return || activity.departure_time_going || '';
}

export function getActivityStartDateObj(activity = {}) {
  return parseDate(getActivityStartDate(activity));
}

export function getActivityEndDateObj(activity = {}) {
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
