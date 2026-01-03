/**
 * App Navigator
 *
 * Main app stack navigator - matches web SPA structure
 * Dashboard is the home screen, all other screens accessible via navigation
 * No tab navigation - pure stack navigation like web version
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';

// Import screens
import {
  DashboardScreen,
  ParticipantDetailScreen,
  ParticipantsScreen,
  ActivitiesScreen,
  ManagePointsScreen,
  AttendanceScreen,
  MeetingPreparationScreen,
  NextMeetingScreen,
  HonorsScreen,
  MedicationScreen,
  SettingsScreen,
  AccountInfoScreen,
  ParentDashboardScreen,
  CarpoolScreen,
  // Finance screens
  BudgetsScreen,
  ExpensesScreen,
  ExternalRevenueScreen,
  RevenueDashboardScreen,
  // Inventory & Resources
  InventoryScreen,
  MaterialManagementScreen,
  ResourceDashboardScreen,
  // Reports
  ReportsScreen,
  ReportViewerScreen,
  TimeSinceRegistrationScreen,
  GroupParticipantReportScreen,
  // Other screens
  CalendarScreen,
  FundraisersScreen,
  MailingListScreen,
  // Auth & Organization
  RegisterScreen,
  ResetPasswordScreen,
  RegisterOrganizationScreen,
  CreateOrganizationScreen,
} from '../screens';

// Import additional screens not in index
import ActivityDetailScreen from '../screens/ActivityDetailScreen';

// Import medication screens
import MedicationPlanningScreen from '../screens/MedicationPlanningScreen';
import MedicationDistributionScreen from '../screens/MedicationDistributionScreen';

// Import admin and management screens
import AdminScreen from '../screens/AdminScreen';
import ApproveBadgesScreen from '../screens/ApproveBadgesScreen';
import BadgeDashboardScreen from '../screens/BadgeDashboardScreen';
import BadgeFormScreen from '../screens/BadgeFormScreen';
import FinanceScreen from '../screens/FinanceScreen';
import ParentFinanceScreen from '../screens/ParentFinanceScreen';
import FormPermissionsScreen from '../screens/FormPermissionsScreen';
import GroupsScreen from '../screens/GroupsScreen';
import HealthFormScreen from '../screens/HealthFormScreen';
import ParentContactListScreen from '../screens/ParentContactListScreen';
import ParticipantDocumentsScreen from '../screens/ParticipantDocumentsScreen';
import PermissionSlipsScreen from '../screens/PermissionSlipsScreen';
import PermissionSlipSignScreen from '../screens/PermissionSlipSignScreen';
import RegistrationFormScreen from '../screens/RegistrationFormScreen';
import RiskAcceptanceScreen from '../screens/RiskAcceptanceScreen';
import RoleManagementScreen from '../screens/RoleManagementScreen';
import UserParticipantLinkScreen from '../screens/UserParticipantLinkScreen';
import { translate as t } from '../i18n';

const Stack = createStackNavigator();

const AppNavigator = ({ userPermissions, onLogout }) => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="Dashboard"
    >
      {/* Dashboard - Home screen (like web SPA) */}
      <Stack.Screen name="Dashboard" component={DashboardScreen} />

      {/* Parent Dashboard - Parent view */}
      <Stack.Screen
        name="ParentDashboard"
        component={ParentDashboardScreen}
        options={{
          headerShown: true,
          title: t('parent_dashboard'),
        }}
      />

      {/* Registration Form - Parent can register children */}
      <Stack.Screen
        name="RegistrationForm"
        component={RegistrationFormScreen}
        options={{
          headerShown: true,
          title: t('register_child'),
        }}
      />

      {/* Core Screens - Accessible from Dashboard */}
      <Stack.Screen
        name="Participants"
        component={ParticipantsScreen}
        options={{
          headerShown: true,
          title: t('manage_participants'),
        }}
      />

      <Stack.Screen
        name="Activities"
        component={ActivitiesScreen}
        options={{
          headerShown: true,
          title: t('activities_calendar'),
        }}
      />

      <Stack.Screen
        name="ActivityDetail"
        component={ActivityDetailScreen}
        options={{
          headerShown: true,
          title: t('activity_details'),
        }}
      />

      <Stack.Screen
        name="Carpool"
        component={CarpoolScreen}
        options={{
          headerShown: true,
          title: t('carpool_coordination'),
        }}
      />

      <Stack.Screen
        name="Settings"
        options={{
          headerShown: true,
          title: t('settings'),
        }}
      >
        {(props) => <SettingsScreen {...props} route={{ ...props.route, params: { ...props.route?.params, onLogout } }} />}
      </Stack.Screen>

      <Stack.Screen
        name="AccountInfo"
        component={AccountInfoScreen}
        options={{
          headerShown: true,
          title: t('account_info'),
        }}
      />

      {/* Detail screens */}
      <Stack.Screen
        name="ParticipantDetail"
        component={ParticipantDetailScreen}
        options={{
          headerShown: true,
          title: t('participant_details'),
        }}
      />

      <Stack.Screen
        name="ManagePoints"
        component={ManagePointsScreen}
        options={{
          headerShown: true,
          title: t('manage_points'),
        }}
      />

      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{
          headerShown: true,
          title: t('attendance'),
        }}
      />

      <Stack.Screen
        name="MeetingPreparation"
        component={MeetingPreparationScreen}
        options={{
          headerShown: true,
          title: t('preparation_reunions'),
        }}
      />

      <Stack.Screen
        name="NextMeeting"
        component={NextMeetingScreen}
        options={{
          headerShown: true,
          title: t('next_meeting'),
        }}
      />

      <Stack.Screen
        name="Honors"
        component={HonorsScreen}
        options={{
          headerShown: true,
          title: t('honors'),
        }}
      />

      <Stack.Screen
        name="Medication"
        component={MedicationScreen}
        options={{
          headerShown: true,
          title: t('medication_management_title'),
        }}
      />

      <Stack.Screen
        name="MedicationPlanning"
        component={MedicationPlanningScreen}
        options={{
          headerShown: true,
          title: t('medication_planning_title'),
        }}
      />

      <Stack.Screen
        name="MedicationDistribution"
        component={MedicationDistributionScreen}
        options={{
          headerShown: false,
        }}
      />

      {/* Admin and Management Screens */}
      <Stack.Screen
        name="Admin"
        component={AdminScreen}
        options={{
          headerShown: true,
          title: t('administration'),
        }}
      />

      <Stack.Screen
        name="ApproveBadges"
        component={ApproveBadgesScreen}
        options={{
          headerShown: true,
          title: t('approve_badges'),
        }}
      />

      <Stack.Screen
        name="BadgeDashboard"
        component={BadgeDashboardScreen}
        options={{
          headerShown: true,
          title: t('badge_dashboard_title'),
        }}
      />

      <Stack.Screen
        name="BadgeForm"
        component={BadgeFormScreen}
        options={{
          headerShown: true,
          title: t('badge_progress_form'),
        }}
      />

      <Stack.Screen
        name="Finance"
        component={FinanceScreen}
        options={{
          headerShown: true,
          title: t('finance'),
        }}
      />

      <Stack.Screen
        name="ParentFinance"
        component={ParentFinanceScreen}
        options={{
          headerShown: true,
          title: t('my_finances'),
        }}
      />

      <Stack.Screen
        name="FormPermissions"
        component={FormPermissionsScreen}
        options={{
          headerShown: true,
          title: t('form_permissions_title'),
        }}
      />

      <Stack.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          headerShown: true,
          title: t('manage_groups'),
        }}
      />

      <Stack.Screen
        name="HealthForm"
        component={HealthFormScreen}
        options={{
          headerShown: true,
          title: t('health_information'),
        }}
      />

      <Stack.Screen
        name="ParentContactList"
        component={ParentContactListScreen}
        options={{
          headerShown: true,
          title: t('parent_contact_list'),
        }}
      />

      <Stack.Screen
        name="ParticipantDocuments"
        component={ParticipantDocumentsScreen}
        options={{
          headerShown: true,
          title: t('participant_documents_title'),
        }}
      />

      <Stack.Screen
        name="PermissionSlips"
        component={PermissionSlipsScreen}
        options={{
          headerShown: true,
          title: t('permission_slip_dashboard_title'),
        }}
      />

      <Stack.Screen
        name="PermissionSlipSign"
        component={PermissionSlipSignScreen}
        options={{
          headerShown: true,
          title: t('sign_permission_slip'),
        }}
      />

      <Stack.Screen
        name="RiskAcceptance"
        component={RiskAcceptanceScreen}
        options={{
          headerShown: true,
          title: t('formulaire_acceptation_risque'),
        }}
      />

      <Stack.Screen
        name="RoleManagement"
        component={RoleManagementScreen}
        options={{
          headerShown: true,
          title: t('role_management'),
        }}
      />

      <Stack.Screen
        name="UserParticipantLink"
        component={UserParticipantLinkScreen}
        options={{
          headerShown: true,
          title: t('manage_users_participants'),
        }}
      />

      {/* Finance Screens */}
      <Stack.Screen
        name="Budgets"
        component={BudgetsScreen}
        options={{
          headerShown: true,
          title: t('budget_management'),
        }}
      />

      <Stack.Screen
        name="Expenses"
        component={ExpensesScreen}
        options={{
          headerShown: true,
          title: t('expenses'),
        }}
      />

      <Stack.Screen
        name="ExternalRevenue"
        component={ExternalRevenueScreen}
        options={{
          headerShown: true,
          title: t('external_revenue'),
        }}
      />

      <Stack.Screen
        name="RevenueDashboard"
        component={RevenueDashboardScreen}
        options={{
          headerShown: true,
          title: t('revenue_dashboard'),
        }}
      />

      {/* Inventory & Resources Screens */}
      <Stack.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{
          headerShown: true,
          title: t('inventory_link'),
        }}
      />

      <Stack.Screen
        name="MaterialManagement"
        component={MaterialManagementScreen}
        options={{
          headerShown: true,
          title: t('material_management_title'),
        }}
      />

      <Stack.Screen
        name="ResourceDashboard"
        component={ResourceDashboardScreen}
        options={{
          headerShown: true,
          title: t('resource_dashboard_title'),
        }}
      />

      {/* Reports Screens */}
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{
          headerShown: true,
          title: t('reports_title'),
        }}
      />

      <Stack.Screen
        name="ReportViewer"
        component={ReportViewerScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params?.reportTitle || t('report'),
        })}
      />

      <Stack.Screen
        name="TimeSinceRegistration"
        component={TimeSinceRegistrationScreen}
        options={{
          headerShown: true,
          title: t('time_since_registration_report'),
        }}
      />

      <Stack.Screen
        name="GroupParticipantReport"
        component={GroupParticipantReportScreen}
        options={{
          headerShown: true,
          title: t('den_list_report'),
        }}
      />

      {/* Other Screens */}
      <Stack.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          headerShown: true,
          title: t('activities_calendar'),
        }}
      />

      <Stack.Screen
        name="Fundraisers"
        component={FundraisersScreen}
        options={{
          headerShown: true,
          title: t('fundraisers'),
        }}
      />

      <Stack.Screen
        name="MailingList"
        component={MailingListScreen}
        options={{
          headerShown: true,
          title: t('mailing_list'),
        }}
      />

      {/* Auth & Organization Screens */}
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          headerShown: true,
          title: t('register'),
        }}
      />

      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{
          headerShown: true,
          title: t('reset_password'),
        }}
      />

      <Stack.Screen
        name="RegisterOrganization"
        component={RegisterOrganizationScreen}
        options={{
          headerShown: true,
          title: t('register_for_organization'),
        }}
      />

      <Stack.Screen
        name="CreateOrganization"
        component={CreateOrganizationScreen}
        options={{
          headerShown: true,
          title: t('create_organization'),
        }}
      />

      {/* Future modal/detail screens */}
      {/* <Stack.Screen
        name="ActivityDetail"
        component={ActivityDetailScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
        }}
      /> */}
    </Stack.Navigator>
  );
};

export default AppNavigator;
