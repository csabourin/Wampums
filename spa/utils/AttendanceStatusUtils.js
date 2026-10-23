/** Display departures without changing the stored attendance status or its point credit. */
export function attendanceDisplayStatus(record) {
  const status = record.status || record.attendance_status;
  return record.is_on_site === false && ['present', 'late'].includes(status) ? 'departed' : status;
}
