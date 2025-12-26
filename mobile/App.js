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
    console.error('🔴 ErrorBoundary caught error:', error);
    console.error('🔴 Error info:', errorInfo);
    console.error('🔴 Error stack:', error.stack);
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
      console.log('🟢 [App] Starting initialization');
      // Initialize i18n system (loads translations and sets locale)
      await initI18n();
      console.log('🟢 [App] i18n initialized successfully');
    } catch (error) {
      console.error('🔴 [App] Error initializing app:', error);
      console.error('🔴 [App] Error stack:', error.stack);
    } finally {
      console.log('🟢 [App] Setting isLoading to false');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    console.log('🟡 [App] Rendering LoadingSpinner');
    return <LoadingSpinner message="Loading Wampums..." />;
  }

  console.log('🟢 [App] Rendering main app with RootNavigator');
  return (
    <ErrorBoundary>
      <StatusBar style="auto" />
      <RootNavigator />
    </ErrorBoundary>
  );
}
