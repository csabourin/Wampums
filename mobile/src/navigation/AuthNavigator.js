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
  console.log('🟣 [AuthNavigator] Rendering');
  try {
    console.log('🟣 [AuthNavigator] Creating Stack.Navigator');
    return (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#f5f5f5' },
        }}
      >
        {console.log('🟣 [AuthNavigator] Adding LoginScreen to stack')}
        <Stack.Screen name="Login" component={LoginScreen} />
        {/* Future auth screens */}
        {/* <Stack.Screen name="Register" component={RegisterScreen} /> */}
        {/* <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} /> */}
      </Stack.Navigator>
    );
  } catch (error) {
    console.error('🔴 [AuthNavigator] Error during render:', error);
    console.error('🔴 [AuthNavigator] Error stack:', error.stack);
    throw error;
  }
};

export default AuthNavigator;
