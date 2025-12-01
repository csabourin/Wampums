/**
 * PrintManager - Handles printing functionality
 * for the Preparation Reunions page
 */
export class PrintManager {
        constructor(activityManager) {
                this.activityManager = activityManager;
        }

        /**
         * Print the preparation form
         */
        printPreparation() {
                const louveteauxDHonneur = document.getElementById("louveteau-dhonneur").innerHTML;
                const selectedActivities = this.activityManager.getSelectedActivities();

                const printContent = `
                        <div class="print-preparation">
                                <h1>6e MEUTE A - ST-PAUL D'AYLMER</h1>
                                <h2>RÉUNION HEBDOMADAIRE</h2>
                                <div class="print-header">
                                        <p><strong>Animateur responsable:</strong> ${document.getElementById("animateur-responsable").options[document.getElementById("animateur-responsable").selectedIndex].text}</p>
                                        <p><strong>Date:</strong> ${document.getElementById("date").value}</p>
                                </div>
                                <div class="print-header">
                                        <p><strong>Louveteau d'honneur:</strong></p>
                                        <ul>
                                                ${louveteauxDHonneur}
                                        </ul>
                                        <p><strong>Endroit:</strong> ${document.getElementById("endroit").value}</p>
                                </div>
                                <table>
                                        <thead>
                                                <tr>
                                                        <th>HEURE</th>
                                                        <th>Durée</th>
                                                        <th>DESCRIPTION</th>
                                                        <th>RESPONSABLE</th>
                                                        <th>MATÉRIEL</th>
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
                                        <h3>Notes:</h3>
                                        <p>${document.getElementById("notes").value}</p>
                                        <div class="handwritten-notes">
                                                <div class="note-line"></div>
                                                <div class="note-line"></div>
                                        </div>
                                </div>
                                <div class="print-next-week">
                                        <h3>Semaine Prochaine:</h3>
                                        <div class="handwritten-notes">
                                                <div class="note-line"></div>
                                                <div class="note-line"></div>
                                        </div>
                                </div>
                        </div>
                `;

                const printWindow = window.open('', '_blank');
                printWindow.document.write(`
                        <html>
                                <head>
                                        <title>Réunion Hebdomadaire</title>
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
                `);
                printWindow.document.close();
                printWindow.print();
        }
}
