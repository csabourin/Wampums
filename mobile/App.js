/**
 * Wampums React Native App
 *
 * Root component that initializes the app and navigation
 */

import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { initI18n } from './src/i18n';
import { RootNavigator } from './src/navigation';
import { LoadingSpinner } from './src/components';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize i18n system (loads translations and sets locale)
      await initI18n();
    } catch (error) {
      console.error('Error initializing app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  return (
    <>
      <StatusBar style="auto" />
      <RootNavigator />
    </>
  );
}
