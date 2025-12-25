/**
 * Button Component
 *
 * Reusable button component with consistent styling
 * Ensures minimum touch target size for accessibility
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import CONFIG from '../config';

const Button = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'medium',
  style,
  textStyle,
}) => {
  const buttonStyles = [
    styles.button,
    styles[variant],
    styles[`size_${size}`],
    disabled && styles.disabled,
    style,
  ];

  const textStyles = [
    styles.text,
    styles[`text_${variant}`],
    styles[`text_${size}`],
    disabled && styles.textDisabled,
    textStyle,
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? '#fff' : '#007AFF'}
          size="small"
        />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  // Variants
  primary: {
    backgroundColor: '#007AFF',
  },
  secondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  danger: {
    backgroundColor: '#FF3B30',
  },
  success: {
    backgroundColor: '#34C759',
  },
  disabled: {
    opacity: 0.5,
  },
  // Sizes
  size_small: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  size_medium: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  size_large: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  // Text styles
  text: {
    fontWeight: '600',
  },
  text_primary: {
    color: '#fff',
  },
  text_secondary: {
    color: '#007AFF',
  },
  text_danger: {
    color: '#fff',
  },
  text_success: {
    color: '#fff',
  },
  text_small: {
    fontSize: 14,
  },
  text_medium: {
    fontSize: 16,
  },
  text_large: {
    fontSize: 18,
  },
  textDisabled: {
    opacity: 1,
  },
});

export default Button;
