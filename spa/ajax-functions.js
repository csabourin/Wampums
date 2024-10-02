import {
  saveParticipants,
  getParticipantsFromCache,
  saveGroups,
  getGroupsFromCache,
  saveOfflineData,
} from "./indexedDB.js";

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

const debugMode =
  window.location.hostname === "localhost" ||
  window.location.hostname.includes("replit.dev")
    ? true
    : false;

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

async function fetchFromApi(action) {
  try {
    const response = await fetch(`/api.php?action=${action}`, {
      method: 'GET',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${action}:`, error);
    throw new Error(`Failed to fetch ${action}: ${error.message}`);
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
  try {
    return await fetchFromApi('get_points_report');
  } catch (error) {
    console.error('Error fetching points report:', error);
    throw new Error('Failed to fetch points report');
  }
}

export async function fetchParticipant(participantId) {
  debugLog("Fetching participant with ID:", participantId);
  try {
    const response = await fetch(
      `/api.php?action=get_participant&id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const data = await handleResponse(response);
    debugLog("API response for fetchParticipant:", data); // Log the full response
    if (data.success) {
      return data.participant; // Access 'data.participant'
    } else {
      throw new Error(data.message || "Failed to fetch participant");
    }
  } catch (error) {
    console.error("Error fetching participant:", error);
    throw error;
  }
}

export async function approveUser(userId) {
  try {
    const response = await fetch("/api.php?action=approve_user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ user_id: userId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error approving user:", error);
    throw error;
  }
}

export async function updateUserRole(userId, newRole) {
  try {
    const response = await fetch("/api.php?action=update_user_role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ user_id: userId, new_role: newRole }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error updating user role:", error);
    throw error;
  }
}

export async function getCalendars() {
  try {
    const response = await fetch("/api.php?action=get_calendars", {
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
    const response = await fetch("/api.php?action=update_calendar", {
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
    const response = await fetch("/api.php?action=update_calendar_amount_paid", {
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
        const response = await fetch(`/api.php?action=get_guests_by_date&date=${date}`, {
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
        alert("error_fetching_guests");
        return [];
    }
}



export async function saveGuest(guest) {
      try {
          const response = await fetch('/api.php?action=save_guest', {
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
    const response = await fetch("/api.php?action=update_calendar_paid", {
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
    const response = await fetch(`/api.php?action=get_participant_calendar&participant_id=${participantId}`, {
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

export async function getUsers() {
  try {
    const response = await fetch("/api.php?action=get_users", {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const users = await response.json();
    return users.map(user => ({
      id: user.id,
      email: user.email,
      isVerified: user.is_verified === true, // Convert string to boolean
      role: user.role,
      fullName: user.full_name,
      createdAt: new Date(user.created_at)
    }));
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
}

export async function getSubscribers() {
  try {
    const response = await fetch("/api.php?action=get_subscribers", {
      headers: getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const subscribers = await response.json();
    return subscribers.map(subscriber => ({
      id: subscriber.id,
      email: subscriber.email || `User ${subscriber.user_id}`, // Fallback if email is not provided
      userId: subscriber.user_id
    }));
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    throw error;
  }
}

export async function register(registerData) {
  try {
    const response = await fetch("/api.php?action=register", {
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
    const response = await fetch("/api.php?action=get_mailing_list", {
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
      `/api.php?action=get_fiche_sante&participant_id=${participantId}`,
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
    console.log("Saving participant with data:", participantData); // Add this log to see the exact data being sent
    const response = await fetch("/api.php?action=save_participant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify(participantData),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error saving participant:", error);
    throw error;
  }
}


export async function fetchGuardians(participantId) {
  try {
    const response = await fetch(
      `/api.php?action=get_guardians&participant_id=${participantId}`,
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
    const response = await fetch("/api.php?action=save_guardian", {
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
      "/api.php?action=link_guardian_to_participant",
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

// Fetch participants from the API or from IndexedDB when offline
export async function getParticipants() {
  try {
    const response = await fetch("/api.php?action=get_participants", {
      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching participants:", error);
    throw error;
  }
}


// Fetch groups from the API or from IndexedDB when offline
export async function getGroups() {
  try {
    const response = await fetch("/api.php?action=get_groups", {
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
  try {
    const response = await fetch('/api.php?action=get_organization_settings', {
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
      // Check if the response includes the new structure
      if (data.form_structures) {
        return {
          settings: data.settings,
          formStructures: data.form_structures
        };
      } else {
        // Backward compatibility: return just the settings if form_structures is not present
        return {
          success: true,
          settings: data.settings,
          formStructures: {}
        };
      }
    } else {
      throw new Error(data.message || 'Failed to fetch organization settings');
    }
  } catch (error) {
    console.error('Error fetching organization settings:', error);
    throw error;
  }
}

export async function getAttendance(date) {
  try {
    const response = await fetch(
      `/api.php?action=get_attendance&date=${date}`,
      { headers: getAuthHeader(),
      'X-Organization-ID': getCurrentOrganizationId()
      }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching attendance:", error);
  }
}

export async function updateAttendance(
  nameId,
  newStatus,
  date,
  previousStatus
) {
  try {
    const response = await fetch("/api.php?action=update_attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({
        name_id: nameId,
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
    const url = new URL("/api.php", window.location.origin);
    url.searchParams.append("action", "get_honors");
    if (date) {
      url.searchParams.append("date", date);
    }

    const response = await fetch(url, {
      headers: {
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('API raw response:', data); // Add this line for debugging

    if (!data.participants || !data.honors || !data.availableDates) {
      console.error('Unexpected data structure from get_honors:', data);
      throw new Error("Unexpected data structure from get_honors");
    }

    return data;
  } catch (error) {
    console.error("Error fetching honors and participants:", error);
    throw error;
  }
}

export async function getHonors(date) {
  try {
    const response = await fetch(`/api.php?action=get_honors&date=${date}`, {
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
    const response = await fetch("/api.php?action=award_honor", {
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
      `/api.php?action=get_badge_progress&participant_id=${participantId}`,
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
    const response = await fetch("/api.php?action=save_badge_progress", {
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

export async function getHealthContactReport() {
  try {
    const response = await fetch("/api.php?action=get_health_contact_report");
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching health contact report:", error);
  }
}

export async function getAttendanceReport(startDate = null, endDate = null) {
  try {
    let url = '/api.php?action=get_attendance_report';
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
    const response = await fetch("/api.php?action=logout", {
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

export async function login(email, password) {
  try {
    const response = await fetch("/api.php?action=login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: email,
        password: password,
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

export async function getAllParents() {
  try {
    const response = await fetch("/api.php?action=get_all_parents", {
      headers: getAuthHeader(),
    });
    const data = await response.json();
    if (data.success) {
      return data.parents;
    } else {
      throw new Error("Failed to fetch all parents");
    }
  } catch (error) {
    console.error("Error fetching all parents:", error);
    throw error;
  }
}

export async function fetchParents(participantId) {
  try {
    debugLog("Fetching parents for participantId:", participantId);
    const response = await fetch(
      `/api.php?action=get_parents_guardians&participant_id=${participantId}`,
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
    const response = await fetch("/api.php?action=link_parent_to_participant", {
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
    const response = await fetch("/api.php?action=save_parent", {
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

export async function saveFormSubmission(formType, participantId, submissionData) {
  try {
    const response = await fetch("/api.php?action=save_form_submission", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        form_type: formType,
        participant_id: participantId,
        submission_data: submissionData,
      }),
    });
    return await response.json();
  } catch (error) {
    console.error("Error saving form submission:", error);
    throw error;
  }
}

export async function fetchParticipants() {
  try {
    const response = await fetch("/api.php?action=get_parent_dashboard_data", {
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
    const response = await fetch("/api.php?action=update_points", {
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
  try {
    const response = await fetch("/api.php?action=update_participant_group", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({
        participant_id: participantId,
        group_id: groupId,
        is_leader: isLeader,
        is_second_leader: isSecondLeader
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return handleResponse(response);
  } catch (error) {
    console.error("Error updating participant group:", error);
    throw error;
  }
}

export async function getParticipantsWithUsers() {
  try {
    const response = await fetch(
      "/api.php?action=get_participants_with_users",
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
    const response = await fetch("/api.php?action=get_parent_users", {
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

export async function deleteParticipant(participantId) {
  try {
    const response = await fetch("/api.php?action=delete_participant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
        'X-Organization-ID': getCurrentOrganizationId()
      },
      body: JSON.stringify({ participant_id: participantId }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error deleting participant:", error);
    throw error;
  }
}

export async function associateUser(participantId, userId) {
  try {
    const response = await fetch("/api.php?action=associate_user", {
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
    const response = await fetch("/api.php?action=add_group", {
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
  try {
    const response = await fetch("/api.php?action=get_attendance_dates", {
      headers: getAuthHeader(),
    });
    const data = await response.json();
    if (data.success) {
      return data.dates;
    } else {
      throw new Error(data.message || "Failed to fetch attendance dates");
    }
  } catch (error) {
    console.error("Error fetching attendance dates:", error);
    throw error;
  }
}

export async function getAvailableDates() {
  try {
    const response = await fetch("/api.php?action=getAvailableDates", {
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
    const response = await fetch("/api.php?action=remove_group", {
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
    const response = await fetch("/api.php?action=update_group_name", {
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

export async function getParticipantsWithDocuments() {
  try {
    // Fetch participant documents
    const response = await fetch('/api.php?action=get_participants_with_documents', {
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


export async function getOrganizationFormFormats() {
  try {
    const response = await fetch('/api.php?action=get_organization_form_formats', {
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
    const response = await fetch(`/api.php?action=get_form_submission&participant_id=${participantId}&form_type=${formType}`, {
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
  try {
    const response = await fetch("/api.php?action=get_parent_contact_list", {
      headers: getAuthHeader(),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
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
      addCacheBuster("/api.php?action=get_pending_badges"),
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
    const response = await fetch("/api.php?action=update_badge_status", {
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
      `/api.php?action=get_parents_guardians&participant_id=${participantId}`,
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
    const response = await fetch("/api.php?action=save_fiche_sante", {
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
      `/api.php?action=get_acceptation_risque&participant_id=${participantId}`,
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
    const response = await fetch("/api.php?action=remove_guardians", {
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
    const response = await fetch("/api.php?action=save_acceptation_risque", {
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
    const response = await fetch(
      `api.php?action=get_current_stars&participant_id=${participantId}&territoire=${encodeURIComponent(
        territoire
      )}`,
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
  // Check if the organization ID is stored in local storage
  const organizationId = localStorage.getItem('currentOrganizationId');

  // If not found, set it to the default ID of 1
  if (!organizationId) {
    localStorage.setItem('currentOrganizationId', '1');
    return '1';
  }

  return organizationId;
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
            await updateAttendance(item.data.nameId, item.data.newStatus, item.data.date, item.data.previousStatus);
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
