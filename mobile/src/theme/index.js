/**
 * Theme Configuration
 *
 * Mirrors the design tokens from /css/styles.css
 * Provides consistent styling across web and mobile apps
 *
 * IMPORTANT: This theme provides FULL PARITY with the web app design system.
 * All tokens from /css/styles.css are represented here in RN-compatible format.
 */

const theme = {
  // Color Palette - Brand Colors
  colors: {
    primary: '#0f7a5a',
    primaryLight: '#18b29a',
    primaryDark: '#0b5b43',
    secondary: '#e7f2ee',

    // Semantic Colors
    success: '#1a8f6b',
    successLight: '#20ad83',
    error: '#9a3f38',
    errorLight: '#d45a51',
    warning: '#f1b746',
    warningLight: '#ffd773',
    info: '#178fce',

    // Selection & States
    selected: '#0f7a5a',
    selectedText: '#ffffff',

    // Neutral Colors
    text: '#1d2f2a',
    textLight: '#47665d',
    textMuted: '#6f8a81',
    background: '#f3f7f4',
    backgroundGradientStart: '#f1f7f3',
    backgroundGradientMiddle: '#f7fbf9',
    backgroundGradientEnd: '#f3f7f4',
    surface: '#ffffff',
    surfaceGradientStart: '#ffffff',
    surfaceGradientEnd: '#f7fbf9',
    border: '#d3e3dc',
    borderLight: '#e2efea',
  },

  // Gradients - RN-compatible format for use with LinearGradient
  // Usage: import LinearGradient from 'expo-linear-gradient' or 'react-native-linear-gradient'
  // <LinearGradient colors={theme.gradients.primary.colors} locations={theme.gradients.primary.locations} ...>
  gradients: {
    primary: {
      colors: ['#0f7a5a', '#18b29a'],
      locations: [0, 1],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 }, // 135deg diagonal
    },
    primaryHover: {
      colors: ['#0b5b43', '#129f87'],
      locations: [0, 1],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    },
    surface: {
      colors: ['#ffffff', '#f7fbf9'],
      locations: [0, 1],
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 }, // 180deg vertical
    },
    background: {
      // Radial gradient approximation for background
      colors: ['#f1f7f3', '#f7fbf9', '#f3f7f4'],
      locations: [0, 0.35, 1],
      start: { x: 0.18, y: 0.2 },
      end: { x: 1, y: 1 },
    },
  },

  // Spacing Scale - Based on 8px grid
  spacing: {
    xs: 4,    // 0.25rem
    sm: 8,    // 0.5rem
    md: 16,   // 1rem
    lg: 24,   // 1.5rem
    xl: 32,   // 2rem
    xxl: 48,  // 3rem
    xxxl: 64, // 4rem
  },

  // Typography Scale
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 30,
  },

  // Font Weights
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  // Line Heights
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },

  // Border Radius
  borderRadius: {
    sm: 6,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },

  // Shadows (React Native shadow properties)
  shadows: {
    sm: {
      shadowColor: '#0f7a5a',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    base: {
      shadowColor: '#0f7a5a',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
    },
    md: {
      shadowColor: '#0f7a5a',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 8,
    },
    lg: {
      shadowColor: '#0f7a5a',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12,
      shadowRadius: 30,
      elevation: 12,
    },
    xl: {
      shadowColor: '#0f7a5a',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.14,
      shadowRadius: 40,
      elevation: 18,
    },
  },

  // Touch Targets
  touchTarget: {
    min: 44,
  },

  // Z-index Scale - For layering components
  zIndex: {
    base: 1,
    dropdown: 100,
    sticky: 200,
    fixed: 300,
    overlay: 900,
    modal: 1000,
    toast: 1100,
  },

  // Transitions/Timing - Animation durations in milliseconds
  timing: {
    fast: 150,
    base: 250,
    slow: 350,
  },

  // Container/Layout Constraints
  container: {
    sm: 600,
    md: 768,
    lg: 1024,
    xl: 1280,
  },
};

/**
 * Common component styles using the theme
 */
export const commonStyles = {
  // Container styles
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  // Card styles
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    ...theme.shadows.base,
  },

  // Button styles
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.touchTarget.min,
  },
  buttonText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },

  // Secondary button
  buttonSecondary: {
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.touchTarget.min,
  },
  buttonSecondaryText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },

  // Input styles
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    minHeight: theme.touchTarget.min,
  },
  inputLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },

  // Text styles
  heading1: {
    fontSize: theme.fontSize.xxxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    lineHeight: theme.fontSize.xxxl * theme.lineHeight.tight,
  },
  heading2: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    lineHeight: theme.fontSize.xxl * theme.lineHeight.tight,
  },
  heading3: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    lineHeight: theme.fontSize.xl * theme.lineHeight.tight,
  },
  bodyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.normal,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.fontSize.sm * theme.lineHeight.normal,
  },

  // Section styles
  section: {
    padding: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: theme.colors.borderLight,
  },

  // Row styles
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
    minHeight: theme.touchTarget.min,
  },

  // List item
  listItem: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    ...theme.shadows.sm,
  },

  // Loading States
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  // Error States
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.error,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  errorRetryButton: {
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    minHeight: theme.touchTarget.min,
  },

  // Empty States
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  // Badges
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    alignSelf: 'flex-start',
  },
  badgePrimary: {
    backgroundColor: theme.colors.primary,
  },
  badgeSecondary: {
    backgroundColor: theme.colors.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badgeSuccess: {
    backgroundColor: theme.colors.success,
  },
  badgeError: {
    backgroundColor: theme.colors.error,
  },
  badgeWarning: {
    backgroundColor: theme.colors.warning,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.selectedText,
  },
  badgeTextSecondary: {
    color: theme.colors.text,
  },

  // Alerts/Messages
  alert: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 4,
  },
  alertInfo: {
    backgroundColor: '#e3f2fd',
    borderLeftColor: theme.colors.info,
  },
  alertSuccess: {
    backgroundColor: '#d4edda',
    borderLeftColor: theme.colors.success,
  },
  alertWarning: {
    backgroundColor: '#fff3cd',
    borderLeftColor: theme.colors.warning,
  },
  alertError: {
    backgroundColor: '#f8d7da',
    borderLeftColor: theme.colors.error,
  },
  alertText: {
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * theme.lineHeight.normal,
  },
  alertTextInfo: {
    color: '#0c5460',
  },
  alertTextSuccess: {
    color: '#155724',
  },
  alertTextWarning: {
    color: '#856404',
  },
  alertTextError: {
    color: '#721c24',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  modalContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    maxWidth: theme.container.sm,
    width: '100%',
    ...theme.shadows.xl,
  },
  modalHeader: {
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  modalTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  modalBody: {
    marginBottom: theme.spacing.lg,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
  },

  // Table/List Styles
  table: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    ...theme.shadows.base,
    overflow: 'hidden',
  },
  tableHeader: {
    backgroundColor: theme.colors.secondary,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.border,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    minHeight: theme.touchTarget.min,
  },
  tableRowOdd: {
    backgroundColor: '#f8fbf9',
  },
  tableCell: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },

  // Form Extensions
  formGroup: {
    marginBottom: theme.spacing.lg,
  },
  formError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
  formHelp: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonChecked: {
    borderColor: theme.colors.primary,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
  },

  // Summary Dashboard (from web app)
  summaryGrid: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  summaryTile: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    ...theme.shadows.base,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  summaryLabel: {
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
    fontSize: theme.fontSize.lg,
  },
  summaryValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primaryDark,
  },

  // Utility Classes
  textCenter: {
    textAlign: 'center',
  },
  textLeft: {
    textAlign: 'left',
  },
  textRight: {
    textAlign: 'right',
  },
  flex1: {
    flex: 1,
  },
  flexRow: {
    flexDirection: 'row',
  },
  flexColumn: {
    flexDirection: 'column',
  },
  alignCenter: {
    alignItems: 'center',
  },
  justifyCenter: {
    justifyContent: 'center',
  },
  justifyBetween: {
    justifyContent: 'space-between',
  },
};

export default theme;
