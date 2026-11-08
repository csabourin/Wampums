import { getApiUrl } from '../config.js';

const REVIEW_PATH = '/api/v1/public/camp-branch-approval';

/** Public review requests carry their secret in a header, never in a cache key or HTTP URL. */
function reviewRequest(path, token, { signal, payload } = {}) {
  const headers = { 'X-Camp-Approval-Token': token };
  if (payload) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(getApiUrl(path), {
    signal, headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    method: payload ? 'POST' : 'GET', body: payload ? JSON.stringify(payload) : undefined,
  });
}

export function getCampBranchReview(token, signal) {
  return reviewRequest(REVIEW_PATH, token, { signal });
}

export function submitCampBranchReview(token, payload, signal) {
  return reviewRequest(REVIEW_PATH, token, { payload, signal });
}

export function getCampBranchReviewPdf(token, signal) {
  return reviewRequest('/api/v1/public/camp-branch-approval/pdf', token, { signal });
}
