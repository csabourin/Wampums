render() {
  const adminLink = this.app.userRole === "admin" ?
    `<a href="/admin" id="admin-link" aria-label="${translate("administration")}">
        <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
        <span>${translate("administration")}</span>
     </a>` : ``;

  const content = `
    <h1>${translate("dashboard_title")}</h1>
    <h2>${this.organizationName}</h2>

    <div class="logo-container">
      <img
        class="logo"
        src="${this.organizationLogo}"
        width="335"
        height="366"
        alt="Logo"
        loading="eager"
        decoding="async"
      >
    </div>

    <!-- === DAY-TO-DAY SECTION WITH ICONS === -->
    <section class="dashboard-section">
      <h3>${translate("dashboard_day_to_day_section")}</h3>
      <div class="manage-items">

        <a href="/approve-badges" aria-label="${translate("approve_badges")}">
          <i class="fa-solid fa-certificate"></i>
          <span>${translate("approve_badges")}</span>
        </a>

        <a href="/badge-dashboard" aria-label="${translate("badge_dashboard_link")}">
          <i class="fa-solid fa-chart-bar"></i>
          <span>${translate("badge_dashboard_link")}</span>
        </a>

        <a href="/fundraisers" aria-label="${translate("fundraisers")}">
          <i class="fa-solid fa-hand-holding-heart"></i>
          <span>${translate("fundraisers")}</span>
        </a>

        <a href="/parent-contact-list" aria-label="${translate("parent_contact_list")}">
          <i class="fa-solid fa-address-book"></i>
          <span>${translate("parent_contact_list")}</span>
        </a>

        <a href="/managePoints" aria-label="${translate("manage_points")}">
          <i class="fa-solid fa-coins"></i>
          <span>${translate("manage_points")}</span>
        </a>

        <a href="/manageHonors" aria-label="${translate("manage_honors")}">
          <i class="fa-solid fa-award"></i>
          <span>${translate("manage_honors")}</span>
        </a>

        <a href="/attendance" aria-label="${translate("attendance")}">
          <i class="fa-solid fa-clipboard-check"></i>
          <span>${translate("attendance")}</span>
        </a>

        <a href="/upcoming-meeting" aria-label="${translate("upcoming_meeting")}">
          <i class="fa-solid fa-calendar-day"></i>
          <span>${translate("upcoming_meeting")}</span>
        </a>

        <a href="/parent-dashboard" aria-label="${translate("vue_parents")}">
          <i class="fa-solid fa-users"></i>
          <span>${translate("vue_parents")}</span>
        </a>

      </div>
    </section>

    <!-- === PREPARATION SECTION WITH ICONS === -->
    <section class="dashboard-section">
      <h3>${translate("dashboard_preparation_section")}</h3>
      <div class="manage-items">

        <a href="/preparation-reunions" aria-label="${translate("preparation_reunions")}">
          <i class="fa-solid fa-clipboard-list"></i>
          <span>${translate("preparation_reunions")}</span>
        </a>

        <a href="/view-participant-documents" aria-label="${translate("view_participant_documents")}">
          <i class="fa-solid fa-file-lines"></i>
          <span>${translate("view_participant_documents")}</span>
        </a>

      </div>
    </section>

    <!-- === ADMIN SECTION WITH ICONS === -->
    <section class="dashboard-section">
      <h3>${translate("dashboard_admin_section")}</h3>
      <div class="manage-items">

        <a href="/manage-participants" aria-label="${translate("manage_names")}">
          <i class="fa-solid fa-id-card"></i>
          <span>${translate("manage_names")}</span>
        </a>

        <a href="/manage-groups" aria-label="${translate("manage_groups")}">
          <i class="fa-solid fa-people-group"></i>
          <span>${translate("manage_groups")}</span>
        </a>

        <a href="/manage-users-participants" aria-label="${translate("manage_participants")}">
          <i class="fa-solid fa-user-gear"></i>
          <span>${translate("manage_participants")}</span>
        </a>

        <a href="/mailing-list" aria-label="${translate("mailing_list")}">
          <i class="fa-solid fa-envelope-open-text"></i>
          <span>${translate("mailing_list")}</span>
        </a>

        <a href="/reports" aria-label="${translate("reports")}">
          <i class="fa-solid fa-chart-line"></i>
          <span>${translate("reports")}</span>
        </a>

        <a href="/group-participant-report" aria-label="${translate("feuille_participants")}">
          <i class="fa-solid fa-table-list"></i>
          <span>${translate("feuille_participants")}</span>
        </a>

        ${adminLink}

      </div>
    </section>

    <div id="points-list">
      <h3 style="text-align: center; margin: 1rem 0;">${translate("points")}</h3>
      ${this.renderPointsList()}
    </div>

    <p><a href="/logout" id="logout-link">${translate("logout")}</a></p>
  `;

  document.getElementById("app").innerHTML = content;
  this.updatePointsList();
}
