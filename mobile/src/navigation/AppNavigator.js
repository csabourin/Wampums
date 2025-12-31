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

const Stack = createStackNavigator();

const AppNavigator = ({ userPermissions }) => {
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
          title: 'Parent Dashboard',
        }}
      />

      {/* Registration Form - Parent can register children */}
      <Stack.Screen
        name="RegistrationForm"
        component={RegistrationFormScreen}
        options={{
          headerShown: true,
          title: 'Register Participant',
        }}
      />

      {/* Core Screens - Accessible from Dashboard */}
      <Stack.Screen
        name="Participants"
        component={ParticipantsScreen}
        options={{
          headerShown: true,
          title: 'Participants',
        }}
      />

      <Stack.Screen
        name="Activities"
        component={ActivitiesScreen}
        options={{
          headerShown: true,
          title: 'Activities',
        }}
      />

      <Stack.Screen
        name="ActivityDetail"
        component={ActivityDetailScreen}
        options={{
          headerShown: true,
          title: 'Activity Details',
        }}
      />

      <Stack.Screen
        name="Carpool"
        component={CarpoolScreen}
        options={{
          headerShown: true,
          title: 'Carpool',
        }}
      />

      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          title: 'Settings',
        }}
      />

      <Stack.Screen
        name="AccountInfo"
        component={AccountInfoScreen}
        options={{
          headerShown: true,
          title: 'Account Settings',
        }}
      />

      {/* Detail screens */}
      <Stack.Screen
        name="ParticipantDetail"
        component={ParticipantDetailScreen}
        options={{
          headerShown: true,
          title: 'Participant Details',
        }}
      />

      <Stack.Screen
        name="ManagePoints"
        component={ManagePointsScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="MeetingPreparation"
        component={MeetingPreparationScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="NextMeeting"
        component={NextMeetingScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="Honors"
        component={HonorsScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="Medication"
        component={MedicationScreen}
        options={{
          headerShown: true,
        }}
      />

      <Stack.Screen
        name="MedicationPlanning"
        component={MedicationPlanningScreen}
        options={{
          headerShown: true,
          title: 'Medication Planning',
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
          title: 'Administration',
        }}
      />

      <Stack.Screen
        name="ApproveBadges"
        component={ApproveBadgesScreen}
        options={{
          headerShown: true,
          title: 'Approve Badges',
        }}
      />

      <Stack.Screen
        name="BadgeDashboard"
        component={BadgeDashboardScreen}
        options={{
          headerShown: true,
          title: 'Badge Dashboard',
        }}
      />

      <Stack.Screen
        name="BadgeForm"
        component={BadgeFormScreen}
        options={{
          headerShown: true,
          title: 'Badge Form',
        }}
      />

      <Stack.Screen
        name="Finance"
        component={FinanceScreen}
        options={{
          headerShown: true,
          title: 'Finance',
        }}
      />

      <Stack.Screen
        name="ParentFinance"
        component={ParentFinanceScreen}
        options={{
          headerShown: true,
          title: 'My Finances',
        }}
      />

      <Stack.Screen
        name="FormPermissions"
        component={FormPermissionsScreen}
        options={{
          headerShown: true,
          title: 'Form Permissions',
        }}
      />

      <Stack.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          headerShown: true,
          title: 'Manage Groups',
        }}
      />

      <Stack.Screen
        name="HealthForm"
        component={HealthFormScreen}
        options={{
          headerShown: true,
          title: 'Health Form',
        }}
      />

      <Stack.Screen
        name="ParentContactList"
        component={ParentContactListScreen}
        options={{
          headerShown: true,
          title: 'Parent Contact List',
        }}
      />

      <Stack.Screen
        name="ParticipantDocuments"
        component={ParticipantDocumentsScreen}
        options={{
          headerShown: true,
          title: 'Participant Documents',
        }}
      />

      <Stack.Screen
        name="PermissionSlips"
        component={PermissionSlipsScreen}
        options={{
          headerShown: true,
          title: 'Permission Slips',
        }}
      />

      <Stack.Screen
        name="PermissionSlipSign"
        component={PermissionSlipSignScreen}
        options={{
          headerShown: true,
          title: 'Sign Permission Slip',
        }}
      />

      <Stack.Screen
        name="RiskAcceptance"
        component={RiskAcceptanceScreen}
        options={{
          headerShown: true,
          title: 'Risk Acceptance Form',
        }}
      />

      <Stack.Screen
        name="RoleManagement"
        component={RoleManagementScreen}
        options={{
          headerShown: true,
          title: 'Role Management',
        }}
      />

      <Stack.Screen
        name="UserParticipantLink"
        component={UserParticipantLinkScreen}
        options={{
          headerShown: true,
          title: 'Link Users & Participants',
        }}
      />

      {/* Finance Screens */}
      <Stack.Screen
        name="Budgets"
        component={BudgetsScreen}
        options={{
          headerShown: true,
          title: 'Budgets',
        }}
      />

      <Stack.Screen
        name="Expenses"
        component={ExpensesScreen}
        options={{
          headerShown: true,
          title: 'Expenses',
        }}
      />

      <Stack.Screen
        name="ExternalRevenue"
        component={ExternalRevenueScreen}
        options={{
          headerShown: true,
          title: 'External Revenue',
        }}
      />

      <Stack.Screen
        name="RevenueDashboard"
        component={RevenueDashboardScreen}
        options={{
          headerShown: true,
          title: 'Revenue Dashboard',
        }}
      />

      {/* Inventory & Resources Screens */}
      <Stack.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{
          headerShown: true,
          title: 'Inventory',
        }}
      />

      <Stack.Screen
        name="MaterialManagement"
        component={MaterialManagementScreen}
        options={{
          headerShown: true,
          title: 'Material Management',
        }}
      />

      <Stack.Screen
        name="ResourceDashboard"
        component={ResourceDashboardScreen}
        options={{
          headerShown: true,
          title: 'Resource Dashboard',
        }}
      />

      {/* Reports Screens */}
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{
          headerShown: true,
          title: 'Reports',
        }}
      />

      <Stack.Screen
        name="ReportViewer"
        component={ReportViewerScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params?.reportTitle || 'Report',
        })}
      />

      <Stack.Screen
        name="TimeSinceRegistration"
        component={TimeSinceRegistrationScreen}
        options={{
          headerShown: true,
          title: 'Time Since Registration',
        }}
      />

      <Stack.Screen
        name="GroupParticipantReport"
        component={GroupParticipantReportScreen}
        options={{
          headerShown: true,
          title: 'Group Participant Report',
        }}
      />

      {/* Other Screens */}
      <Stack.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          headerShown: true,
          title: 'Calendar',
        }}
      />

      <Stack.Screen
        name="Fundraisers"
        component={FundraisersScreen}
        options={{
          headerShown: true,
          title: 'Fundraisers',
        }}
      />

      <Stack.Screen
        name="MailingList"
        component={MailingListScreen}
        options={{
          headerShown: true,
          title: 'Mailing List',
        }}
      />

      {/* Auth & Organization Screens */}
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          headerShown: true,
          title: 'Register',
        }}
      />

      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{
          headerShown: true,
          title: 'Reset Password',
        }}
      />

      <Stack.Screen
        name="RegisterOrganization"
        component={RegisterOrganizationScreen}
        options={{
          headerShown: true,
          title: 'Join Organization',
        }}
      />

      <Stack.Screen
        name="CreateOrganization"
        component={CreateOrganizationScreen}
        options={{
          headerShown: true,
          title: 'Create Organization',
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
