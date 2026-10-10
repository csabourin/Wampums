/**
 * @jest-environment jsdom
 */

/**
 * An announcement's delivery log names who each push went to and why a failed
 * one failed, failures first, so a sender can check that only the chosen
 * people were reached and see which of their devices no longer receive.
 *
 * @module test/spa/DeliveryLog
 */

import axe from 'axe-core';

const LABELS = {
  delivery_logs: 'Historique des envois',
  delivery_log_push: 'Notification push',
  delivery_log_device: 'appareil {service}',
  delivery_log_unknown_recipient: 'Destinataire non enregistré',
  email: 'Courriel',
  sent: 'Envoyé',
  failed: 'Échec',
};
jest.mock('../../spa/app.js', () => ({ translate: (key) => LABELS[key] || key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));

const { renderDeliveryLog } = require('../../spa/modules/announcements/deliveryLog.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const LOGS = [
  { channel: 'email', status: 'sent', recipient_email: 'akela@example.org' },
  { channel: 'push', status: 'sent', recipient_name: 'Akela' },
  {
    channel: 'push', status: 'failed', recipient_name: 'Baloo <b>',
    error_message: 'HTTP 400: Bad request', push_service: 'fcm.googleapis.com',
  },
  { channel: 'push', status: 'failed', error_message: 'VAPID keys not configured' },
];

beforeEach(() => {
  document.body.innerHTML = `<main>${renderDeliveryLog(LOGS)}</main>`;
});

test('lists every row, failures first, each naming its recipient and cause', () => {
  const rows = [...document.querySelectorAll('.delivery-log__row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim());

  expect(document.querySelector('summary').textContent).toBe('Historique des envois (4)');
  expect(rows).toHaveLength(4);
  expect(rows[0]).toBe('Notification push — Échec Baloo <b> · appareil fcm.googleapis.com : HTTP 400: Bad request');
  expect(rows[1]).toBe('Notification push — Échec Destinataire non enregistré : VAPID keys not configured');
  expect(rows.slice(2)).toEqual(['Courriel — Envoyé akela@example.org', 'Notification push — Envoyé Akela']);
  expect(document.querySelector('main b')).toBeNull();
});

test('renders nothing without rows', () => {
  expect(renderDeliveryLog([])).toBe('');
});

test('has no WCAG A/AA violations', async () => {
  document.querySelector('details').open = true;
  const results = await axe.run(document.querySelector('main'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
