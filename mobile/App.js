/**
 * Wampums React Native App
 *
 * Root component that initializes the app and navigation
 */

import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';
import { initI18n } from './src/i18n';
import { RootNavigator } from './src/navigation';
import { LoadingSpinner } from './src/components';
import { logConfigValues } from './src/utils/DebugConfig';
import { debugLog, debugError } from './src/utils/DebugUtils';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Note: ErrorBoundary needs console.error for critical errors
    // eslint-disable-next-line no-console
    console.error('🔴 ErrorBoundary caught error:', error);
    // eslint-disable-next-line no-console
    console.error('🔴 Error info:', errorInfo);
    // eslint-disable-next-line no-console
    console.error('🔴 Error stack:', error.stack);
    // eslint-disable-next-line no-console
    console.error('🔴 Component stack:', errorInfo.componentStack);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 14, color: '#666', marginBottom: 10 }}>
            {this.state.error?.toString()}
          </Text>
          <Text style={{ fontSize: 12, color: '#999' }}>
            Check console for details
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      debugLog('[App] Starting initialization');

      // Debug: Log all CONFIG values to check for type issues
      logConfigValues();

      // Initialize i18n system (loads translations and sets locale)
      await initI18n();
      debugLog('[App] i18n initialized successfully');
    } catch (error) {
      debugError('[App] Error initializing app:', error);
      debugError('[App] Error stack:', error.stack);
    } finally {
      debugLog('[App] Setting isLoading to false');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    debugLog('[App] Rendering LoadingSpinner');
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  debugLog('[App] Rendering main app with RootNavigator');
  return (
    <ErrorBoundary>
      <StatusBar style="auto" />
      <RootNavigator />
    </ErrorBoundary>
  );
}
