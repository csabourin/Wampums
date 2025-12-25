/**
 * Root Navigator
 *
 * Top-level navigator that switches between auth and app navigators
 * based on authentication state
 */

import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import StorageUtils from '../utils/StorageUtils';
import CONFIG from '../config';
import { LoadingSpinner } from '../components';

const Stack = createStackNavigator();

const RootNavigator = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [userPermissions, setUserPermissions] = useState([]);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      // Check if user is authenticated
      const token = await StorageUtils.getJWT();

      if (token && !StorageUtils.isJWTExpired(token)) {
        // Load user data
        const role = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);
        const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);

        setUserRole(role);
        setUserPermissions(permissions || []);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    // Reload user data after login
    await checkAuthState();
  };

  const handleLogout = async () => {
    await StorageUtils.clearUserData();
    setIsAuthenticated(false);
    setUserRole(null);
    setUserPermissions([]);
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="App">
            {() => (
              <AppNavigator
                userRole={userRole}
                userPermissions={userPermissions}
                onLogout={handleLogout}
              />
            )}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthNavigator onLogin={handleLogin} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;
