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

export async function fetchParticipant(participantId) {
  try {
    const response = await fetch(
      `/api.php?action=get_participant&id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const data = await handleResponse(response);
    if (data.success) {
      return data.participant;
    } else {
      throw new Error(data.message || "Failed to fetch participant");
    }
  } catch (error) {
    console.error("Error fetching participant:", error);
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

export async function fetchFicheSante(participantId) {
  try {
    const response = await fetch(
      `/api.php?action=get_fiche_sante&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
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
    const response = await fetch("/api.php?action=save_participant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
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

export async function getParticipants() {
  try {
    const response = await fetch("/api.php?action=get_participants", {
      headers: getAuthHeader(),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching participants:", error);
    throw error;
  }
}

export async function getGroups() {
  try {
    const response = await fetch("/api.php?action=get_groups", {
      headers: getAuthHeader(),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching groups:", error);
    throw error;
  }
}

export async function getAttendance(date) {
  try {
    const response = await fetch(
      `/api.php?action=get_attendance&date=${date}`,
      { headers: getAuthHeader() }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching attendance:", error);
  }
}

export async function updateAttendance(nameId, newStatus, date, previousStatus) {
    try {
        const response = await fetch('/api.php?action=update_attendance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({
                name_id: nameId,
                status: newStatus,
                date: date,
                previous_status: previousStatus
            })
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error updating attendance:', error);
        throw error;
    }
}

export async function getHonors(date) {
  try {
    const response = await fetch(`/api.php?action=get_honors&date=${date}`, {
      headers: getAuthHeader(),
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
        ...getAuthHeader(), // Spread the result of getAuthHeader here
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

export async function getAttendanceReport(startDate, endDate) {
  try {
    const response = await fetch(
      `/api.php?action=get_attendance_report&start_date=${startDate}&end_date=${endDate}`
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching attendance report:", error);
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

    // Log the raw response text
    const responseText = await response.text();
    console.log("Raw response:", responseText);

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
    console.log("Fetching parents for participantId:", participantId);
    const response = await fetch(
      `/api.php?action=get_parents_guardians&participant_id=${participantId}`,
      {
        headers: getAuthHeader(),
      }
    );
    const textResponse = await response.text(); // Log the raw text response
    console.log("Raw response:", textResponse);
    const data = JSON.parse(textResponse); // Parse the response manually

    console.log("Parsed response:", data);

    if (data.success) {
      console.log("Returning parents/guardians:", data.parents_guardians);
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
    console.log("Sending Parent Data to API:", parentData);
    const response = await fetch("/api.php?action=save_parent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify(parentData),
    });
    const responseText = await response.text();
    console.log("Raw API Response:", responseText);
    const data = JSON.parse(responseText);
    console.log("Parsed API Response:", data);
    return data;
  } catch (error) {
    console.error("Error saving parent:", error);
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

export async function updateParticipantGroup(participantId, groupId) {
  try {
    const response = await fetch("/api.php?action=update_participant_group", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        participant_id: participantId,
        group_id: groupId,
      }),
    });
    const data = await response.json();
    return data;
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
        ...getAuthHeader(), // Added auth header here
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
    const response = await fetch(
      "/api.php?action=get_participants_with_documents",
      {
        headers: getAuthHeader(),
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching participants with documents:", error);
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
    console.log("Raw response:", textResponse);
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
    console.log("Fiche sante save response status:", response.status);
    const responseText = await response.text();
    console.log("Fiche sante save response text:", responseText);
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
