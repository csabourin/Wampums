import { translate } from "../app.js";
import { escapeAttribute, escapeHTML } from "../utils/SecurityUtils.js";
import { badgeLabel } from "../utils/BadgeLabelUtils.js";
import { debugLog } from "../utils/DebugUtils.js";
import { openModal } from "../utils/ModalUtils.js";

/**
 * AchievementModal - Modal for selecting badge achievements with participant assignment
 * Used in preparation_reunions for proie/battue tracking
 */
export class AchievementModal {
    /**
     * @param {Array} badgeTemplates - List of badge templates with id, name, image
     * @param {Array} participants - List of participants with id, first_name, last_name
     * @param {Function} onSave - Callback when user saves: (data) => void
     */
    constructor(badgeTemplates, participants, onSave) {
        this.badgeTemplates = badgeTemplates || [];
        this.participants = participants || [];
        this.onSave = onSave;
        this.modalId = "achievement-modal";
        this.selectedBadgeId = null;
        this.selectedType = "proie";
        this.selectedParticipantIds = [];
        this.activityIndex = null;
        this.handle = null;
    }

    /**
     * Open the modal with optional existing data
     * @param {Object} existingData - { badge_template_id, star_type, participant_ids, activityIndex }
     */
    open(existingData = {}) {
        this.selectedBadgeId = existingData.badge_template_id || null;
        this.selectedType = existingData.star_type || "proie";
        this.selectedParticipantIds = existingData.participant_ids || [];
        this.activityIndex = existingData.activityIndex;

        this.render();
        this.attachListeners();
    }

    /** Close the modal. */
    close() {
        this.handle?.close(true);
        this.handle = null;
    }

    render() {
        const pressed = (value) => (value ? "true" : "false");
        this.handle = openModal({
            id: this.modalId,
            title: translate("select_achievement") || "Select Achievement",
            className: "achievement-modal-content",
            size: "large",
            body: `
                <div class="achievement-modal__type-selection" role="group" aria-labelledby="achievement-type-label">
                    <span id="achievement-type-label">${translate("type") || "Type"}:</span>
                    <div class="achievement-modal__type-buttons">
                        <button type="button" class="achievement-type-btn ${this.selectedType === "proie" ? "active" : ""}" data-type="proie" aria-pressed="${pressed(this.selectedType === "proie")}">
                            ${translate("badge_type_proie") || "Proie"}
                        </button>
                        <button type="button" class="achievement-type-btn ${this.selectedType === "battue" ? "active" : ""}" data-type="battue" aria-pressed="${pressed(this.selectedType === "battue")}">
                            ${translate("badge_type_battue") || "Battue"}
                        </button>
                    </div>
                </div>

                <div class="achievement-modal__badges" role="group" aria-labelledby="achievement-badge-label">
                    <span id="achievement-badge-label">${translate("badge") || "Badge"}:</span>
                    ${this.renderBadgeGrid()}
                </div>

                <fieldset class="achievement-modal__participants ${this.selectedType === "battue" ? "hidden" : ""}">
                    <legend>${translate("participants") || "Participants"}:</legend>
                    ${this.renderParticipantGrid()}
                </fieldset>
            `,
            footer: `
                <button type="button" class="button button--secondary" data-modal-close>${translate("cancel") || "Cancel"}</button>
                <button type="button" class="button button--primary" id="achievement-save-btn">${translate("save") || "Save"}</button>
            `,
            onClose: () => { this.handle = null; },
        });
    }

    renderBadgeGrid() {
        if (this.badgeTemplates.length === 0) {
            return `<p class="achievement-modal__empty">${translate("no_badges_available") || "No badges available"}</p>`;
        }

        const badgeCards = this.badgeTemplates
            .map((badge) => {
                const isSelected =
                    String(badge.id) === String(this.selectedBadgeId);
                const imageUrl = badge.image || badge.image_url || "";
                const badgeName = badgeLabel(badge);

                return `
                                <button type="button" 
                                        class="achievement-badge-card ${isSelected ? "selected" : ""}"
                                        data-badge-id="${badge.id}"
                                        aria-pressed="${isSelected ? "true" : "false"}"
                                        title="${escapeAttribute(badgeName)}">
                                        ${
                                            imageUrl
                                                ? `<img src="/assets/images/${escapeHTML(imageUrl)}" alt="" class="achievement-badge-card__image" />`
                                                : `<div class="achievement-badge-card__placeholder" aria-hidden="true">★</div>`
                                        }
                                        <span class="achievement-badge-card__name">${escapeHTML(badgeName)}</span>
                                </button>
                        `;
            })
            .join("");

        return `<div class="achievement-badge-grid">${badgeCards}</div>`;
    }

    renderParticipantGrid() {
        if (this.participants.length === 0) {
            return `<p class="achievement-modal__empty">${translate("no_participants_available") || "No participants available"}</p>`;
        }

        const sortedParticipants = [...this.participants].sort((a, b) =>
            (a.first_name || "").localeCompare(b.first_name || ""),
        );

        const participantCheckboxes = sortedParticipants
            .map((p) => {
                const isChecked =
                    this.selectedParticipantIds.includes(String(p.id)) ||
                    this.selectedParticipantIds.includes(p.id);
                const fullName =
                    `${p.first_name || ""} ${p.last_name || ""}`.trim();

                return `
                                <label class="achievement-participant-item">
                                        <input type="checkbox" 
                                                class="achievement-participant-checkbox" 
                                                value="${p.id}" 
                                                ${isChecked ? "checked" : ""} />
                                        <span>${escapeHTML(fullName)}</span>
                                </label>
                        `;
            })
            .join("");

        return `<div class="achievement-participant-grid">${participantCheckboxes}</div>`;
    }

    attachListeners() {
        const modal = this.handle?.overlay;
        if (!modal) return;

        // Type selection
        modal.querySelectorAll(".achievement-type-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                this.selectedType = e.target.dataset.type;
                modal
                    .querySelectorAll(".achievement-type-btn")
                    .forEach((b) => {
                        b.classList.remove("active");
                        b.setAttribute("aria-pressed", "false");
                    });
                e.target.classList.add("active");
                e.target.setAttribute("aria-pressed", "true");

                const participantsSection = modal.querySelector(
                    ".achievement-modal__participants",
                );
                if (participantsSection) {
                    participantsSection.classList.toggle(
                        "hidden",
                        this.selectedType === "battue",
                    );
                }
            });
        });

        // Badge selection
        modal.querySelectorAll(".achievement-badge-card").forEach((card) => {
            card.addEventListener("click", (e) => {
                const badgeId = e.currentTarget.dataset.badgeId;
                this.selectedBadgeId = badgeId;
                modal
                    .querySelectorAll(".achievement-badge-card")
                    .forEach((c) => {
                        c.classList.remove("selected");
                        c.setAttribute("aria-pressed", "false");
                    });
                e.currentTarget.classList.add("selected");
                e.currentTarget.setAttribute("aria-pressed", "true");
            });
        });

        // Save button
        const saveBtn = modal.querySelector("#achievement-save-btn");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.handleSave());
        }
    }

    handleSave() {
        // Gather selected participants
        const modal = this.handle?.overlay;
        const checkedBoxes =
            modal?.querySelectorAll(
                ".achievement-participant-checkbox:checked",
            ) || [];
        this.selectedParticipantIds = Array.from(checkedBoxes).map(
            (cb) => cb.value,
        );

        const data = {
            badge_template_id: this.selectedBadgeId,
            star_type: this.selectedType,
            participant_ids: this.selectedParticipantIds,
            activityIndex: this.activityIndex,
        };

        debugLog("Achievement modal save:", data);

        if (this.onSave) {
            this.onSave(data);
        }

        this.close();
    }
}
