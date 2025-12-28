/**
 * App Navigator
 *
 * Main app stack navigator - handles deep linking and modal screens
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import MainTabNavigator from './MainTabNavigator';

// Import modal/detail screens
import {
  ParticipantDetailScreen,
  ManagePointsScreen,
  AttendanceScreen,
  MeetingPreparationScreen,
  NextMeetingScreen,
  HonorsScreen,
  MedicationScreen,
} from '../screens';

// Import medication screens
import MedicationPlanningScreen from '../screens/MedicationPlanningScreen';
import MedicationDistributionScreen from '../screens/MedicationDistributionScreen';

// Import admin and management screens
import AdminScreen from '../screens/AdminScreen';
import ApproveBadgesScreen from '../screens/ApproveBadgesScreen';
import BadgeDashboardScreen from '../screens/BadgeDashboardScreen';
import BadgeFormScreen from '../screens/BadgeFormScreen';
import FinanceScreen from '../screens/FinanceScreen';
import FormPermissionsScreen from '../screens/FormPermissionsScreen';
import GroupsScreen from '../screens/GroupsScreen';
import HealthFormScreen from '../screens/HealthFormScreen';
import ParentContactListScreen from '../screens/ParentContactListScreen';
import ParticipantDocumentsScreen from '../screens/ParticipantDocumentsScreen';
import PermissionSlipsScreen from '../screens/PermissionSlipsScreen';
import PermissionSlipSignScreen from '../screens/PermissionSlipSignScreen';
import RiskAcceptanceScreen from '../screens/RiskAcceptanceScreen';
import RoleManagementScreen from '../screens/RoleManagementScreen';
import UserParticipantLinkScreen from '../screens/UserParticipantLinkScreen';

// Import future modal/detail screens
// import ActivityDetailScreen from '../screens/ActivityDetailScreen';
// import CarpoolScreen from '../screens/CarpoolScreen';
// import PermissionSlipScreen from '../screens/PermissionSlipScreen';

const Stack = createStackNavigator();

const AppNavigator = ({ userPermissions }) => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* Main tab navigation */}
      <Stack.Screen name="MainTabs">
        {() => <MainTabNavigator userPermissions={userPermissions} />}
      </Stack.Screen>

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
