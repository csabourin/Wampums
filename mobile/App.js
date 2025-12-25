/**
 * Wampums React Native App
 *
 * Root component that initializes the app and manages authentication state
 */

import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { initI18n } from './src/i18n';
import StorageUtils from './src/utils/StorageUtils';
import CONFIG from './src/config';
import { LoginScreen, DashboardScreen } from './src/screens';
import { LoadingSpinner } from './src/components';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize i18n system
      await initI18n();

      // Check if user is already authenticated
      const token = await StorageUtils.getJWT();
      if (token && !StorageUtils.isJWTExpired(token)) {
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error initializing app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await StorageUtils.clearUserData();
    setIsAuthenticated(false);
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      {isAuthenticated ? (
        <DashboardScreen navigation={{ replace: handleLogout }} />
      ) : (
        <LoginScreen navigation={{ replace: handleLoginSuccess }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
});
