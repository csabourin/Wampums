/**
 * App Navigator
 *
 * Main app stack navigator - handles deep linking and modal screens
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import MainTabNavigator from './MainTabNavigator';

// Import future modal/detail screens
// import ParticipantDetailScreen from '../screens/ParticipantDetailScreen';
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

      {/* Future modal/detail screens */}
      {/* <Stack.Screen
        name="ParticipantDetail"
        component={ParticipantDetailScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
        }}
      /> */}
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
