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

// Import future modal/detail screens
// import ActivityDetailScreen from '../screens/ActivityDetailScreen';
// import CarpoolScreen from '../screens/CarpoolScreen';
// import PermissionSlipScreen from '../screens/PermissionSlipScreen';

const Stack = createStackNavigator();

const AppNavigator = ({ userRole, userPermissions }) => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* Main tab navigation */}
      <Stack.Screen name="MainTabs">
        {() => <MainTabNavigator userRole={userRole} userPermissions={userPermissions} />}
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
