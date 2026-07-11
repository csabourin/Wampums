// BirthdayUtils.js
// Shared "upcoming birthdays between two meetings" logic (was duplicated in
// the meeting preparation and upcoming meeting views).
import { parseDate, isoToDateString } from './DateUtils.js';
import { normalizeDateString } from './MeetingDateUtils.js';

/**
 * Compute participant birthdays falling in [startDate, endDate).
 * @param {Array} participants - Participant records (date_naissance or date_of_birth)
 * @param {string} startDate - Range start (YYYY-MM-DD, inclusive)
 * @param {string} endDate - Range end (YYYY-MM-DD, exclusive)
 * @returns {{startDate: string|null, endDate: string|null, entries: Array<{id: number, name: string, date: string}>}}
 */
export function getUpcomingBirthdays(participants, startDate, endDate) {
  const normalizedStart = normalizeDateString(startDate);
  const normalizedEnd = normalizeDateString(endDate);

  if (!normalizedStart || !normalizedEnd) {
    return { startDate: normalizedStart || null, endDate: normalizedEnd || null, entries: [] };
  }

  const start = parseDate(normalizedStart);
  const end = parseDate(normalizedEnd);
  if (!start || !end) {
    return { startDate: normalizedStart, endDate: normalizedEnd, entries: [] };
  }

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const candidateYears = startYear === endYear ? [startYear] : [startYear, endYear];
  const list = Array.isArray(participants) ? participants : [];

  const entries = list.reduce((acc, participant) => {
    const birthDateRaw = participant.date_naissance || participant.date_of_birth;
    if (!birthDateRaw) {
      return acc;
    }

    const birthDate = parseDate(isoToDateString(birthDateRaw));
    if (!birthDate) {
      return acc;
    }

    const birthMonth = birthDate.getMonth();
    const birthDay = birthDate.getDate();
    let birthdayInRange = null;

    candidateYears.forEach(year => {
      const daysInMonth = new Date(year, birthMonth + 1, 0).getDate();
      const safeDay = Math.min(birthDay, daysInMonth);
      const candidate = new Date(year, birthMonth, safeDay);

      if (candidate >= start && candidate < end) {
        if (!birthdayInRange || candidate < birthdayInRange) {
          birthdayInRange = candidate;
        }
      }
    });

    if (!birthdayInRange) {
      return acc;
    }

    const fullName = [participant.first_name, participant.last_name].filter(Boolean).join(' ').trim();
    acc.push({
      id: participant.id,
      name: fullName || participant.full_name || '',
      date: isoToDateString(birthdayInRange)
    });
    return acc;
  }, []);

  entries.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return a.name.localeCompare(b.name);
  });

  return { startDate: normalizedStart, endDate: normalizedEnd, entries };
}
