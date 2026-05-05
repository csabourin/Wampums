import { debugError } from './DebugUtils.js';

/**
 * Handles assignment interactions for both desktop drag/drop and mobile tap-tap.
 */
export class DragDropManager {
  constructor(options = {}) {
    this.onAssign = typeof options.onAssign === 'function' ? options.onAssign : async () => {};
    this.onSelectionChange =
      typeof options.onSelectionChange === 'function' ? options.onSelectionChange : () => {};

    this.selectedActivity = null;
    this.selectedElement = null;
    this.draggedActivity = null;
    this.dropZoneElements = new Set();
    this.cleanupFns = [];
  }

  /**
   * Register an activity chip as both draggable and tappable/selectable.
   * @param {HTMLElement} element
   * @param {object} activity
   */
  registerActivityElement(element, activity) {
    if (!element || !activity) return;

    element.setAttribute('draggable', 'true');

    const onClick = (event) => {
      if (event.target.closest('[data-ignore-assign="true"]')) return;
      event.preventDefault();

      if (this.selectedActivity?.id === activity.id) {
        this.clearSelection();
        return;
      }

      this.selectActivity(activity, element);
    };

    const onDragStart = (event) => {
      this.draggedActivity = activity;
      this.selectActivity(activity, element);

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', String(activity.id || ''));
      }
    };

    const onDragEnd = () => {
      this.draggedActivity = null;
      this.clearDragOverStates();
    };

    element.addEventListener('click', onClick);
    element.addEventListener('dragstart', onDragStart);
    element.addEventListener('dragend', onDragEnd);

    this.cleanupFns.push(() => element.removeEventListener('click', onClick));
    this.cleanupFns.push(() => element.removeEventListener('dragstart', onDragStart));
    this.cleanupFns.push(() => element.removeEventListener('dragend', onDragEnd));
  }

  /**
   * Register a meeting row as drop zone and tap target.
   * @param {HTMLElement} element
   * @param {object} meeting
   */
  registerMeetingZone(element, meeting) {
    if (!element || !meeting) return;

    this.dropZoneElements.add(element);

    const onDragOver = (event) => {
      const activeActivity = this.draggedActivity || this.selectedActivity;
      if (!activeActivity) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      element.classList.add('meeting-row--drag-over');
    };

    const onDragLeave = () => {
      element.classList.remove('meeting-row--drag-over');
    };

    const onDrop = async (event) => {
      const activity = this.draggedActivity || this.selectedActivity;
      if (!activity) return;

      event.preventDefault();
      event.stopPropagation();
      element.classList.remove('meeting-row--drag-over');

      await this.handleAssignment(activity, meeting);
    };

    const onClick = async (event) => {
      if (!this.selectedActivity) return;
      if (event.target.closest('[data-ignore-assign="true"]')) return;

      event.preventDefault();
      event.stopPropagation();

      await this.handleAssignment(this.selectedActivity, meeting);
    };

    element.addEventListener('dragover', onDragOver);
    element.addEventListener('dragleave', onDragLeave);
    element.addEventListener('drop', onDrop);
    element.addEventListener('click', onClick);

    this.cleanupFns.push(() => element.removeEventListener('dragover', onDragOver));
    this.cleanupFns.push(() => element.removeEventListener('dragleave', onDragLeave));
    this.cleanupFns.push(() => element.removeEventListener('drop', onDrop));
    this.cleanupFns.push(() => element.removeEventListener('click', onClick));
  }

  selectActivity(activity, element = null) {
    this.selectedActivity = activity || null;

    if (this.selectedElement) {
      this.selectedElement.classList.remove('library-panel__item--selected');
    }

    this.selectedElement = element || null;
    if (this.selectedElement) {
      this.selectedElement.classList.add('library-panel__item--selected');
    }

    this.onSelectionChange(this.selectedActivity);
  }

  restoreSelection(activityId) {
    if (!activityId) {
      this.clearSelection();
      return;
    }

    const element = document.querySelector(`.library-panel__item[data-activity-id="${activityId}"]`);
    if (!element) {
      this.clearSelection();
      return;
    }

    const payload = element.dataset.activityPayload;
    if (!payload) {
      this.clearSelection();
      return;
    }

    try {
      const activity = JSON.parse(payload);
      this.selectActivity(activity, element);
    } catch (error) {
      debugError('[DragDropManager] Failed to restore selection payload:', error);
      this.clearSelection();
    }
  }

  clearSelection() {
    if (this.selectedElement) {
      this.selectedElement.classList.remove('library-panel__item--selected');
    }

    this.selectedActivity = null;
    this.selectedElement = null;
    this.onSelectionChange(null);
  }

  hasSelection() {
    return Boolean(this.selectedActivity);
  }

  getSelectedActivity() {
    return this.selectedActivity;
  }

  clearDragOverStates() {
    this.dropZoneElements.forEach((element) => {
      element.classList.remove('meeting-row--drag-over');
    });
  }

  async handleAssignment(activity, meeting) {
    try {
      await this.onAssign({ activity, meeting });
    } catch (error) {
      debugError('[DragDropManager] Assignment failed:', error);
    }
  }

  destroy() {
    this.cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        debugError('[DragDropManager] cleanup error:', error);
      }
    });

    this.cleanupFns = [];
    this.dropZoneElements.clear();
    this.draggedActivity = null;
    this.clearSelection();
  }
}

export default DragDropManager;
