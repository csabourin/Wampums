/**
 * Root Navigator
 *
 * Top-level navigator that switches between auth and app navigators
 * based on authentication state
 */

import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import StorageUtils from '../utils/StorageUtils';
import CONFIG from '../config';
import { LoadingSpinner } from '../components';

const Stack = createStackNavigator();

const RootNavigator = () => {
  console.log('🔵 [RootNavigator] Component rendering');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userPermissions, setUserPermissions] = useState([]);

  useEffect(() => {
    console.log('🔵 [RootNavigator] useEffect - calling checkAuthState');
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      console.log('🔵 [RootNavigator] checkAuthState - starting');
      // Check if user is authenticated
      const token = await StorageUtils.getJWT();
      console.log('🔵 [RootNavigator] JWT token:', token ? 'exists' : 'null');

      if (token && !StorageUtils.isJWTExpired(token)) {
        // Load user data
        const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);

        setUserPermissions(permissions || []);
        setIsAuthenticated(true);
      } else {
        console.log('🔵 [RootNavigator] No valid token, user not authenticated');
      }
    } catch (error) {
      console.error('🔴 [RootNavigator] Error checking auth state:', error);
    } finally {
      console.log('🔵 [RootNavigator] Setting isLoading to false');
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    console.log('🔵 [RootNavigator] handleLogin called');
    // Reload user data after login
    setIsLoading(true);
    await checkAuthState();
    console.log('🔵 [RootNavigator] handleLogin complete, authentication state updated');
  };

  const handleLogout = async () => {
    console.log('🔵 [RootNavigator] handleLogout called');
    await StorageUtils.clearUserData();
    setIsAuthenticated(false);
    setUserPermissions([]);
  };

  if (isLoading) {
    console.log('🟡 [RootNavigator] Still loading, showing LoadingSpinner');
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  console.log('🔵 [RootNavigator] Rendering navigation, isAuthenticated:', isAuthenticated);

  try {
    console.log('🔵 [RootNavigator] Creating SafeAreaProvider');
    return (
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {isAuthenticated ? (
              <Stack.Screen name="App">
                {() => {
                  console.log('🔵 [RootNavigator] Rendering AppNavigator');
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
                  console.log('🔵 [RootNavigator] Rendering AuthNavigator');
                  return <AuthNavigator onLogin={handleLogin} />;
                }}
              </Stack.Screen>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  } catch (error) {
    console.error('🔴 [RootNavigator] Error during render:', error);
    console.error('🔴 [RootNavigator] Error stack:', error.stack);
    throw error;
  }
};

export default RootNavigator;
