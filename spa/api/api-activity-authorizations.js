import { API } from './api-core.js';

/** Resolve only counts and missing contacts for the current invitation. */
export async function previewActivityAuthorizations(invitation) {
  const response = await API.post('v1/activity-authorizations/preview', invitation);
  return response.data;
}

/** Rebuild durable request and address-level sending results. */
export async function getActivityAuthorizations(activityId) {
  const response = await API.getNoCache(`v1/activity-authorizations/${activityId}`);
  return response.data;
}

/** Create missing requests and send only unclaimed or explicitly failed addresses. */
export async function sendActivityAuthorizations(activityId, deadlineDate = null) {
  const response = await API.post(`v1/activity-authorizations/${activityId}`, { deadline_date: deadlineDate });
  if (response.queued || !response.data?.state) {throw new Error('authorization_unconfirmed');}
  return response.data;
}
