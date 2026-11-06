/**
 * Camp review (#1257): what a camp's review noted, and the "+1" given to each note.
 *
 * Mounted at /api/v1/camp-reviews. Reading takes `camp_reviews.view`; writing
 * takes `camp_reviews.manage`. Notes are free text, so a demo account writes
 * nothing. Noting and voting name the id the device chose, so the offline
 * outbox may replay them; sorting, merging and closing are online only
 * (services/campReviews.js, devdocs/CAMP_REVIEWS.md).
 *
 * @module routes/camp-reviews
 */
const express = require('express');
const { param } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { HTTP_STATUS } = require('../utils/http-status');
const transaction = require('../utils/transaction');
const {
  CampReviewError, readCampReview, saveNote, deleteNote, addVote, removeVote, sortNote, mergeNote, unmergeNote, setReviewStatus,
} = require('../services/campReviews');

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CampReviewError) {
      const fields = err.field ? [{ path: err.field, location: 'body', msg: err.message }] : undefined;
      return error(res, err.message, err.status, fields);
    }
    throw err;
  }
});

const noteIdParam = param('noteId').isUUID().withMessage('camp_review_invalid_id');
const voteIdParam = param('voteId').isUUID().withMessage('camp_review_invalid_id');
const ids = (req) => ({
  meetingId: Number(req.params.meetingId),
  noteId: String(req.params.noteId).toLowerCase(),
  voteId: req.params.voteId ? String(req.params.voteId).toLowerCase() : null,
});

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  router.get('/camps/:meetingId',
    requirePermission('camp_reviews.view'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      res.set('Cache-Control', 'no-store');
      return success(res, await readCampReview(pool, organizationId, Number(req.params.meetingId), req.user.id));
    }));

  router.put('/camps/:meetingId/notes/:noteId',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId } = ids(req);
      const { note, notes, created } = await transaction(pool, (db) =>
        saveNote(db, organizationId, req.user.id, meetingId, noteId, req.body));
      return success(res, { note, notes }, 'camp_review_note_saved', created ? HTTP_STATUS.CREATED : HTTP_STATUS.OK);
    }));

  router.delete('/camps/:meetingId/notes/:noteId',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId } = ids(req);
      return success(res, await transaction(pool, (db) => deleteNote(db, organizationId, meetingId, noteId)), 'camp_review_note_deleted');
    }));

  router.put('/camps/:meetingId/notes/:noteId/votes/:voteId',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    voteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId, voteId } = ids(req);
      return success(res, await transaction(pool, (db) => addVote(db, organizationId, req.user.id, meetingId, noteId, voteId)), 'camp_review_vote_saved');
    }));

  router.delete('/camps/:meetingId/notes/:noteId/votes/:voteId',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    voteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId, voteId } = ids(req);
      return success(res, await transaction(pool, (db) => removeVote(db, organizationId, req.user.id, meetingId, noteId, voteId)), 'camp_review_vote_removed');
    }));

  // Sorting after the camp: to keep or to fix, with a short action.
  router.patch('/camps/:meetingId/notes/:noteId',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId } = ids(req);
      return success(res, await transaction(pool, (db) => sortNote(db, organizationId, req.user.id, meetingId, noteId, req.body)),
        'camp_review_note_sorted');
    }));

  router.put('/camps/:meetingId/notes/:noteId/merge',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId } = ids(req);
      return success(res, await transaction(pool, (db) => mergeNote(db, organizationId, req.user.id, meetingId, noteId, req.body)),
        'camp_review_note_merged_saved');
    }));

  router.delete('/camps/:meetingId/notes/:noteId/merge',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    noteIdParam,
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, noteId } = ids(req);
      return success(res, await transaction(pool, (db) => unmergeNote(db, organizationId, req.user.id, meetingId, noteId)),
        'camp_review_note_unmerged');
    }));

  router.put('/camps/:meetingId/status',
    blockDemoRoles,
    requirePermission('camp_reviews.manage'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await transaction(pool, (db) =>
        setReviewStatus(db, organizationId, req.user.id, Number(req.params.meetingId), req.body)), 'camp_review_status_saved');
    }));

  return router;
};
