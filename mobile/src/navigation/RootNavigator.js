/**
 * Root Navigator
 *
 * Top-level navigator that switches between auth and app navigators
 * based on authentication state
 * Handles deep linking for public features (e.g., permission slip signing)
 */

import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import PermissionSlipSignScreen from '../screens/PermissionSlipSignScreen';
import StorageUtils from '../utils/StorageUtils';
import CONFIG from '../config';
import { LoadingSpinner } from '../components';
import { debugLog, debugError } from '../utils/DebugUtils.js';
import { translate as t } from '../i18n';
import {
  clearOrganizationCustomization,
  initializeOrganizationCustomization,
} from '../utils/OrganizationCustomizationUtils';

const Stack = createStackNavigator();

// Deep linking configuration
const linking = {
  prefixes: [
    'wampums://', // Custom scheme
    'https://wampums.com', // Production web URL
    'https://*.wampums.com', // Subdomains
  ],
  config: {
    screens: {
      PublicPermissionSlipSign: {
        path: 'permission-slip/:token',
        parse: {
          token: (token) => token,
        },
      },
      App: {
        screens: {
          PermissionSlipSign: 'app/permission-slip-sign/:slipId?',
        },
      },
      Auth: {
        screens: {
          Login: 'login',
        },
      },
    },
  },
};

const RootNavigator = () => {
  debugLog('🔵 [RootNavigator] Component rendering');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userPermissions, setUserPermissions] = useState([]);

  useEffect(() => {
    debugLog('🔵 [RootNavigator] useEffect - calling checkAuthState');
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    clearOrganizationCustomization();
    try {
      debugLog('🔵 [RootNavigator] checkAuthState - starting');
      // Check if user is authenticated
      const token = await StorageUtils.getJWT();
      debugLog('🔵 [RootNavigator] JWT token:', token ? 'exists' : 'null');

      if (token && !StorageUtils.isJWTExpired(token)) {
        await initializeOrganizationCustomization();
        // Load user data
        const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);

        setUserPermissions(permissions || []);
        setIsAuthenticated(true);
      } else {
        debugLog('🔵 [RootNavigator] No valid token, user not authenticated');
      }
    } catch (error) {
      debugError('🔴 [RootNavigator] Error checking auth state:', error);
    } finally {
      debugLog('🔵 [RootNavigator] Setting isLoading to false');
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    debugLog('🔵 [RootNavigator] handleLogin called');
    // Reload user data after login
    setIsLoading(true);
    await checkAuthState();
    debugLog('🔵 [RootNavigator] handleLogin complete, authentication state updated');
  };

  const handleLogout = async () => {
    debugLog('🔵 [RootNavigator] handleLogout called');
    clearOrganizationCustomization();
    await StorageUtils.clearUserData();
    setIsAuthenticated(false);
    setUserPermissions([]);
  };

  if (isLoading) {
    debugLog('🟡 [RootNavigator] Still loading, showing LoadingSpinner');
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  debugLog('🔵 [RootNavigator] Rendering navigation, isAuthenticated:', isAuthenticated);

  try {
    debugLog('🔵 [RootNavigator] Creating SafeAreaProvider');
    return (
      <SafeAreaProvider>
        <NavigationContainer linking={linking} fallback={<LoadingSpinner message="Loading..." />}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {/* Public screens accessible without authentication */}
            <Stack.Screen
              name="PublicPermissionSlipSign"
              component={PermissionSlipSignScreen}
              options={{
                headerShown: true,
                title: t('sign_permission_slip'),
              }}
            />

            {/* Auth-dependent screens */}
            {isAuthenticated ? (
              <Stack.Screen name="App">
                {() => {
                  debugLog('🔵 [RootNavigator] Rendering AppNavigator');
                  return (
                    <AppNavigator
                      userPermissions={userPermissions}
                      onLogout={handleLogout}
                    />
                  );
                }}
              </Stack.Screen>
            ) : (
              <Stack.Screen name="Auth">
                {() => {
                  debugLog('🔵 [RootNavigator] Rendering AuthNavigator');
                  return <AuthNavigator onLogin={handleLogin} />;
                }}
              </Stack.Screen>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  } catch (error) {
    debugError('🔴 [RootNavigator] Error during render:', error);
    debugError('🔴 [RootNavigator] Error stack:', error.stack);
    throw error;
  }
};

export default RootNavigator;
