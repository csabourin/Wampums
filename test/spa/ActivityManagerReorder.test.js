/**
 * @jest-environment jsdom
 *
 * Meeting agenda reorder behavior is intentionally tested at the DOM boundary:
 * unsaved form values must move with a row and its timeline must be rebuilt.
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    UI: {
      MEETING_REORDER_LONG_PRESS_DELAY: 450,
      MEETING_REORDER_MOVE_TOLERANCE: 10
    }
  }
}));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  sanitizeHTML: (value) => value,
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn()
}));

jest.mock('../../spa/utils/meetingSections.js', () => ({
  getSectionActivityTemplates: jest.fn(() => [])
}));

import { ActivityManager } from '../../spa/modules/ActivityManager.js';

const ACTIVITIES = [
  { id: 1, activity: 'Opening', time: '18:30', duration: '00:10', responsable: '', materiel: '', position: 0 },
  { id: 2, activity: 'Game', time: '18:40', duration: '00:20', responsable: '', materiel: '', position: 1 },
  { id: 3, activity: 'Closing', time: '19:00', duration: '00:15', responsable: '', materiel: '', position: 2 }
];

/** Dispatch a pointer-shaped DOM event in jsdom. */
function dispatchPointer(target, type, properties) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: properties.clientX || 0,
    clientY: properties.clientY || 0,
    button: properties.button || 0
  });
  Object.defineProperties(event, {
    pointerId: { value: properties.pointerId || 1 },
    pointerType: { value: properties.pointerType || 'mouse' }
  });
  target.dispatchEvent(event);
  return event;
}

describe('ActivityManager agenda reordering', () => {
  let manager;

  beforeEach(() => {
    document.body.innerHTML = '<div id="activities-list"></div>';
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    manager = new ActivityManager({ lang: 'en' }, [], ACTIVITIES);
    manager.setSelectedActivities(ACTIVITIES.map((activity) => ({ ...activity })));
    manager.renderActivitiesTable();
  });

  afterEach(() => {
    manager.destroy();
    jest.useRealTimers();
  });

  test('renders a dedicated accessible six-dot handle for every row', () => {
    const handles = document.querySelectorAll('.activity-drag-handle');

    expect(handles).toHaveLength(3);
    expect(handles[0].tagName).toBe('BUTTON');
    expect(handles[0].getAttribute('aria-label')).toBe('drag_handle');
    expect(handles[0].querySelector('.activity-drag-handle__dots')).not.toBeNull();
  });

  test('keyboard movement preserves edits and recalculates sequential times', () => {
    document.querySelectorAll('.activity-materiel')[0].value = 'Unsaved rope';
    const firstHandle = document.querySelector('.activity-drag-handle');
    const changed = jest.fn();
    document.getElementById('activities-list').addEventListener('activitieschange', changed);

    firstHandle.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));

    const reordered = manager.getSelectedActivities();
    expect(reordered.map((activity) => activity.activity)).toEqual([
      'Game',
      'Opening',
      'Closing'
    ]);
    expect(reordered.map((activity) => activity.time)).toEqual([
      '18:30',
      '18:50',
      '19:00'
    ]);
    expect(reordered[1].materiel).toBe('Unsaved rope');
    expect(reordered.map((activity) => activity.position)).toEqual([0, 1, 2]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('mouse drag starts immediately, marks the insertion line, and commits', () => {
    const containers = document.querySelectorAll('.activity-row-container');
    containers.forEach((container, index) => {
      container.getBoundingClientRect = () => ({
        top: index * 50,
        height: 50
      });
    });
    const firstHandle = document.querySelector('.activity-drag-handle');

    dispatchPointer(firstHandle, 'pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      clientY: 10
    });
    dispatchPointer(window, 'pointermove', {
      pointerId: 7,
      pointerType: 'mouse',
      clientY: 140
    });

    expect(document.getElementById('activities-list').classList.contains('is-reordering')).toBe(true);
    expect(document.querySelector('.insert-here-divider[data-position="3"]')
      .classList.contains('is-drop-target')).toBe(true);

    dispatchPointer(window, 'pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      clientY: 140
    });

    expect(manager.getSelectedActivities().map((activity) => activity.activity)).toEqual([
      'Game',
      'Closing',
      'Opening'
    ]);
    expect(manager.getSelectedActivities().map((activity) => activity.time)).toEqual([
      '18:30',
      '18:50',
      '19:05'
    ]);
  });

  test('touch waits for a long press before activating reorder mode', () => {
    jest.useFakeTimers();
    const firstHandle = document.querySelector('.activity-drag-handle');
    document.querySelector('.activity-select').value = 'Game';

    dispatchPointer(firstHandle, 'pointerdown', {
      pointerId: 9,
      pointerType: 'touch',
      clientY: 10
    });

    expect(document.getElementById('activities-list').classList.contains('is-reordering')).toBe(false);
    jest.advanceTimersByTime(449);
    expect(document.getElementById('activities-list').classList.contains('is-reordering')).toBe(false);
    jest.advanceTimersByTime(1);
    expect(document.getElementById('activities-list').classList.contains('is-reordering')).toBe(true);
    expect(document.getElementById('activities-list').classList.contains('is-touch-reordering')).toBe(true);
    expect(document.querySelector('.activity-row__drag-title').textContent).toBe('Game');
  });

  test('destroy closes an open achievement modal and removes its Escape listener', () => {
    const firstRow = document.querySelector('.activity-row-container');
    manager.openAchievementModal(0, firstRow);
    const modal = manager.achievementModal;
    const close = jest.spyOn(modal, 'close');

    expect(document.getElementById('achievement-modal')).not.toBeNull();
    manager.destroy();

    expect(close).toHaveBeenCalledTimes(1);
    expect(manager.achievementModal).toBeNull();
    expect(document.getElementById('achievement-modal')).toBeNull();

    close.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(close).not.toHaveBeenCalled();
  });
});
