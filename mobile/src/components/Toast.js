import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, TouchableOpacity, StyleSheet } from 'react-native';
import theme from '../theme';

/**
 * Toast Component
 *
 * Temporary notification component that appears at the top of the screen.
 * Auto-dismisses after a specified duration and supports different types.
 *
 * @param {Object} props
 * @param {boolean} props.visible - Whether the toast is visible
 * @param {string} props.message - Toast message
 * @param {string} props.type - Toast type: 'info', 'success', 'warning', 'error' (default: 'info')
 * @param {number} props.duration - Auto-dismiss duration in ms (default: 3000)
 * @param {function} props.onDismiss - Dismiss handler
 * @param {Object} props.style - Additional custom styles
 */
const Toast = ({
  visible,
  message,
  type = 'info',
  duration = 3000,
  onDismiss,
  style,
}) => {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Slide in and fade in
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after duration
      const timer = setTimeout(() => {
        handleDismiss();
      }, duration);

      return () => clearTimeout(timer);
    } else {
      // Reset position when not visible
      translateY.setValue(-100);
      opacity.setValue(0);
    }
  }, [visible, duration]);

  const handleDismiss = () => {
    // Slide out and fade out
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (onDismiss) {
        onDismiss();
      }
    });
  };

  if (!visible && opacity._value === 0) {
    return null;
  }

  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return styles.toastSuccess;
      case 'warning':
        return styles.toastWarning;
      case 'error':
        return styles.toastError;
      default:
        return styles.toastInfo;
    }
  };

  const getToastTextStyle = () => {
    switch (type) {
      case 'success':
        return styles.toastTextSuccess;
      case 'warning':
        return styles.toastTextWarning;
      case 'error':
        return styles.toastTextError;
      default:
        return styles.toastTextInfo;
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        getToastStyle(),
        {
          transform: [{ translateY }],
          opacity,
        },
        style,
      ]}
    >
      <Text style={[styles.message, getToastTextStyle()]}>{message}</Text>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={handleDismiss}
        activeOpacity={0.7}
      >
        <Text style={[styles.closeButtonText, getToastTextStyle()]}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

/**
 * ToastProvider Hook
 *
 * Hook for managing toast state in screens.
 * Usage:
 *   const toast = useToast();
 *   toast.show('Message', 'success');
 */
export const useToast = () => {
  const [toastState, setToastState] = React.useState({
    visible: false,
    message: '',
    type: 'info',
  });

  const show = (message, type = 'info', duration = 3000) => {
    setToastState({ visible: true, message, type, duration });
  };

  const hide = () => {
    setToastState(prev => ({ ...prev, visible: false }));
  };

  return {
    toastState,
    show,
    hide,
  };
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    paddingTop: theme.spacing.xl,
    borderRadius: theme.borderRadius.md,
    margin: theme.spacing.md,
    zIndex: theme.zIndex.toast,
    ...theme.shadows.xl,
  },
  message: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * theme.lineHeight.normal,
  },
  closeButton: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
    minWidth: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 24,
    fontWeight: theme.fontWeight.bold,
  },
  toastInfo: {
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.info,
  },
  toastSuccess: {
    backgroundColor: '#d4edda',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.success,
  },
  toastWarning: {
    backgroundColor: '#fff3cd',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  toastError: {
    backgroundColor: '#f8d7da',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error,
  },
  toastTextInfo: {
    color: '#0c5460',
  },
  toastTextSuccess: {
    color: '#155724',
  },
  toastTextWarning: {
    color: '#856404',
  },
  toastTextError: {
    color: '#721c24',
  },
});

export default Toast;
