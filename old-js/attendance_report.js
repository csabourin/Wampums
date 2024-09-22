import { openDB } from "./indexedDB.js";

export async function displayAttendanceReport() {
  try {
    const db = await openDB();
    const tx = db.transaction("offlineData", "readonly");
    const store = tx.objectStore("offlineData");

    const allDataRequest = store.getAll();
    const allData = await new Promise((resolve) => {
      allDataRequest.onsuccess = () => resolve(allDataRequest.result);
    });
    console.log("All IndexedDB data in displayAttendanceReport:", allData);

    const reportData = allData.find(
      (item) => item && item.action === "attendanceReport"
    );
    console.log("Report data found:", reportData);

    if (!reportData || !reportData.data) {
      document.getElementById(
        "report-container"
      ).innerHTML = `<p>${translations["no_report_data_available"]}</p>`;
      return;
    }

    const { start_date, end_date, overall_stats, participant_data } =
      reportData.data;

    if (!start_date || !end_date || !overall_stats || !participant_data) {
      document.getElementById(
        "report-container"
      ).innerHTML = `<p>${translations["invalid_report_data"]}</p>`;
      return;
    }

    let html = `
            <h2>${translations["report_period"]}: ${start_date} ${translations["to"]} ${end_date}</h2>
            <h3>${translations["overall_statistics"]}</h3>
            <ul>
                <li>${translations["total_participants"]}: ${overall_stats.total_participants}</li>
                <li>${translations["average_attendance_rate"]}: ${overall_stats.average_attendance_rate}%</li>
                <li>${translations["total_days_in_period"]}: ${overall_stats.total_days}</li>
            </ul>
            <h3>${translations["participant_attendance"]}</h3>
            <table>
                <thead>
                    <tr>
                        <th>${translations["name"]}</th>
                        <th>${translations["group"]}</th>
                        <th>${translations["attendance_rate"]}</th>
                        <th>${translations["days_present"]}</th>
                        <th>${translations["days_absent"]}</th>
                        <th>${translations["days_late"]}</th>
                    </tr>
                </thead>
                <tbody>
        `;

    participant_data.forEach((participant) => {
      html += `
                <tr>
                    <td>${participant.first_name} ${participant.last_name}</td>
                    <td>${participant.group_name}</td>
                    <td>${participant.attendance_rate}%</td>
                    <td>${participant.days_present}</td>
                    <td>${participant.days_absent}</td>
                    <td>${participant.days_late}</td>
                </tr>
            `;
    });

    html += `
                </tbody>
            </table>
        `;

    document.getElementById("report-container").innerHTML = html;
  } catch (error) {
    console.error("Error displaying attendance report:", error);
    document.getElementById(
      "report-container"
    ).innerHTML = `<p>${translations["error_loading_report"]}</p>`;
  }
}
