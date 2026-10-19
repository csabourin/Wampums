import { translate } from '../app.js';
import { getHonorLabel } from '../utils/meetingSections.js';
import { openPrintWindow, setPrintContent } from '../utils/PrintUtils.js';
import { escapeHTML } from '../utils/SecurityUtils.js';

/**
 * Paper styles for the printed meeting preparation.
 * Passed to setPrintContent() as styles: the sanitizer drops a <style> in the markup.
 */
const MEETING_PRINT_STYLES = `
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
  .print-notes__text {
    white-space: pre-wrap;
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
`;

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
    const honorListElement = document.getElementById('youth-of-honor');
    const honorItems = honorListElement
      ? Array.from(honorListElement.querySelectorAll('li')).map((li) => li.textContent)
      : [];
    const selectedActivities = this.activityManager.getSelectedActivities();
    const honorLabel = getHonorLabel(this.sectionConfig, translate);
    const leaderSelect = document.getElementById('animateur-responsable');
    const leader = leaderSelect?.options[leaderSelect.selectedIndex]?.text || '';
    // What leaders typed is text: a "<" in a note or an activity is printed
    // as written, never read as markup.
    const text = (value) => escapeHTML(String(value ?? ''));
    const fieldValue = (id) => text(document.getElementById(id)?.value);

    const printContent = `
      <div class="print-preparation">
        <h1>${text(this.organizationName)}</h1>
        <h2>${translate('weekly_meeting')}</h2>
        <div class="print-header">
          <p><strong>${translate('responsible_leader')}:</strong> ${text(leader)}</p>
          <p><strong>${translate('date')}:</strong> ${fieldValue('date')}</p>
        </div>
        <div class="print-header">
          <p><strong>${text(honorLabel)}:</strong></p>
          <ul>
            ${honorItems.map((item) => `<li>${text(item)}</li>`).join('')}
          </ul>
          <p><strong>${translate('location')}:</strong> ${fieldValue('endroit')}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">${translate('time')}</th>
              <th scope="col">${translate('duration')}</th>
              <th scope="col">${translate('description')}</th>
              <th scope="col">${translate('responsible')}</th>
              <th scope="col">${translate('equipment')}</th>
            </tr>
          </thead>
          <tbody>
            ${selectedActivities.map((a) => `
              <tr>
                <td>${text(a.time)}</td>
                <td>${text(a.duration)}</td>
                <td>${text(a.activity)}</td>
                <td>${text(a.responsable)}</td>
                <td>${text(a.materiel)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="print-notes">
          <h3>${translate('notes')}:</h3>
          <p class="print-notes__text">${fieldValue('notes')}</p>
          <div class="handwritten-notes">
            <div class="note-line"></div>
            <div class="note-line"></div>
          </div>
        </div>
        <div class="print-next-week">
          <h3>${translate('next_week')}:</h3>
          <div class="handwritten-notes">
            <div class="note-line"></div>
            <div class="note-line"></div>
          </div>
        </div>
      </div>
    `;

    const printWindow = openPrintWindow();
    if (!printWindow) {return;}
    setPrintContent(printWindow, `
                                        ${printContent}
    `, translate('weekly_meeting'), { styles: MEETING_PRINT_STYLES });
    printWindow.document.close();
    printWindow.print();
  }
}
