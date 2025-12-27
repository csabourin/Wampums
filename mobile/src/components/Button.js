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
import theme from '../theme';

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
          color={variant === 'primary' || variant === 'danger' || variant === 'success' ? theme.colors.surface : theme.colors.primary}
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
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  // Variants
  primary: {
    backgroundColor: theme.colors.primary,
  },
  secondary: {
    backgroundColor: theme.colors.secondary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  danger: {
    backgroundColor: theme.colors.error,
  },
  success: {
    backgroundColor: theme.colors.success,
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
    color: theme.colors.surface,
  },
  text_secondary: {
    color: theme.colors.primary,
  },
  text_danger: {
    color: theme.colors.surface,
  },
  text_success: {
    color: theme.colors.surface,
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
