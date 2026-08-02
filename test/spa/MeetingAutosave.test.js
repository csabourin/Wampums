/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    UI: {
      MEETING_AUTOSAVE_DELAY: 1000,
      MEETING_DRAFT_WRITE_DELAY: 150,
      MEETING_DRAFT_EXPIRATION: 30000
    }
  }
}));

const mockSetCachedData = jest.fn(() => Promise.resolve());
const mockGetCachedData = jest.fn(() => Promise.resolve(null));
const mockDeleteCachedData = jest.fn(() => Promise.resolve());

jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: (...args) => mockSetCachedData(...args),
  getCachedData: (...args) => mockGetCachedData(...args),
  deleteCachedData: (...args) => mockDeleteCachedData(...args)
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugError: jest.fn()
}));

import {
  MeetingAutosave,
  MEETING_SAVE_STATES
} from '../../spa/modules/meetings/MeetingAutosave.js';

/** Create a promise whose completion the test controls. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController(overrides = {}) {
  let current = { date: '2026-08-05', notes: '' };
  const statuses = [];
  const save = jest.fn((formData) => Promise.resolve({ data: formData }));
  const onSaved = jest.fn(() => Promise.resolve());
  const controller = new MeetingAutosave({
    date: '2026-08-05',
    capture: () => ({ ...current }),
    isValid: () => true,
    save,
    onSaved,
    onStatus: (state) => statuses.push(state),
    ...overrides
  });
  controller.setBaseline(current);
  return {
    controller,
    save,
    onSaved,
    statuses,
    setCurrent: (value) => { current = value; }
  };
}

describe('MeetingAutosave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSetCachedData.mockClear();
    mockGetCachedData.mockReset().mockResolvedValue(null);
    mockDeleteCachedData.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('writes a local draft first, then quietly saves after the debounce', async () => {
    const setup = createController();
    setup.setCurrent({ date: '2026-08-05', notes: 'Bring rope' });

    setup.controller.markDirty();
    expect(setup.statuses).toContain(MEETING_SAVE_STATES.DIRTY);

    await jest.advanceTimersByTimeAsync(150);
    expect(mockSetCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-05',
      expect.objectContaining({ formData: expect.objectContaining({ notes: 'Bring rope' }) }),
      30000
    );
    expect(setup.statuses).toContain(MEETING_SAVE_STATES.LOCAL);

    await jest.advanceTimersByTimeAsync(850);
    await setup.controller.serverSavePromise;
    expect(setup.save).toHaveBeenCalledTimes(1);
    expect(mockDeleteCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-05'
    );
    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.SAVED);
  });

  test('explicit Save can persist a new meeting equal to its initial draft', async () => {
    const setup = createController();

    setup.controller.markDirty({
      formData: { date: '2026-08-05', notes: '' },
      force: true
    });
    await setup.controller.flush({ manual: true });

    expect(setup.save).toHaveBeenCalledTimes(1);
    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.SAVED);
  });

  test('never overlaps writes and follows an in-flight save with the newest state', async () => {
    const first = deferred();
    const second = deferred();
    let active = 0;
    let maximumActive = 0;
    const save = jest.fn(() => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const pending = save.mock.calls.length === 1 ? first : second;
      return pending.promise.finally(() => { active -= 1; });
    });
    const setup = createController({ save });

    setup.setCurrent({ date: '2026-08-05', notes: 'First' });
    setup.controller.markDirty();
    const flushPromise = setup.controller.flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    setup.setCurrent({ date: '2026-08-05', notes: 'Newest' });
    setup.controller.markDirty();
    first.resolve({ data: { notes: 'First' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(maximumActive).toBe(1);

    await jest.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    second.resolve({ data: { notes: 'Newest' } });
    await flushPromise;

    expect(save.mock.calls[1][0].notes).toBe('Newest');
    expect(maximumActive).toBe(1);
    expect(setup.onSaved.mock.calls.map((call) => call[2].isLatest)).toEqual([
      false,
      true
    ]);
  });

  test('keeps an incomplete form as a local draft without calling the server', async () => {
    const setup = createController({ isValid: () => false });
    setup.setCurrent({ date: '2026-08-05', notes: 'Incomplete' });
    setup.controller.markDirty();

    await setup.controller.flush();

    expect(setup.save).not.toHaveBeenCalled();
    expect(mockSetCachedData).toHaveBeenCalled();
    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.LOCAL);
  });

  test('does not discard an edit made while applying a successful response', async () => {
    const firstApply = deferred();
    const onSaved = jest.fn(() => {
      if (onSaved.mock.calls.length === 1) return firstApply.promise;
      return Promise.resolve();
    });
    const setup = createController({ onSaved });
    setup.setCurrent({ date: '2026-08-05', notes: 'First' });
    setup.controller.markDirty();
    const flushPromise = setup.controller.flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(onSaved).toHaveBeenCalledTimes(1);

    setup.setCurrent({ date: '2026-08-05', notes: 'During response' });
    setup.controller.markDirty();
    firstApply.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await flushPromise;

    expect(setup.save).toHaveBeenCalledTimes(2);
    expect(setup.save.mock.calls[1][0].notes).toBe('During response');
    expect(setup.controller.latestSnapshot).toBeNull();
  });

  test('restores a scoped draft and schedules it as local unsynced work', async () => {
    mockGetCachedData.mockResolvedValue({
      version: 1,
      revision: 4,
      updatedAt: 1234,
      formData: { date: '2026-08-05', notes: 'Recovered' }
    });
    const setup = createController();

    const draft = await setup.controller.restoreDraft();

    expect(mockGetCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-05'
    );
    expect(draft.formData.notes).toBe('Recovered');
    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.LOCAL);
  });

  test('moves the local draft when the editable meeting date changes', async () => {
    const setup = createController();
    setup.setCurrent({ date: '2026-08-12', notes: 'Moved meeting' });

    setup.controller.markDirty();
    await jest.advanceTimersByTimeAsync(150);

    expect(mockSetCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-12',
      expect.objectContaining({
        date: '2026-08-12',
        draftKey: 'meeting_preparation_draft_2026-08-12'
      }),
      30000
    );
    expect(mockDeleteCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-05'
    );

    await setup.controller.flush();

    expect(mockDeleteCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-12'
    );
    expect(setup.controller.date).toBe('2026-08-12');
  });

  test('migrates a legacy draft stored under a different form date', async () => {
    mockGetCachedData.mockResolvedValue({
      version: 1,
      revision: 2,
      updatedAt: 1234,
      formData: { date: '2026-08-12', notes: 'Legacy moved meeting' }
    });
    const setup = createController();

    const draft = await setup.controller.restoreDraft();

    expect(draft.draftKey).toBe('meeting_preparation_draft_2026-08-12');
    expect(mockSetCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-12',
      expect.objectContaining({ date: '2026-08-12' }),
      30000
    );
    expect(mockDeleteCachedData).toHaveBeenCalledWith(
      'meeting_preparation_draft_2026-08-05'
    );
    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.LOCAL);
  });

  test('a network failure leaves the durable local draft available', async () => {
    const setup = createController({
      save: jest.fn(() => Promise.reject(new Error('Network unavailable')))
    });
    setup.setCurrent({ date: '2026-08-05', notes: 'Offline note' });
    setup.controller.markDirty();

    await setup.controller.flush();

    expect(setup.controller.state).toBe(MEETING_SAVE_STATES.LOCAL);
    expect(setup.controller.latestSnapshot.formData.notes).toBe('Offline note');
  });
});
