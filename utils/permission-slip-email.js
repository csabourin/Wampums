const { escapeHtml } = require("./api-helpers");
const { sanitizeInput, getTranslationsByCode } = require("./index");

const LANGUAGE_LOCALES = {
  en: "en-CA",
  fr: "fr-CA",
  uk: "uk-UA",
  it: "it-IT",
  id: "id-ID",
};

/**
 * Replace translation placeholders with provided values.
 * @param {string} template - Translation template containing {placeholders}.
 * @param {Record<string, string>} replacements - Replacement values.
 * @returns {string} Formatted string.
 */
function formatTranslation(template, replacements = {}) {
  if (!template) {
    return "";
  }

  let result = template;
  Object.entries(replacements).forEach(([key, value]) => {
    result = result.split(`{${key}}`).join(value ?? "");
  });
  return result;
}

/**
 * Get a localized string with fallback support.
 * @param {object} translations - Preferred translation bundle.
 * @param {object} fallbackTranslations - Fallback translation bundle.
 * @param {string} key - Translation key.
 * @param {string} defaultValue - Default when no translation found.
 * @returns {string} Translation string.
 */
function getTranslationValue(
  translations,
  fallbackTranslations,
  key,
  defaultValue,
) {
  return translations?.[key] || fallbackTranslations?.[key] || defaultValue;
}

/**
 * Determine locale for a given language code.
 * @param {string} languageCode - Language code (e.g., en, fr).
 * @returns {string} Locale for date formatting.
 */
function getLocaleForLanguage(languageCode = "en") {
  const normalized = (languageCode || "en").slice(0, 2).toLowerCase();
  return LANGUAGE_LOCALES[normalized] || LANGUAGE_LOCALES.en;
}

/**
 * Build localized permission slip email content.
 * @param {object} params - Email data.
 * @param {string} params.activityTitle - Activity title.
 * @param {string} params.activityDescription - Activity description.
 * @param {string|Date} params.meetingDate - Activity date.
 * @param {string|Date} params.deadlineDate - Deadline date.
 * @param {string} params.participantFirstName - Participant first name.
 * @param {string} params.participantLastName - Participant last name.
 * @param {string} params.signLink - Link to sign permission slip.
 * @param {string} params.languageCode - Language code for localization.
 * @param {boolean} params.isReminder - Whether this is a reminder email.
 * @returns {{subject: string, textBody: string, htmlBody: string}}
 */
function buildPermissionSlipEmailContent({
  activityTitle,
  activityDescription,
  meetingDate,
  deadlineDate,
  participantFirstName,
  participantLastName,
  signLink,
  languageCode = "en",
  isReminder = false,
}) {
  const translations = getTranslationsByCode(languageCode);
  const fallbackTranslations = getTranslationsByCode("en");
  const locale = getLocaleForLanguage(languageCode);

  const sanitizedActivityTitle =
    sanitizeInput(activityTitle) ||
    getTranslationValue(
      translations,
      fallbackTranslations,
      "activity",
      "Activity",
    );
  const sanitizedActivityDescription = sanitizeInput(activityDescription || "");
  const sanitizedParticipantName = sanitizeInput(
    `${participantFirstName || ""} ${participantLastName || ""}`.trim(),
  );
  const participantFallback = getTranslationValue(
    translations,
    fallbackTranslations,
    "permission_slip_participant_fallback",
    "Participant",
  );
  const participantName = sanitizedParticipantName || participantFallback;

  const formattedActivityDate = new Date(meetingDate).toLocaleDateString(locale);
  const formattedDeadlineDate = deadlineDate
    ? new Date(deadlineDate).toLocaleDateString(locale)
    : "";
  const deadlineText = formattedDeadlineDate
    ? formatTranslation(
      getTranslationValue(
        translations,
        fallbackTranslations,
        "permission_slip_email_deadline_text",
        "Signature deadline: {deadlineDate}",
      ),
      { deadlineDate: formattedDeadlineDate },
    )
    : "";

  const subjectKeyWithParticipant = isReminder
    ? "permission_slip_reminder_subject_with_participant"
    : "permission_slip_email_subject_with_participant";
  const subjectKey = isReminder
    ? "permission_slip_reminder_subject"
    : "permission_slip_email_subject";
  const defaultSubject = isReminder
    ? "Reminder: Parent permission required - {activityTitle} - {participantName}"
    : "Parent permission required - {activityTitle} - {participantName}";
  const subjectTemplate =
    translations?.[subjectKeyWithParticipant] ||
    translations?.[subjectKey] ||
    fallbackTranslations?.[subjectKeyWithParticipant] ||
    fallbackTranslations?.[subjectKey] ||
    defaultSubject;

  const subject = formatTranslation(subjectTemplate, {
    activityTitle: sanitizedActivityTitle,
    participantName,
  });

  const textTemplate = isReminder
    ? getTranslationValue(
      translations,
      fallbackTranslations,
      "permission_slip_reminder_body",
      "Hello,\n\nThis is a reminder about the parent permission for the activity: {activityTitle}\n\nActivity date: {activityDate}\n\nWe have not yet received your signature. Please sign the permission slip by clicking the link below:\n{signLink}\n\n{deadlineText}\n\nThank you!",
    )
    : getTranslationValue(
      translations,
      fallbackTranslations,
      "permission_slip_email_body",
      "Hello,\n\nWe are organizing the following activity: {activityTitle}\n\nActivity date: {activityDate}\n\n{activityDescription}\n\nPlease sign the permission slip by clicking the link below:\n{signLink}\n\n{deadlineText}\n\nThank you!",
    );

  const textBody = formatTranslation(textTemplate, {
    activityTitle: sanitizedActivityTitle,
    activityDate: formattedActivityDate,
    activityDescription: sanitizedActivityDescription,
    signLink,
    deadlineText,
  });

  const heading = getTranslationValue(
    translations,
    fallbackTranslations,
    isReminder
      ? "permission_slip_reminder_heading"
      : "permission_slip_email_heading",
    isReminder
      ? "Reminder: Parent permission required"
      : "Parent permission required",
  );
  const greeting = getTranslationValue(
    translations,
    fallbackTranslations,
    "permission_slip_email_greeting",
    "Hello,",
  );
  const introTemplate = getTranslationValue(
    translations,
    fallbackTranslations,
    isReminder
      ? "permission_slip_reminder_intro"
      : "permission_slip_email_intro",
    isReminder
      ? "This is a reminder about the parent permission for the activity: {activityTitle}"
      : "We are organizing the following activity: {activityTitle}",
  );
  const dateLabel = getTranslationValue(
    translations,
    fallbackTranslations,
    "permission_slip_email_date_label",
    "Activity date:",
  );
  const reminderMissingText = isReminder
    ? getTranslationValue(
      translations,
      fallbackTranslations,
      "permission_slip_reminder_missing_signature",
      "We have not yet received your signature.",
    )
    : "";
  const buttonLabel = getTranslationValue(
    translations,
    fallbackTranslations,
    isReminder
      ? "permission_slip_reminder_sign_button"
      : "permission_slip_email_sign_button",
    isReminder ? "Sign the permission slip now" : "Sign the permission slip",
  );
  const thanksText = getTranslationValue(
    translations,
    fallbackTranslations,
    "permission_slip_email_thanks",
    "Thank you!",
  );

  const safeActivityTitle = escapeHtml(sanitizedActivityTitle);
  const safeActivityDescription = escapeHtml(sanitizedActivityDescription).replace(
    /\n/g,
    "<br>",
  );
  const safeSignLink = escapeHtml(signLink);
  const safeIntro = formatTranslation(introTemplate, {
    activityTitle: safeActivityTitle,
  });
  const safeDeadlineText = deadlineText ? escapeHtml(deadlineText) : "";

  const htmlBody = `
    <h2>${escapeHtml(heading)}</h2>
    <p>${escapeHtml(greeting)}</p>
    <p>${safeIntro}</p>
    <p><strong>${escapeHtml(dateLabel)}</strong> ${escapeHtml(formattedActivityDate)}</p>
    ${!isReminder && safeActivityDescription
    ? `<div>${safeActivityDescription}</div>`
    : ""}
    ${isReminder ? `<p>${escapeHtml(reminderMissingText)}</p>` : ""}
    <p><a href="${safeSignLink}" style="display: inline-block; padding: 12px 24px; background-color: ${isReminder ? "#cc6600" : "#0066cc"}; color: white; text-decoration: none; border-radius: 4px;">${escapeHtml(buttonLabel)}</a></p>
    ${safeDeadlineText ? `<p><em>${safeDeadlineText}</em></p>` : ""}
    <p>${escapeHtml(thanksText)}</p>
  `;

  return {
    subject,
    textBody,
    htmlBody,
  };
}

module.exports = {
  buildPermissionSlipEmailContent,
  formatTranslation,
  getLocaleForLanguage,
};
