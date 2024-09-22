import { openDB } from "./indexedDB.js";

export async function displayHealthContactReport() {
  try {
    const db = await openDB();
    const tx = db.transaction("offlineData", "readonly");
    const store = tx.objectStore("offlineData");

    // Check all keys in the store
    const allKeys = await store.getAllKeys();
    console.log("All keys in offlineData store:", allKeys);

    // Use a promise to wait for the data
    const reportDataEntry = await new Promise((resolve, reject) => {
      const request = store.get("healthContactReport");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    console.log("Retrieved report data entry:", reportDataEntry);

    if (!reportDataEntry || !reportDataEntry.data) {
      document.getElementById(
        "report-container"
      ).innerHTML = `<p>${translations["no_report_data_available"]}</p>`;
      return;
    }

    const participantData = reportDataEntry.data;

    console.log("Participant data:", participantData);

    let html = `
            <input type="text" id="searchInput" placeholder="${translations["search_participants"]}">
            <div id="participantList">
        `;

    participantData.forEach((participant) => {
      html += `
                <div class="participant-card" data-participant-id="${
                  participant.participant_id
                }">
                    <h2>${participant.first_name} ${participant.last_name}</h2>
                    <p>${translations["group"]}: ${participant.group_name}</p>
                    <p>${translations["date_of_birth"]}: ${
        participant.date_naissance
      }</p>
                    <button onclick="toggleDetails(${
                      participant.participant_id
                    })">${translations["show_details"]}</button>
                    <div id="details-${
                      participant.participant_id
                    }" style="display:none;">
                        <h3>${translations["health_information"]}</h3>
                        <p>${translations["health_problems"]}: ${
        participant.probleme_sante || translations["none"]
      }</p>
                        <p>${translations["allergies"]}: ${
        participant.allergie || translations["none"]
      }</p>
                        <p>${translations["epipen"]}: ${
        participant.epipen ? translations["yes"] : translations["no"]
      }</p>
                        <p>${translations["medications"]}: ${
        participant.medicament || translations["none"]
      }</p>
                        <p>${translations["limitations"]}: ${
        participant.limitation || translations["none"]
      }</p>
                        <p>${translations["vaccinations_up_to_date"]}: ${
        participant.vaccins_a_jour ? translations["yes"] : translations["no"]
      }</p>
                        <p>${translations["injuries_operations"]}: ${
        participant.blessures_operations || translations["none"]
      }</p>
                        <p>${translations["swimming_level"]}: ${
        participant.niveau_natation
      }</p>
                        <p>${translations["must_wear_pfd"]}: ${
        participant.doit_porter_vfi ? translations["yes"] : translations["no"]
      }</p>

                        <h3>${translations["emergency_contacts"]}</h3>
                        <p>${translations["primary_contact"]}: ${
        participant.contact_urgence_1_nom
      } (${participant.contact_urgence_1_lien})</p>
                        <p>${translations["phone"]}: ${
        participant.contact_urgence_1_telephone
      }</p>
                        <p>${translations["secondary_contact"]}: ${
        participant.contact_urgence_2_nom
      } (${participant.contact_urgence_2_lien})</p>
                        <p>${translations["phone"]}: ${
        participant.contact_urgence_2_telephone
      }</p>
                    </div>
                </div>
            `;
    });

    html += "</div>";

    document.getElementById("report-container").innerHTML = html;

    // Add search functionality
    document
      .getElementById("searchInput")
      .addEventListener("input", function () {
        const searchValue = this.value.toLowerCase();
        document.querySelectorAll(".participant-card").forEach((card) => {
          const name = card.querySelector("h2").textContent.toLowerCase();
          card.style.display = name.includes(searchValue) ? "" : "none";
        });
      });
  } catch (error) {
    console.error("Error displaying health and contact report:", error);
    document.getElementById(
      "report-container"
    ).innerHTML = `<p>${translations["error_loading_report"]}</p>`;
  }
}

// Function to toggle details visibility
window.toggleDetails = function (participantId) {
  const detailsElement = document.getElementById(`details-${participantId}`);
  if (detailsElement) {
    detailsElement.style.display =
      detailsElement.style.display === "none" ? "block" : "none";
  }
};
