import React from 'react';
import { View, Text, Modal as RNModal, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * Modal Component
 *
 * Reusable modal dialog component with header, body, and footer sections.
 * Provides consistent styling and animation across the app.
 *
 * @param {Object} props
 * @param {boolean} props.visible - Whether the modal is visible
 * @param {function} props.onClose - Close handler
 * @param {string} props.title - Modal title
 * @param {React.ReactNode} props.children - Modal body content
 * @param {React.ReactNode} props.footer - Optional footer content
 * @param {boolean} props.scrollable - Whether the body should be scrollable (default: true)
 * @param {Object} props.style - Additional custom styles
 */
const Modal = ({
  visible,
  onClose,
  title,
  children,
  footer,
  scrollable = true,
  style,
}) => {
  return (
    <RNModal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={commonStyles.modalOverlay}>
        <View style={[commonStyles.modalContainer, style]}>
          {/* Header */}
          <View style={commonStyles.modalHeader}>
            <Text style={commonStyles.modalTitle}>{title}</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View style={[commonStyles.modalBody, scrollable && styles.scrollableBody]}>
            {scrollable ? (
              <ScrollView showsVerticalScrollIndicator={true}>
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </View>

          {/* Footer */}
          {footer && (
            <View style={commonStyles.modalFooter}>{footer}</View>
          )}
        </View>
      </View>
    </RNModal>
  );
};

/**
 * ConfirmModal Component
 *
 * Pre-configured modal for confirmation dialogs.
 */
export const ConfirmModal = ({
  visible,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'primary',
}) => {
  const confirmButtonStyle = confirmStyle === 'danger'
    ? commonStyles.errorRetryButton
    : commonStyles.button;

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={title}
      scrollable={false}
      footer={
        <View style={styles.confirmFooter}>
          <TouchableOpacity
            style={commonStyles.buttonSecondary}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonSecondaryText}>{cancelText}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={confirmButtonStyle}
            onPress={onConfirm}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{confirmText}</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <Text style={styles.confirmMessage}>{message}</Text>
    </Modal>
  );
};

const styles = StyleSheet.create({
  closeButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
    minWidth: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 32,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textMuted,
  },
  scrollableBody: {
    maxHeight: 400,
  },
  confirmFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  confirmMessage: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.normal,
  },
});

export default Modal;
