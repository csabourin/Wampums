import {
  saveOfflineData,
  getOfflineData,
  setCachedData, getCachedData 
} from "./indexedDB.js";
// const debugMode =
//   window.location.hostname === "localhost" ||
//   window.location.hostname.includes("replit.dev")
//     ? true
//     : false;
const debugMode=false;
const API_BASE_URL = debugMode ? 'http://localhost:3000' : 'https://wampums-api.replit.app';
console.log('API_BASE_URL:', API_BASE_URL);

// Utility function to determine the base URL
function getApiUrl(action, direct=false) {
  if(!direct){
    return `${API_BASE_URL}/api?action=${action}`;
  }
  else{
    debugger;
    return `${API_BASE_URL}/${action}`;
  }
}

export async function fetchFromApi(action, method = 'GET', body = null) {
  try {
    const response = await fetch(getApiUrl(action), {
      method,
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : null,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await handleResponse(response);
    if (result.success) {
      return result;
    } else {
      throw new Error(result.message || `Failed to fetch action ${action}`);
    }
  } catch (error) {
    console.error(`Error fetching ${action}:`, error);
    throw new Error(`Failed to fetch ${action}: ${error.message}`);
  }
}

// Utility function to get the JWT token from local storage
export function getAuthHeader() {
  const token = localStorage.getItem("jwtToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(response) {
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return response.json();
  } else {
    // If the response is not JSON, treat it as an error
    const text = await response.text();
    throw new Error(
      JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        message: "Unexpected non-JSON response",
        responseText: text,
      })
    );
  }
}


function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

function debugError(...args) {
  if (debugMode) {
    console.error(...args);
  }
}

// export async function fetchFromApi(action, method = 'GET', body = null) {
//   try {
//     const response = await fetch(`/api?action=${action}`, {
//       method,
//       headers: {
//         ...getAuthHeader(),
//         "Content-Type": "application/json",
//       },
//       body: body ? JSON.stringify(body) : null,
//     });

//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const result = await response.json();
//     if (result.success) {
//       return result;
//     } else {
//       throw new Error(result.message || `Failed to fetch action ${action}`);
//     }
//   } catch (error) {
//     console.error(`Error fetching ${action}:`, error);
//     throw new Error(`Failed to fetch ${action}: ${error.message}`);
//   }
// }

export async function LinkUserParticipants(data) {
  try {
    return await fetchFromApi('link_user_participants', 'POST', data);
  } catch (error) {
    console.error("Error linking participants:", error);
  }
}

export async function LinkUserParticipants(data) {
  try {
    return await fetchFromApi('link_user_participants', 'POST', data);
  } catch (error) {
    console.error("Error linking participants:", error);
  }
}

export async function getParticipantAgeReport() {
  return fetchFromApi('participant-age', 'GET');
}


export async function getGuardians(participantId) {
    try {
        console.log("Fetching guardians for participant ID:", participantId);
        const response = await fetch(`${getApiUrl('get_guardians')}&participant_id=${participantId}`, {
            headers: getAuthHeader(),
        });

        if (!response.ok) {
            throw new Error(`Error fetching guardians: ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Raw response from get_guardians API:", data);

        if (data.success && Array.isArray(data.guardians)) {
            console.log("Guardians fetched:", data.guardians);
            return data.guardians;
        } else {
            console.warn("No guardians found or invalid response structure");
            return [];
        }
    } catch (error) {
        console.error("Error fetching guardians:", error);
        return [];
    }
}


export async function getGuardianCoreInfo(guardianId) {
  try {
    console.log(`Fetching core info for guardian ID: ${guardianId}`);
    const response = await fetch(
      `${getApiUrl('get_guardian_info')}&guardian_id=${guardianId}`,
      {
        headers: getAuthHeader(),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const textResponse = await response.text();
    console.log("Raw response:", textResponse);

    let data;
    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      throw new Error("Invalid JSON response from server");
    }

    if (data.success && data.guardian_info) {
      console.log("Guardian core info fetched successfully:", data.guardian_info);
      return data.guardian_info;
    } else {
      throw new Error(data.message || "Failed to fetch guardian info");
    }
  } catch (error) {
    console.error("Error fetching guardian info:", error);
    throw error;
  }
}

export async function saveFormSubmission(formType, participantId, formData) {
  try {
    const response = await fetch(getApiUrl(`save_form_submission`), {
      method: "POST",
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        form_type: formType,
        participant_id: participantId,
        submission_data: formData,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (result.success) {
      return result;
    } else {
      throw new Error(result.message || "Failed to save form submission");
    }
  } catch (error) {
    console.error(`Error saving form submission for ${formType}:`, error);
    throw new Error(`Failed to save form submission: ${error.message}`);
  }
}

export async function getAllergiesReport() {
  try {
    return await fetchFromApi('get_allergies_report');
  } catch (error) {
    console.error('Error fetching allergies report:', error);
    throw new Error('Failed to fetch allergies report');
  }
}

export async function getMedicationReport() {
  try {
    return await fetchFromApi('get_medication_report');
  } catch (error) {
    console.error('Error fetching medication report:', error);
    throw new Error('Failed to fetch medication report');
  }
}

export async function getVaccineReport() {
  try {
    return await fetchFromApi('get_vaccine_report');
  } catch (error) {
    console.error('Error fetching vaccine report:', error);
    throw new Error('Failed to fetch vaccine report');
  }
}

export async function getLeaveAloneReport() {
  try {
    return await fetchFromApi('get_leave_alone_report');
  } catch (error) {
    console.error('Error fetching leave alone report:', error);
    throw new Error('Failed to fetch leave alone report');
  }
}

export async function getMediaAuthorizationReport() {
  try {
    return await fetchFromApi('get_media_authorization_report');
  } catch (error) {
    console.error('Error fetching media authorization report:', error);
    throw new Error('Failed to fetch media authorization report');
  }
}

export async function getMissingDocumentsReport() {
  try {
    return await fetchFromApi('get_missing_documents_report');
  } catch (error) {
    console.error('Error fetching missing documents report:', error);
    throw new Error('Failed to fetch missing documents report');
  }
}

export async function getHonorsReport() {
  try {
    return await fetchFromApi('get_honors_report');
  } catch (error) {
    console.error('Error fetching honors report:', error);
    throw new Error('Failed to fetch honors report');
  }
}

export async function getPointsReport() {
  const cacheKey = "get_points_report";

  // Try to retrieve from cache first
  const cachedPointsReport = await getCachedData(cacheKey);
  if (cachedPointsReport) {
    return cachedPointsReport; // Return cached data if available
  }

  try {
    const response = await fetch(getApiUrl(`get_points_report`), {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Cache points report in IndexedDB
    await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours

    return data;
  } catch (error) {
    console.error("Error fetching points report:", error);
    throw error;
  }
}

export async function fetchParticipant(participantId) {
  debugLog("Fetching participant with ID:", participantId);
  try {
    const response = await fetch(
      `${getApiUrl('get_participant')}&id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const data = await handleResponse(response);
    debugLog("#####################  API response for fetchParticipant:", data); // Log the full response
    if (data.success) {
      return data; // Return the entire data object
    } else {
      throw new Error(data.message || "Failed to fetch participant");
    }
  } catch (error) {
    console.error("Error fetching participant:", error);
    throw error;
  }
}

export async function approveUser(userId, organizationId) {
    try {
        const response = await fetch(getApiUrl(`approve_user`), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
            },
            body: JSON.stringify({ user_id: userId, organization_id: organizationId }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error approving user:", error);
        throw error;
    }
}

export async function updateUserRole(userId, newRole, organizationId) {
    try {
        const response = await fetch(getApiUrl(`update_user_role`), {

            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
            },
            body: JSON.stringify({ user_id: userId, new_role: newRole, organization_id: organizationId }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error updating user role:", error);
        throw error;
    }
}

export async function getCalendars() {
  try {
    const response = await fetch(getApiUrl(`get_calendars`), {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.calendars;
  } catch (error) {
    console.error("Error fetching calendars:", error);
    throw error;
  }
}

export async function updateCalendar(participantId, amount, amountPaid) {
  try {
    const response = await fetch(getApiUrl(`update_calendar`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ participant_id: participantId, amount: amount, amount_paid: amountPaid }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error("Error updating calendar:", error);
    throw error;
  }
}

export async function updateCalendarAmountPaid(participantId, amountPaid) {
  try {
    const response = await fetch(getApiUrl(`update_calendar_amount_paid`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ participant_id: participantId, amount_paid: amountPaid }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error("Error updating calendar amount paid:", error);
    throw error;
  }
}


export async function getGuestsByDate(date) {
    try {
        const response = await fetch(`${getApiUrl('get_guests_by_date')}&date=${date}`, {
            method: 'GET',
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
            'X-Organization-ID': getCurrentOrganizationId()
          }
        });

        const result = await response.json();
        console.log("Guests fetched for date:", date, result);  // Add this to verify the response

        if (result.success) {
            return result.guests;
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Error fetching guests:", error);
        return [];
    }
}

export async function getActivitesRencontre() {
  try {
    const response = await fetch(getApiUrl(`get_activites_rencontre`), {
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.activites;
  } catch (error) {
    console.error("Error fetching activites rencontre:", error);
    throw error;
  }
}

export async function getAnimateurs() {
  try {
    const response = await fetch(getApiUrl(`get_animateurs`), {
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.animateurs;
  } catch (error) {
    console.error("Error fetching animateurs:", error);
    throw error;
  }
}

export async function getRecentHonors() {
  try {
    const response = await fetch(getApiUrl(`get_recent_honors`), {
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.honors;
  } catch (error) {
    console.error("Error fetching recent honors:", error);
    throw error;
  }
}


export async function saveReunionPreparation(formData) {
  try {
    const response = await fetch(getApiUrl(`save_reunion_preparation`), {
      method: "POST",
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error saving reunion preparation:", error);
    throw error;
  }
}

export async function getReunionPreparation(date) {
  const cacheKey = `get_reunion_preparation_${date}`;

  // Try to retrieve from cache first
  const cachedPreparation = await getCachedData(cacheKey);
  if (cachedPreparation) {
    return cachedPreparation; // Return cached data if available
  }

  try {
    const response = await fetch(`${getApiUrl('get_reunion_preparation')}&date=${date}`, {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Cache reunion preparation data in IndexedDB
    await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours

    return data;
  } catch (error) {
    console.error("Error fetching reunion preparation:", error);
    throw error;
  }
}

export async function saveGuest(guest) {
      try {
          const response = await fetch(getApiUrl(`save_guest`), {
              method: 'POST',
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeader(),
              'X-Organization-ID': getCurrentOrganizationId()
            },
              body: JSON.stringify(guest)
          });

          const result = await response.json();
        console.log("Guest saved:", result);  // Add this to verify the response
          if (result.success) {
              console.log(result.message);
          } else {
              throw new Error(result.message);
          }
      } catch (error) {
          console.error("Error saving guest:", error);
      }
  }


export async function updateCalendarPaid(participantId, paidStatus) {
  try {
    const response = await fetch(getApiUrl(`update_calendar_paid`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ participant_id: participantId, paid_status: paidStatus }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error("Error updating calendar paid status:", error);
    throw error;
  }
}

export async function getParticipantCalendar(participantId) {
  try {
    const response = await fetch(`${getApiUrl('get_participant_calendar')}&participant_id=${participantId}`, {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.calendar;
  } catch (error) {
    console.error("Error fetching participant calendar:", error);
    throw error;
  }
}

export async function getUsers(organizationId) {
    try {
        const response = await fetch(`${getApiUrl('get_users')}&organization_id=${organizationId}`, {

            headers: getAuthHeader(),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const users = await response.json();
        return users.map(user => ({
            id: user.id,
            email: user.email,
            isVerified: user.is_verified === true,
            role: user.role,
            fullName: user.full_name,
            createdAt: new Date(user.created_at)
        }));
    } catch (error) {
        console.error("Error fetching users:", error);
        throw error;
    }
}

export async function getSubscribers(organizationId) {
    try {
        const response = await fetch(`${getApiUrl('get_subscribers')}&organization_id=${organizationId}`, {
            headers: getAuthHeader(),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const subscribers = await response.json();
        return subscribers.map(subscriber => ({
            id: subscriber.id,
            email: subscriber.email || `User ${subscriber.user_id}`,
            userId: subscriber.user_id
        }));
    } catch (error) {
        console.error("Error fetching subscribers:", error);
        throw error;
    }
}

export async function register(registerData) {
  try {
    const response = await fetch(getApiUrl(`register`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(registerData),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error registering:", error);
    throw error;
  }
}

export async function getMailingList() {
  try {
    const response = await fetch(getApiUrl(`get_mailing_list`), {
      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch mailing list. HTTP Status: ${response.status}`);
    }

    const data = await response.json();
    console.log("API response for getMailingList:", data); // Log the full response

    if (data.success) {
      return data;
    } else {
      throw new Error(data.message || "Failed to retrieve mailing list", data);
    }
  } catch (error) {
    console.error("Error fetching mailing list:", error);
    throw error;
  }
}


export async function fetchFicheSante(participantId) {
  try {
    const response = await fetch(
      `${getApiUrl('get_fiche_sante')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    );
    const data = await response.json();
    if (data.success) {
      return data.fiche_sante || null; // Return null if fiche_sante doesn't exist
    } else {
      throw new Error(data.message || "Failed to fetch fiche sante");
    }
  } catch (error) {
    console.error("Error fetching fiche sante:", error);
    return null; // Return null in case of any error
  }
}

export async function saveParticipant(participantData) {
  try {
    const url = getApiUrl(`save_participant`);
    const method = participantData.id ? "PUT" : "POST";

    // If updating, include the ID in the URL
    const fullUrl = participantData.id ? `${url}&id=${participantData.id}` : url;

    const response = await fetch(fullUrl, {
      method: method,
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(participantData),
    });

    const result = await response.json();
    if (result.success) {
      return result;
    } else {
      throw new Error(result.message || "Failed to save participant");
    }
  } catch (error) {
    console.error("Error saving participant:", error);
    throw new Error("Failed to save participant: " + error.message);
  }
}


export async function fetchGuardians(participantId) {
  try {
    const response = await fetch(
      `${getApiUrl('get_guardians')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    );
    const data = await response.json();
    return data.success ? data.guardians : [];
  } catch (error) {
    console.error("Error fetching guardians:", error);
    return [];
  }
}

export async function saveGuardian(guardianData) {
  try {
    const response = await fetch(getApiUrl(`save_parent`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify(guardianData),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error saving guardian:", error);
    throw error;
  }
}

export async function linkGuardianToParticipant(participantId, guardianId) {
  try {
    const response = await fetch(
      getApiUrl(`link_guardian_to_participant`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          participant_id: participantId,
          guardian_id: guardianId,
        }),
      }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error linking guardian to participant:", error);
    throw error;
  }
}

export async function getParticipants() {
  const PARTICIPANT_INFO_CACHE_KEY = "participant_info";
  try {
    // First, get the cached participant info (everything except points)
    const cachedParticipantInfo = await getCachedData(PARTICIPANT_INFO_CACHE_KEY);

    // Always fetch fresh data to get current points
    const response = await fetch(getApiUrl(`get_participants`), {

      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId(),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const freshData = await response.json();

    if (!freshData.success) {
      throw new Error(freshData.message || 'Failed to fetch participants');
    }

    // If we have cached info, merge it with fresh points data
    if (cachedParticipantInfo) {
      const mergedParticipants = freshData.participants.map(freshParticipant => {
        const cachedParticipant = cachedParticipantInfo.find(p => p.id === freshParticipant.id);
        if (cachedParticipant) {
          return {
            ...cachedParticipant,
            total_points: freshParticipant.total_points,
            group_total_points: freshParticipant.group_total_points
          };
        }
        return freshParticipant;
      });

      return { success: true, participants: mergedParticipants };
    }

    // If no cache exists, create it with everything except points
    const participantInfoToCache = freshData.participants.map(participant => ({
      id: participant.id,
      first_name: participant.first_name,
      last_name: participant.last_name,
      group_id: participant.group_id,
      group_name: participant.group_name,
      is_leader: participant.is_leader,
      is_second_leader: participant.is_second_leader
    }));

    // Cache the participant info (without points) for 24 hours
    await setCachedData(PARTICIPANT_INFO_CACHE_KEY, participantInfoToCache, 24 * 60 * 60 * 1000);

    return freshData;
  } catch (error) {
    console.error("Error fetching participants:", error);
    // If we're offline, try to use cached data with a warning
    if (!navigator.onLine) {
      const cachedParticipantInfo = await getCachedData(PARTICIPANT_INFO_CACHE_KEY);
      if (cachedParticipantInfo) {
        console.warn('Using cached participant data with potentially stale points');
        return {
          success: true,
          participants: cachedParticipantInfo.map(p => ({
            ...p,
            total_points: 0, // Reset points when using cached data offline
            group_total_points: 0
          }))
        };
      }
    }
    throw error;
  }
}


// Fetch groups from the API or from IndexedDB when offline
export async function getGroups() {
  try {
    const response = await fetch(getApiUrl(`get_groups`), {
      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await handleResponse(response);
    // Cache the fetched groups
    await saveOfflineData('groups', data);
    return data;
  } catch (error) {
    console.error("Error fetching groups:", error);
    // If offline, try to retrieve cached data
    if (!navigator.onLine) {
      const cachedGroups = await getOfflineData('groups');
      if (cachedGroups.length > 0) {
        console.log("Serving groups from IndexedDB cache");
        return cachedGroups;
      }
    }
    throw error;
  }
}

export async function getOrganizationSettings() {
  const cacheKey = "organization_settings";
  const expirationTime = 60 * 60 * 1000; // Cache expires after 60 minutes (adjust as needed)

  // Step 1: Try to get cached data from IndexedDB
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) {
    return cachedData; // Return cached data if available and not expired
  }

  // Step 2: Fetch from API if no valid cached data is found
  try {
    const response = await fetch(getApiUrl(`get_organization_settings`), {

      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json(); // Get the settings from the response

    // Step 3: Save the new data to IndexedDB for future use
    await setCachedData(cacheKey, data, expirationTime);

    console.log("Returning fresh organization settings");
    return data; // Return the newly fetched data
  } catch (error) {
    console.error("Error fetching organization settings:", error);
    throw error; // Propagate the error
  }
}

export async function getAttendance(date) {
  try {
    const response = await fetch(`${getApiUrl('get_attendance')}&date=${date}`, {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching attendance:", error);
    throw error;
  }
}

export async function updateAttendance(
  participantId,
  newStatus,
  date,
  previousStatus
) {
  try {
    const response = await fetch(getApiUrl(`update_attendance`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({
        participant_id: participantId,
        status: newStatus,
        date: date,
        previous_status: previousStatus,
      }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error updating attendance:", error);
    throw error;
  }
}

// Fetches all participants and honors from the server
export async function getHonorsAndParticipants(date = null) {
  try {
    const params = new URLSearchParams();
    params.append("action", "get_honors");
    if (date) {
      params.append("date", date);
    }

    const result = await fetchFromApi(`${params.toString()}`, 'GET', null);


    if (!result.participants || !result.honors || !result.availableDates) {
      console.error('Unexpected data structure from get_honors:', result);
      throw new Error("Unexpected data structure from get_honors");
    }

    return result;
  } catch (error) {
    console.error("Error fetching honors and participants:", error);
    throw error;
  }
}


export async function getHonors(date) {
  try {
    const response = await fetch(`${getApiUrl('get_honors')}&date=${date}`, {
      headers: getAuthHeader(),
      'X-Organization-ID': getCurrentOrganizationId()
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching honors:", error);
  }
}

export async function awardHonor(honors) {
  try {
    const response = await fetch(getApiUrl(`award_honor`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify(honors),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error awarding honor:", error);
  }
}

export async function getBadgeProgress(participantId) {
  try {
    const response = await fetch(
      `${getApiUrl('get_badge_progress')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    );
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error fetching badge progress:", error);
    return [];
  }
}

export async function saveBadgeProgress(badgeData) {
  try {
    const response = await fetch(getApiUrl(`save_badge_progress`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(), 
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify(badgeData),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error saving badge progress:", error);
    throw error;
  }
}

export async function getHealthReport() {
  try {
    const response = await fetch(getApiUrl(`get_health_report`), {
      method: "GET",
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
        "X-Organization-ID": getCurrentOrganizationId(),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (result.success) {
      return result;
    } else {
      throw new Error(result.message || "Failed to fetch health report");
    }
  } catch (error) {
    console.error("Error fetching health report:", error);
    throw error;
  }
}


export async function getHealthContactReport() {
  try {
    const response = await fetch(getApiUrl(`get_health_contact_report`));
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching health contact report:", error);
  }
}

export async function getAttendanceReport(startDate = null, endDate = null) {
  try {
    let url = getApiUrl(`get_attendance_report`);
    if (startDate && endDate) {
      url += `&start_date=${startDate}&end_date=${endDate}`;
    }

    console.log("Fetching attendance report from URL:", url); // Add this line for debugging

    const response = await fetch(url, {
      headers: getAuthHeader()
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Received attendance report data:", data); // Add this line for debugging

    return data;
  } catch (error) {
    console.error("Error fetching attendance report:", error);
    throw error;
  }
}

export async function logout() {
  try {
    const response = await fetch(getApiUrl(`logout`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
}

export async function login(email, password,organization_id) {
  try {
    const response = await fetch(getApiUrl(`login`,true), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: email,
        password: password,
        organization_id: organization_id,
      }),
    });

    // Try to parse the response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      console.error("Error parsing JSON:", error);
      throw new Error("Invalid JSON response from server");
    }

    return data;
  } catch (error) {
    console.error("Error logging in:", error);
    throw error;
  }
}

export async function registerForOrganization(registrationData) {
  try {
    const response = await fetch(getApiUrl(`register_for_organization`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader()
      },
      body: JSON.stringify(registrationData)
    });
    return await response.json();
  } catch (error) {
    console.error("Error registering for organization:", error);
    throw error;
  }
}

export async function getUserChildren(userId) {
  try {
    const response = await fetch(`${getApiUrl('get_user_children')}&user_id=${userId}`, {
      headers: getAuthHeader()
    });
    return await response.json();
  } catch (error) {
    console.error("Error fetching user's children:", error);
    throw error;
  }
}

export async function getReunionDates() {
    const response = await fetch(getApiUrl(`get_reunion_dates`), {
        headers: getAuthHeader(),
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.dates;
}

export async function fetchParents(participantId) {
  try {
    debugLog("Fetching parents for participantId:", participantId);
    const response = await fetch(
      `${getApiUrl('get_parents_guardians')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const textResponse = await response.text(); // Log the raw text response
    const data = JSON.parse(textResponse); // Parse the response manually

    debugLog("Parsed response:", data);

    if (data.success) {
      debugLog("Returning parents/guardians:", data.parents_guardians);
      return data.parents_guardians;
    } else {
      console.error("Error in fetchParents:", data.message);
      throw new Error(data.message || "Failed to fetch parents/guardians");
    }
  } catch (error) {
    console.error("Error in fetchParents:", error);
    return []; // Return an empty array in case of error
  }
}

export async function linkParentToParticipant(participantId, parentId) {
  try {
    const response = await fetch(getApiUrl(`link_parent_to_participant`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        participant_id: participantId,
        parent_id: parentId,
      }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error linking parent to participant:", error);
    throw error;
  }
}

export async function saveParent(parentData) {
  try {
    debugLog("Sending Parent Data to API:", parentData);
    const response = await fetch(getApiUrl(`save_parent`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify(parentData),
    });
    const responseText = await response.text();
    debugLog("Raw API Response:", responseText);
    const data = JSON.parse(responseText);
    debugLog("Parsed API Response:", data);
    return data;
  } catch (error) {
    console.error("Error saving parent:", error);
    throw error;
  }
}

export async function fetchOrganizationId() {
  // Check if the organization ID is already in localStorage
  const storedId = localStorage.getItem('organizationId');
  if (storedId) {
    console.log("Using stored organization ID from localStorage:", storedId);
    return parseInt(storedId, 10);
  }

  // If not found in localStorage, fetch from the server
  try {
    console.log("Fetching organization ID from the server...");

    // Get the current hostname
    const hostname = window.location.hostname;

    // Create the URL with the correct action parameter
    const url = `${getApiUrl('get_organization_id',false)}&hostname=${encodeURIComponent(hostname)}`;
    console.log("URL to fetch organization ID:", url);
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn("Failed to fetch organization ID from the server:", response.status);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Check for the organizationId in the response structure
    // Handling both possible response formats for compatibility
    const organizationId = data.data?.organizationId || data.organizationId;

    if (data.success && organizationId) {
      // Store the organization ID in localStorage for future use
      localStorage.setItem('organizationId', organizationId);
      console.log("Organization ID fetched and stored:", organizationId);
      return parseInt(organizationId, 10);
    } else {
      throw new Error("Failed to fetch organization ID from the server");
    }
  } catch (error) {
    console.error("Error fetching organization ID:", error);
    throw error;
  }

}

export async function fetchParticipants(organizationId) {
  try {
    const response = await fetch(`${getApiUrl('get_parent_dashboard_data')}&organization_id=${organizationId}`, {
      headers: getAuthHeader(),
    });
    const data = await response.json();

    if (data.success && Array.isArray(data.participants)) {
      // Sort participants by first name in alphabetical order
      data.participants.sort((a, b) => a.first_name.localeCompare(b.first_name));
      return data.participants;
    } else {
      console.error("Unexpected API response:", data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching participants:", error);
    return [];
  }
}


export async function updatePoints(updates) {
  try {
    const response = await fetch(getApiUrl(`update_points`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error updating points:", error);
    throw error;
  }
}

export async function updateParticipantGroup(participantId, groupId, isLeader = false, isSecondLeader = false) {
  const requestData = {
    participant_id: participantId,
    group_id: groupId,
    is_leader: isLeader,
    is_second_leader: isSecondLeader,
  };

  console.log("Request data to be sent:", JSON.stringify(requestData));

  try {
    const response = await fetch(getApiUrl(`update_participant_group`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId(),
      },
      body: JSON.stringify(requestData), // Sending the data as JSON
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error in updateParticipantGroup:", error);
    throw error;
  }
}


export async function getParticipantsWithUsers() {
  try {
    const response = await fetch(
      getApiUrl(`get_participants_with_users`),
      {
        headers: {
          ...getAuthHeader(),
        },
      }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching participants with users:", error);
    throw error;
  }
}

export async function getParentUsers() {
  try {
    const response = await fetch(getApiUrl(`get_parent_users`), {
      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching parent users:", error);
    throw error;
  }
}


export async function associateUser(participantId, userId) {
  try {
    const response = await fetch(getApiUrl(`associate_user`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ participant_id: participantId, user_id: userId }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error associating user:", error);
    throw error;
  }
}

export async function addGroup(groupName) {
  try {
    const response = await fetch(getApiUrl(`add_group`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({ group_name: groupName }),
    });
    return await response.json();
  } catch (error) {
    console.error("Error adding group:", error);
    throw error;
  }
}

export async function getAttendanceDates() {
  const cacheKey = "get_attendance_dates";

  // Try to retrieve from cache first
  const cachedAttendanceDates = await getCachedData(cacheKey);
  if (cachedAttendanceDates) {
    return cachedAttendanceDates; // Return cached data if available
  }

  try {
    const response = await fetch(getApiUrl(`get_attendance_dates`), {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Cache attendance dates in IndexedDB
    await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours

    return data;
  } catch (error) {
    console.error("Error fetching attendance dates:", error);
    throw error;
  }
}

export async function getAvailableDates() {
  try {
    const response = await fetch(getApiUrl(`getAvailableDates`), {
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error("Failed to fetch available dates");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching available dates:", error);
    throw error;
  }
}

export async function removeGroup(groupId) {
  try {
    const response = await fetch(getApiUrl(`remove_group`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({ group_id: groupId }),
    });
    return await response.json();
  } catch (error) {
    console.error("Error removing group:", error);
    throw error;
  }
}

export async function updateGroupName(groupId, newName) {
  try {
    const response = await fetch(getApiUrl(`update_group_name`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({ group_id: groupId, group_name: newName }),
    });
    return await response.json();
  } catch (error) {
    console.error("Error updating group name:", error);
    throw error;
  }
}

export async function getFormTypes() {
  try {
    const response = await fetch(getApiUrl(`get_form_types`), {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
        'X-Organization-ID': getCurrentOrganizationId() // Send organization ID to filter forms
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message || "Failed to fetch form types");
    }
  } catch (error) {
    console.error("Error fetching form types:", error);
    return [];
  }
}


// Fetch the structure of the forms for the organization
export async function getFormStructure() {
  try {
    const response = await fetch(getApiUrl(`get_organization_form_formats`), {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.formFormats;
    } else {
      throw new Error(data.message || 'Failed to fetch organization form formats');
    }
  } catch (error) {
    console.error('Error fetching form structure:', error);
    throw error;
  }
}

// Fetch all form submissions for a specific form type and participant
export async function getFormSubmissions(participantId = null, formType) {
  if (!formType) {
    throw new Error('Form type is required');
  }

  // Construct the URL with the appropriate query parameters
  let url = `${getApiUrl('get_form_submissions')}&form_type=${encodeURIComponent(formType)}`;

  if (participantId) {
    url += `&participant_id=${encodeURIComponent(participantId)}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message || 'Failed to fetch form submissions');
    }
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    throw error;
  }
}





export async function getParticipantsWithDocuments() {
  try {
    // Fetch participant documents
    const response = await fetch(getApiUrl(`get_participants_with_documents`), {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Received data:', data); // Add this line to log the received data

    if (!data || !Array.isArray(data.participants)) {
      console.error('Invalid data structure:', data); // Add this line to log the invalid structure
      throw new Error('Invalid data structure: participants list is missing or not an array');
    }

    // Fetch organization settings to determine which form types to look for
    const organizationSettingsResponse = await getOrganizationSettings();
    if (!organizationSettingsResponse || !organizationSettingsResponse.settings) {
      throw new Error('Failed to fetch or parse organization settings');
    }

    // Extract form types dynamically from settings keys ending with '_structure'
    const formTypes = Object.keys(organizationSettingsResponse.settings)
      .filter(key => key.endsWith('_structure'))
      .map(key => key.replace('_structure', ''));

    // Process the data to identify form submissions for each participant
    data.participants = data.participants.map(participant => {
      const updatedParticipant = { ...participant };

      // Loop through all form types and set the `has_*` property for each
      formTypes.forEach(formType => {
        // Handle the different data types that might be returned (1/0, true/false, etc.)
        updatedParticipant[`has_${formType}`] = !!participant[`has_${formType}`];
      });

      return updatedParticipant;
    });


    return data;
  } catch (error) {
    console.error('Error fetching participants with documents:', error);
    throw error;
  }
}


export async function getOrganizationFormFormats(organizationId = null) {
    try {
        const response = await fetch(getApiUrl(`get_organization_form_formats`) + (organizationId !== null ? `&organization_id=${organizationId}` : ''), {
            method: 'GET',
            headers: {
                ...getAuthHeader(),
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            return data.formFormats;
        } else {
            throw new Error(data.message || 'Failed to fetch organization form formats');
        }
    } catch (error) {
        console.error('Error fetching organization form formats:', error);
        throw error;
    }
}


export async function getFormSubmission(participantId, formType) {
  try {
    const response = await fetch(`${getApiUrl('get_form_submission')}&participant_id=${participantId}&form_type=${formType}`, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.form_data) {
      return { success: true, form_data: data.form_data };
    } else {
      console.warn("No form submission found:", data.message);
      return { success: false, message: data.message || 'No form data found' };
    }
  } catch (error) {
    console.error('Error fetching form submission:', error);
    throw error;
  }
}

export async function getParentContactList() {
  const cacheKey = "get_parent_contact_list";

  // Try to retrieve from cache first
  const cachedParentContactList = await getCachedData(cacheKey);
  if (cachedParentContactList) {
    return cachedParentContactList; // Return cached data if available
  }

  try {
    const response = await fetch(getApiUrl(`get_parent_contact_list`), {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Cache parent contact list in IndexedDB
    await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours

    return data;
  } catch (error) {
    console.error("Error fetching parent contact list:", error);
    throw error;
  }
}


function addCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}`;
}

export async function getPendingBadges() {
  try {
    const response = await fetch(
      addCacheBuster(getApiUrl(`get_pending_badges`)),
      {
        headers: getAuthHeader(),
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      return data;
    } else if (data.pending_badges && Array.isArray(data.pending_badges)) {
      return data.pending_badges;
    } else {
      console.error("Unexpected response format:", data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching pending badges:", error);
    return [];
  }
}

export async function checkLoginStatus() {
  const token = localStorage.getItem("jwtToken");
  return { isLoggedIn: !!token };
}

export async function updateBadgeStatus(badgeId, action) {
  try {
    const response = await fetch(getApiUrl(`update_badge_status`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ badge_id: badgeId, action: action }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error updating badge status:", error);
    throw error;
  }
}

export async function getParentsGuardians(participantId) {
  try {
    const response = await fetch(
      `${getApiUrl('get_parents_guardians')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const textResponse = await response.text(); // Log the raw text response
    debugLog("Raw response:", textResponse);
    const data = JSON.parse(textResponse); // Parse the response manually

    if (data.success) {
      return data.parents_guardians;
    } else {
      throw new Error(data.message || "Failed to fetch parents/guardians");
    }
  } catch (error) {
    console.error("Error fetching parents/guardians:", error);
    throw error;
  }
}

export async function saveFicheSante(ficheSanteData) {
  console.log(
    "saveFicheSante called with data:",
    JSON.stringify(ficheSanteData, null, 2)
  );
  try {
    const response = await fetch(getApiUrl(`save_fiche_sante`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify(ficheSanteData),
    });
    debugLog("Fiche sante save response status:", response.status);
    const responseText = await response.text();
    debugLog("Fiche sante save response text:", responseText);
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Error parsing JSON response:", parseError);
      throw new Error("Invalid JSON response from server");
    }
    console.log(
      "Parsed fiche sante save response:",
      JSON.stringify(data, null, 2)
    );
    if (data.success) {
      return data;
    } else {
      throw new Error(data.message || "Failed to save fiche sante");
    }
  } catch (error) {
    console.error("Error in saveFicheSante:", error);
    throw error;
  }
}

export async function fetchAcceptationRisque(participantId) {
  try {
    const response = await fetch(
      `${getApiUrl('get_acceptation_risque')}&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const data = await response.json();
    if (data.success) {
      return data.acceptation_risque;
    } else if (data.message === "Acceptation risque not found") {
      return null; // Return null if no acceptation risque exists for this participant
    } else {
      throw new Error(data.message || "Failed to fetch acceptation risque");
    }
  } catch (error) {
    console.error("Error fetching acceptation risque:", error);
    throw error;
  }
}

export async function removeGuardians(participantId, guardianIds) {
  try {
    const response = await fetch(getApiUrl(`remove_guardians`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({
        participant_id: participantId,
        guardian_ids: guardianIds,
      }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error removing guardians:", error);
    throw error;
  }
}

export async function saveAcceptationRisque(acceptationRisqueData) {
  try {
    const response = await fetch(getApiUrl(`save_acceptation_risque`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify(acceptationRisqueData),
    });
    const data = await response.json();
    if (data.success) {
      return data;
    } else {
      throw new Error(
        JSON.stringify(data) || "Failed to save acceptation risque"
      );
    }
  } catch (error) {
    console.error("Error saving acceptation risque:", error);
    throw error;
  }
}

export async function getCurrentStars(participantId, territoire) {
  try {
    const response = await fetch(getApiUrl(`action=get_current_stars&participant_id=${participantId}&territoire=${encodeURIComponent(
        territoire
      )}`),
      {
        method: "GET",
        headers: getAuthHeader(),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching current stars:", error);
    throw error;
  }
}

// Utility function to get the current organization ID
export function getCurrentOrganizationId() {
    return app.organizationId || localStorage.getItem('currentOrganizationId');
}

// Utility function to set the current organization ID
function setCurrentOrganizationId(organizationId) {
  localStorage.setItem('currentOrganizationId', organizationId);
}

// Function to sync offline data
export async function syncOfflineData() {
  if (navigator.onLine) {
    try {
      const offlineData = await getOfflineData();
      for (const item of offlineData) {
        switch (item.action) {
          case 'saveParticipant':
            await saveParticipant(item.data);
            break;
          case 'updateAttendance':
            await updateAttendance(item.data.participantId, item.data.newStatus, item.data.date, item.data.previousStatus);
            break;
          // Add cases for other offline actions
        }
      }
      await clearOfflineData();
    } catch (error) {
      console.error("Error syncing offline data:", error);
    }
  }
}
