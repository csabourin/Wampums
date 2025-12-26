/**
 * Main Tab Navigator
 *
 * Bottom tab navigation for authenticated users
 * Tabs shown depend on user role and permissions
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardScreen, SettingsScreen } from '../screens';
import { translate as t } from '../i18n';

// Import future screens
// import ParticipantsScreen from '../screens/ParticipantsScreen';
// import ActivitiesScreen from '../screens/ActivitiesScreen';
// import FinanceScreen from '../screens/FinanceScreen';

const Tab = createBottomTabNavigator();

const MainTabNavigator = ({ userRole, userPermissions }) => {
  // Determine which tabs to show based on role
  const isParent = userRole === 'parent';
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8E8E93',
        tabBarStyle: {
          borderTopColor: '#E5E5EA',
          borderTopWidth: 1,
          paddingBottom: 5,
          paddingTop: 5,
          height: 60,
        },
      }}
    >
      {/* Dashboard - available to all users */}
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: t('dashboard_title'),
          tabBarIcon: () => null, // Add icon when react-native-vector-icons is installed
        }}
      />

      {/* Participants - for admins and leaders */}
      {!isParent && (
        <Tab.Screen
          name="ParticipantsTab"
          component={DashboardScreen} // Placeholder - replace with ParticipantsScreen
          options={{
            title: t('participants'),
            tabBarIcon: () => null,
          }}
        />
      )}

      {/* Activities - for admins and leaders */}
      {!isParent && (
        <Tab.Screen
          name="ActivitiesTab"
          component={DashboardScreen} // Placeholder - replace with ActivitiesScreen
          options={{
            title: t('Activities'),
            tabBarIcon: () => null,
          }}
        />
      )}

      {/* Finance - for admins */}
      {isAdmin && (
        <Tab.Screen
          name="FinanceTab"
          component={DashboardScreen} // Placeholder - replace with FinanceScreen
          options={{
            title: t('finance'),
            tabBarIcon: () => null,
          }}
        />
      )}

      {/* Settings - available to all users */}
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: t('settings'),
          tabBarIcon: () => null,
        }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
