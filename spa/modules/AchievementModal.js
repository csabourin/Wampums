import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { debugLog } from "../utils/DebugUtils.js";
import { setContent } from "../utils/DOMUtils.js";

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

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.remove();
        }
    }

    render() {
        // Remove existing modal if any
        this.close();

        const modalHtml = `
                        <div id="${this.modalId}" class="modal show" role="dialog" aria-modal="true" aria-labelledby="achievement-modal-title">
                                <div class="modal-content achievement-modal-content">
                                        <div class="modal-header">
                                                <h2 id="achievement-modal-title">${translate("select_achievement") || "Select Achievement"}</h2>
                                                <button type="button" class="modal-close" data-dismiss="modal" aria-label="${translate("close")}">×</button>
                                        </div>
                                        <div class="modal-body">
                                                <div class="achievement-modal__type-selection">
                                                        <label>${translate("type") || "Type"}:</label>
                                                        <div class="achievement-modal__type-buttons">
                                                                <button type="button" class="achievement-type-btn ${this.selectedType === "proie" ? "active" : ""}" data-type="proie">
                                                                        ${translate("badge_type_proie") || "Proie"}
                                                                </button>
                                                                <button type="button" class="achievement-type-btn ${this.selectedType === "battue" ? "active" : ""}" data-type="battue">
                                                                        ${translate("badge_type_battue") || "Battue"}
                                                                </button>
                                                        </div>
                                                </div>

                                                <div class="achievement-modal__badges">
                                                        <label>${translate("badge") || "Badge"}:</label>
                                                        ${this.renderBadgeGrid()}
                                                </div>

                                                <div class="achievement-modal__participants ${this.selectedType === "battue" ? "hidden" : ""}">
                                                        <label>${translate("participants") || "Participants"}:</label>
                                                        ${this.renderParticipantGrid()}
                                                </div>
                                        </div>
                                        <div class="modal-actions">
                                                <button type="button" class="button button--secondary" data-dismiss="modal">${translate("cancel") || "Cancel"}</button>
                                                <button type="button" class="button button--primary" id="achievement-save-btn">${translate("save") || "Save"}</button>
                                        </div>
                                </div>
                        </div>
                `;

        document.body.insertAdjacentHTML("beforeend", modalHtml);
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
                const badgeName =
                    translate(badge.translation_key) ||
                    badge.name ||
                    translate("badge_unknown_label");

                return `
                                <button type="button" 
                                        class="achievement-badge-card ${isSelected ? "selected" : ""}" 
                                        data-badge-id="${badge.id}"
                                        title="${escapeHTML(badgeName)}">
                                        ${
                                            imageUrl
                                                ? `<img src="/assets/images/${escapeHTML(imageUrl)}" alt="${escapeHTML(badgeName)}" class="achievement-badge-card__image" />`
                                                : `<div class="achievement-badge-card__placeholder">★</div>`
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
        const modal = document.getElementById(this.modalId);
        if (!modal) return;

        // Close buttons
        modal.querySelectorAll('[data-dismiss="modal"]').forEach((btn) => {
            btn.addEventListener("click", () => this.close());
        });

        // Click outside to close
        modal.addEventListener("click", (e) => {
            if (e.target === modal) this.close();
        });

        // Escape key to close
        const handleEscape = (e) => {
            if (e.key === "Escape") {
                this.close();
                document.removeEventListener("keydown", handleEscape);
            }
        };
        document.addEventListener("keydown", handleEscape);

        // Type selection
        modal.querySelectorAll(".achievement-type-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                this.selectedType = e.target.dataset.type;
                modal
                    .querySelectorAll(".achievement-type-btn")
                    .forEach((b) => b.classList.remove("active"));
                e.target.classList.add("active");

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
                    .forEach((c) => c.classList.remove("selected"));
                e.currentTarget.classList.add("selected");
            });
        });

        // Save button
        const saveBtn = document.getElementById("achievement-save-btn");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.handleSave());
        }
    }

    handleSave() {
        // Gather selected participants
        const modal = document.getElementById(this.modalId);
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
