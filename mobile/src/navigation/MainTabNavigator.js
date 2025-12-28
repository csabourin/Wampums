/**
 * Main Tab Navigator
 *
 * Bottom tab navigation for authenticated users
 * Tabs shown depend on user role and permissions
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { 
  DashboardScreen, 
  SettingsScreen,
  ParticipantsScreen,
  ActivitiesScreen,
} from '../screens';
import FinanceScreen from '../screens/FinanceScreen';
import { translate as t } from '../i18n';
import { getDashboardType, hasAnyPermission } from '../utils/PermissionUtils';

const Tab = createBottomTabNavigator();

const MainTabNavigator = ({ userPermissions }) => {
  // Determine which tabs to show based on permissions
  const dashboardType = getDashboardType(userPermissions);
  const isParent = dashboardType === 'parent';
  const canViewFinance = hasAnyPermission(
    ['finance.view', 'finance.manage', 'finance.approve'],
    userPermissions
  );

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
          component={ParticipantsScreen}
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
          component={ActivitiesScreen}
          options={{
            title: t('Activities'),
            tabBarIcon: () => null,
          }}
        />
      )}

      {/* Finance - for admins */}
      {canViewFinance && (
        <Tab.Screen
          name="FinanceTab"
          component={FinanceScreen}
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
