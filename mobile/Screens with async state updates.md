=== Screens with async state updates without mount checks ===

⚠️  mobile/src/screens/AccountInfoScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ActivitiesScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ActivityDetailScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/AdminScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ApproveBadgesScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/AttendanceScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/BadgeDashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/BadgeFormScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/BudgetsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/CalendarScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/CreateOrganizationScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/DashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ExpensesScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ExternalRevenueScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/FinanceScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/FormPermissionsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/FundraisersScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/GroupParticipantReportScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/GroupsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/HealthFormScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/HonorsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/InventoryScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/LeaderDashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/LoginScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MailingListScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ManagePointsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MaterialManagementScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MedicationDistributionScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MedicationPlanningScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MedicationScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/MeetingPreparationScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/NextMeetingScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/OrganizationSelectScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParentContactListScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParentDashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParentFinanceScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParticipantDetailScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParticipantDocumentsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ParticipantsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/PermissionSlipSignScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/PermissionSlipsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RegisterOrganizationScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RegisterScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RegistrationFormScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ReportsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ReportViewerScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ResetPasswordScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/ResourceDashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RevenueDashboardScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RiskAcceptanceScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/RoleManagementScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/SettingsScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/TimeSinceRegistrationScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook

⚠️  mobile/src/screens/UserParticipantLinkScreen.js
   - Has useState and async operations
   - Missing useIsMounted hook


=== Screens with useFocusEffect and async operations ===

🔴 mobile/src/screens/ActivitiesScreen.js
   - Uses useFocusEffect with async operations
   - CRITICAL: Likely causes crashes on navigation

🔴 mobile/src/screens/LeaderDashboardScreen.js
   - Uses useFocusEffect with async operations
   - CRITICAL: Likely causes crashes on navigation

🔴 mobile/src/screens/ManagePointsScreen.js
   - Uses useFocusEffect with async operations
   - CRITICAL: Likely causes crashes on navigation

🔴 mobile/src/screens/ParticipantsScreen.js
   - Uses useFocusEffect with async operations
   - CRITICAL: Likely causes crashes on navigation


=== Components with Animated values without cleanup ===


=== Summary ===
Apply the useIsMounted fix to all files listed above.
See mobile/src/screens/CarpoolScreen.js for reference implementation.