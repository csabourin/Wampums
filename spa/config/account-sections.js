/** Task navigation for the account. Stable keys also serve direct links and the future mobile port. */
export const ACCOUNT_SECTIONS = [
  { key: 'profile', label: 'account_section_profile', hint: 'account_section_profile_hint', anchors: ['my-profile', 'account-family', 'account-identity'] },
  { key: 'health', label: 'account_section_health', hint: 'account_section_health_hint', anchors: ['my-health', 'my-allergies', 'certifications'], staffOnly: true },
  { key: 'preferences', label: 'account_section_preferences', hint: 'account_section_preferences_hint', anchors: ['calendar-feed', 'account-language', 'account-time', 'account-notifications'] },
  { key: 'security', label: 'account_section_security', hint: 'account_section_security_hint', anchors: ['account-email', 'account-password'] },
];

/** Resolve old anchor links before a section query; an unavailable section falls back to Profile. */
export function accountSectionFor(location, sections) {
  const anchor = location.hash.slice(1);
  return sections.find((section) => section.anchors.includes(anchor))?.key
    || sections.find((section) => section.key === new URL(location.href).searchParams.get('section'))?.key
    || sections[0].key;
}
