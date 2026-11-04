# Route and screen templates

Starting points for a new API route and a new SPA screen, following CLAUDE.md §2–§9.

## Backend Route Template

```javascript
// routes/resource.js
const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');

module.exports = (pool) => {
  const router = express.Router();

  // GET collection - read permission
  router.get('/v1/resources', 
    authenticate, 
    requirePermission('resources.view'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      
      const result = await pool.query(
        'SELECT * FROM resources WHERE organization_id = $1 ORDER BY created_at DESC',
        [organizationId]
      );
      
      return success(res, result.rows);
    })
  );

  // POST create - manage permission + block demos
  router.post('/v1/resources', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { name, description } = req.body;
      
      // Validate input
      if (!name) {
        return error(res, 'Name is required', 400);
      }
      
      const result = await pool.query(
        'INSERT INTO resources (name, description, organization_id) VALUES ($1, $2, $3) RETURNING *',
        [name, description, organizationId]
      );
      
      return success(res, result.rows[0], 'Resource created', 201);
    })
  );

  // PATCH update - manage permission + ownership check
  router.patch('/v1/resources/:id', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    validateIdParam('id'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = Number(req.params.id);
      const { name, description } = req.body;
      
      // Verify resource exists and belongs to organization
      const check = await pool.query(
        'SELECT id FROM resources WHERE id = $1 AND organization_id = $2',
        [resourceId, organizationId]
      );
      
      if (check.rows.length === 0) {
        return error(res, 'Resource not found', 404);
      }
      
      const result = await pool.query(
        'UPDATE resources SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = NOW() WHERE id = $3 AND organization_id = $4 RETURNING *',
        [name, description, resourceId, organizationId]
      );
      
      return success(res, result.rows[0], 'Resource updated');
    })
  );

  // DELETE - manage permission
  router.delete('/v1/resources/:id', 
    authenticate, 
    blockDemoRoles,
    requirePermission('resources.manage'), 
    validateIdParam('id'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resourceId = Number(req.params.id);
      
      const result = await pool.query(
        'DELETE FROM resources WHERE id = $1 AND organization_id = $2 RETURNING id',
        [resourceId, organizationId]
      );
      
      if (result.rows.length === 0) {
        return error(res, 'Resource not found', 404);
      }
      
      return success(res, null, 'Resource deleted');
    })
  );

  return router;
};
```

## Frontend Module Template

A new screen, modelled on `spa/modules/walk-in/WalkInChildren.js` and `spa/modules/messages/Messages.js`.

```javascript
// spa/api/api-resources.js
import { API } from './api-core.js';

/** @returns {Promise<Object>} The unit's resources */
export function getResources(options = {}) {
  return API.get('v1/resources', {}, options);   // options: { forceRefresh, cacheDuration }
}

/** @returns {Promise<Object>} API response */
export function deleteResource(resourceId) {
  return API.delete(`v1/resources/${encodeURIComponent(resourceId)}`);  // invalidates the cache itself
}
```

```javascript
// spa/modules/resources/ResourceManager.js
/**
 * Resources — what the unit lends out, and removing what it no longer has.
 *
 * @module spa/modules/resources/ResourceManager
 */
import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { confirmDestructive } from '../../utils/DialogUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { getResources, deleteResource } from '../../api/api-resources.js';

export class ResourceManager {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.resources = [];
    // The permission the DELETE route requires, so the button is offered exactly when it would work.
    this.canManage = hasPermission('resources.manage');
    this.destroyed = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Promise<void>} */
  async init() {
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load resources:', error);
      this.renderError();
    }
  }

  /** @param {{forceRefresh?: boolean}} [options] */
  async load(options = {}) {
    const response = await getResources(options);
    this.resources = Array.isArray(response?.data) ? response.data : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  renderLoading() {
    setContent(this.root(), `
      <section class="page resources" aria-busy="true">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    setContent(this.root(), `
      <section class="page resources">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="resources-retry">${translate('retry')}</button>
      </section>
    `);
    document.getElementById('resources-retry')?.addEventListener('click', () => this.init());
  }

  render() {
    // #app outlives every screen: a late answer must not draw over the next one.
    if (this.destroyed) {
      return;
    }
    const root = this.root();
    const items = this.resources.map((resource) => `
      <li class="resource-card">
        <span>${escapeHTML(resource.name)}</span>
        ${this.canManage ? `
          <button type="button" class="button button--small button--danger" data-delete="${Number(resource.id)}">
            ${translate('delete')}
          </button>` : ''}
      </li>`).join('');
    setContent(root, `
      <section class="page resources">
        ${renderBackLink()}
        <h1>${translate('resources_title')}</h1>
        ${items ? `<ul class="resource-list">${items}</ul>` : `<p>${translate('resources_empty')}</p>`}
      </section>
    `);
    // The markup was just replaced, so these listeners never stack.
    root.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => this.remove(Number(button.dataset.delete)));
    });
  }

  /** @param {number} resourceId */
  async remove(resourceId) {
    const resource = this.resources.find((item) => item.id === resourceId);
    const confirmed = await confirmDestructive({
      title: translate('resources_delete_title'),
      message: translate('resources_delete_confirm').replace('{name}', resource?.name ?? ''),
    });
    if (!confirmed) {
      return;
    }
    let result;
    try {
      result = await deleteResource(resourceId);
    } catch (error) {
      debugError('Failed to delete resource:', error);
      this.app.showMessage(apiErrorMessage(error, 'resources_delete_failed'), 'error');
      return;
    }
    // Offline, the delete is only queued: say so rather than claim it is done.
    this.app.showMessage(
      translate(result?.queued ? 'resources_delete_queued' : 'resources_deleted'),
      result?.queued ? 'info' : 'success',
    );
    // The delete stands even if the reload fails: show the error state, not "delete failed".
    try {
      await this.load({ forceRefresh: true });
      this.render();
    } catch (error) {
      debugError('Failed to reload resources:', error);
      this.renderError();
    }
  }
}
```

Then register it in `spa/router.js` (loader, path, `guard(hasPermission('resources.view'))`), add every
key to `lang/en.json` and `lang/fr.json`, and add `test/spa/ResourceManager.test.js` (§12).
