/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: { TASKS: { TITLE_MAX_LENGTH: 255, STATUS_KEYS: { todo: 'tasks_status_todo', in_progress: 'tasks_status_in_progress', done: 'tasks_status_done' } } }, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(), isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/api/api-tasks.js', () => ({ getMyTasks: jest.fn(), getUnitTasks: jest.fn(), getTaskOptions: jest.fn(), saveTask: jest.fn(), changeTaskStatus: jest.fn() }));
const { Tasks } = require('../../spa/modules/tasks/Tasks.js');
const api = require('../../spa/api/api-tasks.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const AXE_OPTIONS = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } };
const USER = '00000000-0000-4000-8000-000000000001';
const task = { id: 3, title: '<img src=x onerror=alert(1)>', activity_id: 4, activity_name: 'Camp', assignee_id: USER, assignee_name: '<b>Ada</b>', due_date: '2026-11-14', status: 'todo', history: [{ status: 'todo', changed_by_name: 'Ada', changed_at: '2026-10-26T14:00:00Z' }] };
let app;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/tasks');
  document.body.innerHTML = '<main id="app"></main>';
  hasPermission.mockReturnValue(false);
  api.getMyTasks.mockResolvedValue({ data: [task] });
  api.getUnitTasks.mockResolvedValue({ data: [task] });
  api.getTaskOptions.mockResolvedValue({ data: { members: [{ id: USER, full_name: 'Ada' }], activities: [{ id: 4, name: 'Camp', date: '2026-11-14' }], meetings: [] } });
  api.saveTask.mockResolvedValue({ success: true });
  api.changeTaskStatus.mockResolvedValue({ success: true });
  app = { lang: 'fr', showMessage: jest.fn() };
});
afterEach(() => closeAllModals());

test('an assignee sees task details as text and can update only their own status', async () => {
  await new Tasks(app).init();
  expect(document.querySelector('h2').textContent).toBe(task.title);
  expect(document.querySelector('#app img, #app b')).toBeNull();
  expect(document.querySelector('#app').textContent).toContain('novembre');
  expect(document.getElementById('tasks-create')).toBeNull();
  const form = document.querySelector('[data-task-status]');
  form.elements.status.value = 'done';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(api.changeTaskStatus).toHaveBeenCalledWith(3, 'done', 'todo', true);
  expect(document.activeElement).toBe(document.getElementById('tasks-status-3'));
  expect(app.showMessage).toHaveBeenCalledWith('tasks_saved', 'success');
});

test('task lists and their status controls have no WCAG A/AA violations', async () => {
  await new Tasks(app).init();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('failed loading offers a retry and never appears as an empty list', async () => {
  api.getMyTasks.mockRejectedValueOnce(new Error('offline'));
  await new Tasks(app).init();
  expect(document.querySelector('[role="alert"]').textContent).toBe('tasks_load_failed');
  document.getElementById('tasks-retry').click();
  await settle();
  expect(document.querySelector('h2').textContent).toBe(task.title);
});

test('an empty task list explains where assignments will appear', async () => {
  api.getMyTasks.mockResolvedValue({ data: [] });
  await new Tasks(app).init();
  expect(document.querySelector('.empty-state').textContent).toBe('tasks_empty');
});

test('a late response never redraws the screen after navigation', async () => {
  let resolve;
  api.getMyTasks.mockReturnValue(new Promise((done) => {resolve = done;}));
  const screen = new Tasks(app);
  const pending = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'Next screen';
  resolve({ data: [task] });
  await pending;
  expect(document.getElementById('app').textContent).toBe('Next screen');
});

test('managers can switch to unit tasks and create an assigned task', async () => {
  hasPermission.mockReturnValue(true);
  await new Tasks(app).init();
  document.getElementById('tasks-view').click();
  await settle();
  expect(api.getUnitTasks).toHaveBeenCalledWith({ forceRefresh: true });
  document.getElementById('tasks-create').click();
  await settle();
  const form = document.getElementById('tasks-form');
  form.elements.task_title.value = 'Pack tents';
  form.elements.task_event.value = 'activity:4';
  form.elements.task_assignee.value = USER;
  form.elements.task_due.value = '2026-11-13';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(api.saveTask).toHaveBeenCalledTimes(1);
  expect(api.saveTask).toHaveBeenCalledWith({ title: 'Pack tents', assignee_id: USER, activity_id: 4, meeting_id: null, due_date: '2026-11-13' }, null);
  expect(document.getElementById('tasks-editor')).toBeNull();
  expect(document.activeElement).toBe(document.getElementById('tasks-create'));
});

test('the assignment dialog has labelled controls, traps focus and closes with Escape', async () => {
  hasPermission.mockReturnValue(true);
  await new Tasks(app).init();
  const opener = document.getElementById('tasks-create');
  opener.focus(); opener.click();
  await settle();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect((await axe.run(dialog, AXE_OPTIONS)).violations).toEqual([]);
  const last = dialog.querySelector('[type="submit"]');
  last.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(dialog.contains(document.activeElement)).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('failed saving keeps entered fields available for correction', async () => {
  hasPermission.mockReturnValue(true);
  api.saveTask.mockRejectedValue(new Error('database internals'));
  await new Tasks(app).init();
  document.getElementById('tasks-create').click(); await settle();
  const form = document.getElementById('tasks-form');
  form.elements.task_title.value = 'Pack tents';
  form.elements.task_event.value = 'activity:4';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(form.elements.task_title.value).toBe('Pack tents');
  expect(document.getElementById('tasks-form-error').textContent).toBe('tasks_save_failed');
  expect(document.querySelector('[type="submit"][form="tasks-form"]').disabled).toBe(false);
});

test('a saved change remains successful when reloading fails', async () => {
  await new Tasks(app).init();
  api.getMyTasks.mockRejectedValue(new Error('offline'));
  document.querySelector('[data-task-status]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(app.showMessage).toHaveBeenCalledWith('tasks_saved', 'success');
  expect(app.showMessage).not.toHaveBeenCalledWith('tasks_save_failed', 'error');
  expect(document.getElementById('tasks-retry')).not.toBeNull();
});

test.each([
  ['inactive outing', { activity_id: 4, activity_name: '<b>Camp</b>' }, 'activity:4'],
  ['cancelled meeting', { activity_id: null, activity_name: null, meeting_id: 42, meeting_name: '<b>Meeting</b>', meeting_date: '2026-11-15' }, 'meeting:42'],
])('editing a task keeps its %s selected even when it is absent from creation choices', async (_kind, event, selected) => {
  hasPermission.mockReturnValue(true);
  const current = { ...task, ...event };
  api.getUnitTasks.mockResolvedValue({ data: [current] });
  api.getTaskOptions.mockResolvedValue({ data: { members: [{ id: USER, full_name: 'Ada' }], activities: [], meetings: [] } });
  await new Tasks(app).init();
  document.getElementById('tasks-view').click(); await settle();
  document.querySelector('[data-task-edit]').click(); await settle();
  const form = document.getElementById('tasks-form');
  expect(form.elements.task_event.value).toBe(selected);
  expect(document.querySelector('#tasks-event b')).toBeNull();
  form.elements.task_title.value = 'Updated task';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Updated task', activity_id: event.activity_id, meeting_id: event.meeting_id || null,
  }), task.id);
});


test('an equipment duty opens its personal lot instead of offering an independent status change', async () => {
  api.getMyTasks.mockResolvedValue({ data: [{ ...task, meeting_id: 7, activity_id: null, equipment_lot_id: 3, equipment_lot_role: 'transport' }] });
  await new Tasks(app).init();
  expect(document.querySelector('a[href="/my-camp-lots/7"]')).not.toBeNull();
  expect(document.querySelector('[data-task-status]')).toBeNull();
});


test('a camp link opens unit assignments for that camp and its linked outing only', async () => {
  hasPermission.mockReturnValue(true);
  window.history.replaceState(null, '', '/tasks?meeting_id=3&activity_id=4');
  api.getUnitTasks.mockResolvedValue({ data: [task, { ...task, id: 9, activity_id: null, meeting_id: 3, title: 'Pack cooking pot' }, { ...task, id: 10, activity_id: 99, title: 'Other camp' }] });
  await new Tasks(app).init();
  expect(api.getUnitTasks).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain('Pack cooking pot');
  expect(document.body.textContent).not.toContain('Other camp');
});
