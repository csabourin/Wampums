/**
 * Theme Configuration
 *
 * Mirrors the design tokens from /css/styles.css
 * Provides consistent styling across web and mobile apps
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
    surface: '#ffffff',
    border: '#d3e3dc',
    borderLight: '#e2efea',
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
};

export default theme;
