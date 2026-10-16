/**
 * @jest-environment jsdom
 */

/**
 * The leaders' "now / next" bar.
 *
 * During a planned meeting or camp day, a bar at the bottom of every screen
 * says what is on, how long it has left, and what comes next and who leads it.
 * It moves on by itself as the clock turns, says a change of activity once,
 * opens the rest of the day on a tap, and is for leaders only.
 *
 * Strings are the real English ones, so what is asserted is what a leader reads.
 *
 * @module test/spa/ProgrammeBar
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => {
  const bundles = { en: require('../../lang/en.json'), fr: require('../../lang/fr.json') };
  return { translate: (key) => bundles[globalThis.programmeTestLang || 'en'][key] ?? key };
});
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    DEFAULT_LANG: 'en',
    CACHE_DURATION: { SHORT: 300000, CAMP_MODE: 864000000 },
    PROGRAMME_BAR: { LEAD_MINUTES: 15, ENDING_SOON_MINUTES: 5, DEFAULT_LAST_ACTIVITY_MINUTES: 15, REFRESH_AFTER_MINUTES: 15 },
  },
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true),
  isParent: jest.fn(() => false),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDate: (date) => `DATE(${date})` }));
jest.mock('../../spa/utils/InterfaceLanguageUtils.js', () => ({ localeForLanguage: () => 'en-CA' }));
jest.mock('../../spa/api/api-programme.js', () => ({ getDayProgramme: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { preparedActivities: new Map() },
}));

import { getDayProgramme } from '../../spa/api/api-programme.js';
import { hasPermission, isParent } from '../../spa/utils/PermissionUtils.js';
import { offlineManager } from '../../spa/modules/OfflineManager.js';
import { ProgrammeBar, syncProgrammeBar } from '../../spa/modules/programme-bar/ProgrammeBar.js';
import { releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const MEETING = {
  meeting_id: 7,
  kind: 'regular',
  date: '2026-10-16',
  title: 'La jungle',
  day_number: 1,
  day_count: 1,
  activities: [
    { id: 1, time: '18:45', duration_minutes: 15, name: 'Welcome', leader: 'Bagheera', material: '' },
    { id: 2, time: '19:00', duration_minutes: 25, name: 'Den game', leader: 'Baloo', material: 'Scarves, 4 cones' },
    { id: 3, time: '19:25', duration_minutes: 20, name: 'Jungle story', leader: 'Akela', material: '' },
    { id: 4, time: null, duration_minutes: null, name: 'Tidy up', leader: '', material: '' },
  ],
};
const CAMP = {
  meeting_id: 8,
  kind: 'camp',
  date: '2026-10-16',
  title: 'The wolf trail',
  day_number: 2,
  day_count: 3,
  activities: [
    { id: 11, time: '09:30', duration_minutes: 150, name: 'Forest game', leader: 'Akela', material: '' },
    { id: 12, time: '14:00', duration_minutes: 60, name: 'Swimming', leader: 'Baloo and Rikki', material: 'Towels' },
  ],
};

let clock;
let bars = [];

/** @returns {Date} 16 October 2026 at that local time */
const at = (hours, minutes, seconds = 0) => new Date(2026, 9, 16, hours, minutes, seconds).getTime();
const bar = () => document.getElementById('programme-bar');
const button = () => bar().querySelector('button');
const announcer = () => document.getElementById('programme-bar-announcer');
/** @returns {Promise<Array>} axe violations in the page; axe needs real timers */
async function violations() {
  jest.useRealTimers();
  try {
    return (await axe.run(document.body, AXE_OPTIONS)).violations;
  } finally {
    jest.useFakeTimers();
  }
}
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each turn lets one more promise in the chain settle
    await Promise.resolve();
  }
};

/**
 * Start a bar at a given time with a given programme.
 *
 * @param {number} time - Epoch ms
 * @param {?Object} programme - The day's programme
 * @param {Object} [options] - Extra ProgrammeBar options
 * @returns {Promise<ProgrammeBar>}
 */
async function startAt(time, programme, options = {}) {
  clock = time;
  getDayProgramme.mockResolvedValue({ success: true, data: programme });
  const instance = new ProgrammeBar({ lang: 'en', showMessage: jest.fn() }, { now: () => new Date(clock), wakeLock: null, ...options });
  bars.push(instance);
  await instance.start();
  return instance;
}

/**
 * Let the phone's clock run to a time, firing the bar's minute timer.
 *
 * @param {number} time - Epoch ms
 */
async function runClockTo(time) {
  const ms = time - clock;
  clock = time;
  jest.advanceTimersByTime(ms);
  await settle();
}

beforeEach(() => {
  globalThis.programmeTestLang = 'en';
  jest.useFakeTimers();
  document.body.innerHTML = '<main id="app"><h1>Dashboard</h1><a href="/x">A link</a></main>';
  document.documentElement.className = '';
  jest.clearAllMocks();
  hasPermission.mockReturnValue(true);
  isParent.mockReturnValue(false);
});

afterEach(() => {
  bars.forEach((instance) => instance.destroy());
  bars = [];
  syncProgrammeBar({ isLoggedIn: false });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
  releaseAllScrollLocks();
  jest.useRealTimers();
});

describe('what the bar says', () => {
  test('during an activity: what is on, how long it has left, then what is next and who leads it', async () => {
    await startAt(at(19, 13), MEETING);

    expect(bar().hidden).toBe(false);
    expect(bar().tagName).toBe('ASIDE');
    expect(bar().getAttribute('aria-label')).toBe('Programme in progress');
    expect(button().textContent.replace(/\s+/g, ' ').trim())
      .toBe('Now Den game 12 min Next · 7:25 p.m. Jungle story · Akela');
    expect(getDayProgramme).toHaveBeenCalledWith('2026-10-16');
  });

  test('in the last five minutes the words change too, not only the colour', async () => {
    await startAt(at(19, 21), MEETING);

    expect(button().classList).toContain('programme-bar__button--soon');
    expect(button().textContent).toContain('Ending soon');
    expect(button().textContent).toContain('4 min');
  });

  test('before the meeting: when it starts and who leads the first activity', async () => {
    await startAt(at(18, 35), MEETING);

    expect(button().textContent.replace(/\s+/g, ' ').trim())
      .toBe('The meeting starts Welcome in 10 min 6:45 p.m. · Bagheera');
  });

  test('on a camp day, even in a long gap, it names the day and what comes next', async () => {
    await startAt(at(12, 30), CAMP);

    expect(button().textContent.replace(/\s+/g, ' ').trim())
      .toBe('Day 2 · Next activity Swimming in 1 h 30 2:00 p.m. · Baloo and Rikki');
  });

  test('the last activity says it is the last', async () => {
    await startAt(at(19, 30), MEETING);

    expect(button().textContent).toContain('Last activity');
  });

  test('names typed by leaders show as text', async () => {
    await startAt(at(19, 13), {
      ...MEETING,
      activities: [{ id: 1, time: '19:00', duration_minutes: 30, name: HOSTILE, leader: HOSTILE, material: '' },
        { id: 2, time: '19:30', duration_minutes: 10, name: HOSTILE, leader: HOSTILE, material: '' }],
    });

    expect(button().textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
  });

  test('passes axe', async () => {
    await startAt(at(19, 13), MEETING);
    expect(await violations()).toEqual([]);
  });
});

describe('when it shows', () => {
  test('outside the programme there is no bar, and the page keeps no room for it', async () => {
    await startAt(at(17, 0), MEETING);

    expect(bar().hidden).toBe(true);
    expect(document.documentElement.classList).not.toContain('has-programme-bar');
  });

  test('while it shows, the page keeps room for it so nothing focused hides under it', async () => {
    await startAt(at(19, 13), MEETING);
    expect(document.documentElement.classList).toContain('has-programme-bar');
  });

  test('a day with nothing planned shows nothing', async () => {
    await startAt(at(19, 13), null);
    expect(bar().hidden).toBe(true);
  });

  test('a programme that cannot be read shows nothing, and says nothing', async () => {
    clock = at(19, 13);
    getDayProgramme.mockRejectedValue(new Error('offline'));
    const app = { lang: 'en', showMessage: jest.fn() };
    const instance = new ProgrammeBar(app, { now: () => new Date(clock), wakeLock: null });
    bars.push(instance);
    await instance.start();

    expect(bar().hidden).toBe(true);
    expect(app.showMessage).not.toHaveBeenCalled();
  });
});

describe('when the programme cannot be read again', () => {
  test('offline, the day already read keeps showing', async () => {
    await startAt(at(19, 0), MEETING);
    getDayProgramme.mockRejectedValue(Object.assign(new Error('offline'), { isNetworkError: true }));

    await runClockTo(at(19, 15));
    expect(bar().hidden).toBe(false);
    expect(button().textContent).toContain('Den game');
  });

  test.each([401, 403])('a refusal (%i), such as a leader who lost access, stops showing it', async (status) => {
    await startAt(at(19, 0), MEETING);
    getDayProgramme.mockRejectedValue(Object.assign(new Error('refused'), { status }));

    await runClockTo(at(19, 15));
    expect(bar().hidden).toBe(true);
  });
});

describe('as the clock turns', () => {
  test('it moves on to the next activity at its time, and says the change once', async () => {
    await startAt(at(19, 24, 30), MEETING);
    expect(button().textContent).toContain('Den game');
    expect(announcer().textContent).toBe('');

    await runClockTo(at(19, 25));
    expect(button().textContent).toContain('Jungle story');
    expect(button().textContent).toContain('20 min');
    expect(announcer().textContent).toBe('Now: Jungle story, 20 min');

    await runClockTo(at(19, 26));
    expect(button().textContent).toContain('19 min');
    expect(announcer().textContent).toBe('Now: Jungle story, 20 min');
  });

  test('a leader on the bar keeps focus on it when it redraws', async () => {
    await startAt(at(19, 13), MEETING);
    button().focus();

    await runClockTo(at(19, 14));
    expect(document.activeElement).toBe(button());
    expect(button().textContent).toContain('11 min');
  });

  test('the programme is read again after a while, to pick up changes', async () => {
    await startAt(at(19, 0), MEETING);
    expect(getDayProgramme).toHaveBeenCalledTimes(1);

    await runClockTo(at(19, 15));
    expect(getDayProgramme).toHaveBeenCalledTimes(2);
  });
});

describe('the rest of the day', () => {
  test('tapping the bar opens the day: what is done, what is on, who leads, what to bring', async () => {
    await startAt(at(19, 13), MEETING);
    button().focus();
    button().click();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Meeting programme');
    const items = [...dialog.querySelectorAll('.programme-sheet__item')].map((item) => item.textContent.replace(/\s+/g, ' ').trim());
    expect(items).toEqual([
      '6:45 p.m. Done Welcome Bagheera · 15 min',
      '7:00 p.m. In progress · 12 min Den game Baloo · 25 min Material: Scarves, 4 cones',
      '7:25 p.m. Jungle story Akela · 20 min',
      'Any time Tidy up',
    ]);
    expect(await violations()).toEqual([]);
  });

  test('Escape closes it and focus returns to the bar', async () => {
    await startAt(at(19, 13), MEETING);
    button().focus();
    button().click();
    expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    jest.runOnlyPendingTimers();
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  test('a camp day is titled with its own name and which day it is', async () => {
    await startAt(at(10, 0), CAMP);
    button().click();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('The wolf trail');
    expect(dialog.textContent).toContain('day 2 of 3');
  });

  test('the screen can be kept on, and let go, where the browser allows it', async () => {
    const sentinel = { release: jest.fn().mockResolvedValue(), addEventListener: jest.fn() };
    const wakeLock = { request: jest.fn().mockResolvedValue(sentinel) };
    await startAt(at(19, 13), MEETING, { wakeLock });
    button().click();

    const checkbox = document.getElementById('programme-wake-lock');
    expect(checkbox.labels[0].textContent).toBe('Keep the screen on during the programme');
    checkbox.click();
    await settle();
    expect(wakeLock.request).toHaveBeenCalledWith('screen');

    checkbox.click();
    await settle();
    expect(sentinel.release).toHaveBeenCalled();
  });

  test('a screen kept on goes back to normal when the programme ends', async () => {
    const sentinel = { release: jest.fn().mockResolvedValue(), addEventListener: jest.fn() };
    const wakeLock = { request: jest.fn().mockResolvedValue(sentinel) };
    await startAt(at(19, 44), MEETING, { wakeLock });
    button().click();
    document.getElementById('programme-wake-lock').click();
    await settle();
    document.querySelector('[data-modal-close]').click();
    jest.runOnlyPendingTimers();
    await settle();
    expect(sentinel.release).not.toHaveBeenCalled();

    await runClockTo(at(19, 45));
    expect(bar().hidden).toBe(true);
    expect(sentinel.release).toHaveBeenCalled();
  });

  test('a lock the browser grants after the box was unticked is let go at once', async () => {
    const sentinel = { release: jest.fn().mockResolvedValue(), addEventListener: jest.fn() };
    let grant;
    const wakeLock = { request: jest.fn(() => new Promise((resolve) => { grant = resolve; })) };
    await startAt(at(19, 13), MEETING, { wakeLock });
    button().click();
    const checkbox = document.getElementById('programme-wake-lock');

    checkbox.click();
    checkbox.click();
    grant(sentinel);
    await settle();

    expect(sentinel.release).toHaveBeenCalled();
  });

  test('without that ability, no checkbox is offered', async () => {
    await startAt(at(19, 13), MEETING);
    button().click();
    expect(document.getElementById('programme-wake-lock')).toBeNull();
  });
});

describe('who sees it', () => {
  test('a leader signed in gets it; signing out removes it', async () => {
    getDayProgramme.mockResolvedValue({ success: true, data: MEETING });
    expect(syncProgrammeBar({ isLoggedIn: true, lang: 'en' })).not.toBeNull();
    await settle();
    expect(bar()).not.toBeNull();

    syncProgrammeBar({ isLoggedIn: false });
    expect(bar()).toBeNull();
    expect(announcer()).toBeNull();
  });

  test('after switching language, the bar and its landmark speak the new one', async () => {
    jest.setSystemTime(at(19, 13));
    getDayProgramme.mockResolvedValue({ success: true, data: MEETING });
    syncProgrammeBar({ isLoggedIn: true, lang: 'en' });
    await settle();
    expect(bar().getAttribute('aria-label')).toBe('Programme in progress');
    expect(button().textContent).toContain('Now');

    globalThis.programmeTestLang = 'fr';
    syncProgrammeBar({ isLoggedIn: true, lang: 'fr' });

    expect(bar().getAttribute('aria-label')).toBe('Programme en cours');
    expect(button().textContent).toContain('Maintenant');
    expect(announcer().textContent).toBe('');
  });

  test('a parent does not get it', () => {
    isParent.mockReturnValue(true);
    expect(syncProgrammeBar({ isLoggedIn: true })).toBeNull();
    expect(bar()).toBeNull();
  });

  test('someone who may not read meeting preparations does not get it', () => {
    hasPermission.mockImplementation((key) => key !== 'meetings.view');
    expect(syncProgrammeBar({ isLoggedIn: true })).toBeNull();
  });
});

test('preparing a camp for offline use keeps each of its days\' programme', async () => {
  await startAt(at(9, 0), CAMP);
  offlineManager.preparedActivities.set(42, { dates: ['2026-10-15', '2026-10-16', '2026-10-17'] });

  window.dispatchEvent(new CustomEvent('campModeChanged', { detail: { enabled: true, activityId: 42 } }));
  await settle();

  for (const date of ['2026-10-15', '2026-10-16', '2026-10-17']) {
    expect(getDayProgramme).toHaveBeenCalledWith(date, { forceRefresh: true, cacheDuration: 864000000 });
  }
});
