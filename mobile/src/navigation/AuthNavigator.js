/**
 * Auth Navigator
 *
 * Handles authentication-related screens (login, register, password reset)
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { LoginScreen } from '../screens';
// Import future auth screens
// import RegisterScreen from '../screens/RegisterScreen';
// import ResetPasswordScreen from '../screens/ResetPasswordScreen';

const Stack = createStackNavigator();

const AuthNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#f5f5f5' },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      {/* Future auth screens */}
      {/* <Stack.Screen name="Register" component={RegisterScreen} /> */}
      {/* <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} /> */}
    </Stack.Navigator>
  );
};

export default AuthNavigator;
