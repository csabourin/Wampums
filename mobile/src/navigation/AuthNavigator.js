/**
 * Auth Navigator
 *
 * Handles authentication-related screens:
 * 1. OrganizationSelect - Pre-login org URL selection
 * 2. Login - Username/password + 2FA
 * 3. Register - Future: Account creation
 * 4. ResetPassword - Future: Password recovery
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { LoginScreen, RegisterScreen, ResetPasswordScreen } from '../screens';
import OrganizationSelectScreen from '../screens/OrganizationSelectScreen';
import { debugLog, debugError } from '../utils/DebugUtils.js';

const Stack = createStackNavigator();

const AuthNavigator = ({ onLogin }) => {
  debugLog('🟣 [AuthNavigator] Rendering with onLogin callback');
  try {
    debugLog('🟣 [AuthNavigator] Creating Stack.Navigator');
    return (
      <Stack.Navigator
        initialRouteName="OrganizationSelect"
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#f5f5f5' },
        }}
      >
        {/* Step 1: Organization URL Selection (pre-login) */}
        <Stack.Screen
          name="OrganizationSelect"
          component={OrganizationSelectScreen}
        />

        {/* Step 2: Login (after organization is selected) */}
        <Stack.Screen name="Login">
          {(props) => <LoginScreen {...props} onLogin={onLogin} />}
        </Stack.Screen>

        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      </Stack.Navigator>
    );
  } catch (error) {
    debugError('🔴 [AuthNavigator] Error during render:', error);
    debugError('🔴 [AuthNavigator] Error stack:', error.stack);
    throw error;
  }
};

export default AuthNavigator;
