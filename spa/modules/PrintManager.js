import { translate } from "../app.js";
import { getHonorLabel } from "../utils/meetingSections.js";
import { openPrintWindow, setPrintContent } from "../utils/PrintUtils.js";
/**
 * PrintManager - Handles printing functionality
 * for the Preparation Reunions page
 */
export class PrintManager {
        constructor(activityManager, sectionConfig, organizationName = '') {
                this.activityManager = activityManager;
                this.sectionConfig = sectionConfig;
                this.organizationName = organizationName;
        }

        /**
         * Update section configuration used for labels when printing
         * @param {object} sectionConfig - Active section config
         */
        setSectionConfig(sectionConfig) {
                this.sectionConfig = sectionConfig;
        }

        /**
         * Print the preparation form
         */
        printPreparation() {
                const honorListElement = document.getElementById("youth-of-honor");
                const honorItems = honorListElement
                        ? Array.from(honorListElement.querySelectorAll("li")).map((li) => li.textContent)
                        : [];
                const selectedActivities = this.activityManager.getSelectedActivities();
                const honorLabel = getHonorLabel(this.sectionConfig, translate);

                const printContent = `
                        <div class="print-preparation">
                                <h1>${this.organizationName}</h1>
                                <h2>${translate("weekly_meeting")}</h2>
                                <div class="print-header">
                                        <p><strong>${translate("responsible_leader")}:</strong> ${document.getElementById("animateur-responsable").options[document.getElementById("animateur-responsable").selectedIndex].text}</p>
                                        <p><strong>${translate("date")}:</strong> ${document.getElementById("date").value}</p>
                                </div>
                                <div class="print-header">
                                        <p><strong>${honorLabel}:</strong></p>
                                        <ul>
                                                ${honorItems.map(item => `<li>${item}</li>`).join('')}
                                        </ul>
                                        <p><strong>${translate("location")}:</strong> ${document.getElementById("endroit").value}</p>
                                </div>
                                <table>
                                        <thead>
                                                <tr>
                                                        <th>${translate("time")}</th>
                                                        <th>${translate("duration")}</th>
                                                        <th>${translate("description")}</th>
                                                        <th>${translate("responsible")}</th>
                                                        <th>${translate("equipment")}</th>
                                                </tr>
                                        </thead>
                                        <tbody>
                                                ${selectedActivities.map(a => `
                                                        <tr>
                                                                <td>${a.time}</td>
                                                                <td>${a.duration}</td>
                                                                <td>${a.activity}</td>
                                                                <td>${a.responsable || ''}</td>
                                                                <td>${a.materiel || ''}</td>
                                                        </tr>
                                                `).join('')}
                                        </tbody>
                                </table>
                                <div class="print-notes">
                                        <h3>${translate("notes")}:</h3>
                                        <p>${document.getElementById("notes").value}</p>
                                        <div class="handwritten-notes">
                                                <div class="note-line"></div>
                                                <div class="note-line"></div>
                                        </div>
                                </div>
                                <div class="print-next-week">
                                        <h3>${translate("next_week")}:</h3>
                                        <div class="handwritten-notes">
                                                <div class="note-line"></div>
                                                <div class="note-line"></div>
                                        </div>
                                </div>
                        </div>
                `;

                const printWindow = openPrintWindow();
                if (!printWindow) return;
                setPrintContent(printWindow, `
                        <html>
                                <head>
                                        <title>${translate("weekly_meeting")}</title>
                                        <style>
                                                body {
                                                        font-family: Arial, sans-serif;
                                                        line-height: 1.1;
                                                }
                                                .print-preparation {
                                                        max-width: 800px;
                                                        margin: 0 auto;
                                                }
                                                h1, h2 {
                                                        text-align: center;
                                                        margin:auto;
                                                }
                                                .print-header {
                                                        display: flex;
                                                        justify-content: space-between;
                                                }
                                                table {
                                                        width: 100%;
                                                        border-collapse: collapse;
                                                        margin-top: 20px;
                                                }
                                                th, td {
                                                        border: 1px solid black;
                                                        padding: 5px;
                                                        text-align: left;
                                                }
                                                .print-notes, .print-next-week {
                                                        margin-top: 20px;
                                                }
                                                .handwritten-notes {
                                                        margin-top: 10px;
                                                }
                                                .note-line {
                                                        height: 1.8em;
                                                        border-bottom: 1px solid #ccc;
                                                        margin-bottom: 10px;
                                                }
                                                @media print {
                                                        body {
                                                                font-size: 12pt;
                                                        }
                                                        .print-preparation {
                                                                max-width: 100%;
                                                        }
                                                }
                                        </style>
                                </head>
                                <body>
                                        ${printContent}
                                </body>
                        </html>
                `, translate("weekly_meeting"));
                printWindow.document.close();
                printWindow.print();
        }
}
