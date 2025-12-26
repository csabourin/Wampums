# Web-to-React Native Theme Parity Documentation

**Last Updated:** 2025-12-26
**Mobile App Version:** 1.0.0
**Web App CSS Version:** /css/styles.css

---

## Overview

This document defines the **complete theme parity** between the Wampums web app (`/css/styles.css`) and the React Native mobile app (`/mobile/src/theme/index.js`). All design tokens from the web app have been mirrored in the RN theme to ensure consistent visual design across platforms.

---

## Design Token Mapping

### Colors

| Web CSS Variable | RN Theme Token | Value | Usage |
|-----------------|----------------|-------|-------|
| `--color-primary` | `theme.colors.primary` | `#0f7a5a` | Primary brand color |
| `--color-primary-light` | `theme.colors.primaryLight` | `#18b29a` | Light variant |
| `--color-primary-dark` | `theme.colors.primaryDark` | `#0b5b43` | Dark variant |
| `--color-secondary` | `theme.colors.secondary` | `#e7f2ee` | Secondary/accent color |
| `--color-success` | `theme.colors.success` | `#1a8f6b` | Success states |
| `--color-error` | `theme.colors.error` | `#9a3f38` | Error states |
| `--color-warning` | `theme.colors.warning` | `#f1b746` | Warning states |
| `--color-info` | `theme.colors.info` | `#178fce` | Info states |
| `--color-text` | `theme.colors.text` | `#1d2f2a` | Body text |
| `--color-text-muted` | `theme.colors.textMuted` | `#6f8a81` | Secondary text |
| `--color-background` | `theme.colors.background` | `#f3f7f4` | App background |
| `--color-surface` | `theme.colors.surface` | `#ffffff` | Card/surface background |
| `--color-border` | `theme.colors.border` | `#d3e3dc` | Border color |

### Gradients

**Web:** CSS `linear-gradient()` and `radial-gradient()`
**RN:** `LinearGradient` component from `expo-linear-gradient`

| Web Gradient | RN Gradient Token | Usage |
|-------------|-------------------|-------|
| `--gradient-primary` | `theme.gradients.primary` | Primary buttons, headers |
| `--gradient-surface` | `theme.gradients.surface` | Cards, forms |
| Body background (radial) | `theme.gradients.background` | Screen backgrounds |

**RN Implementation:**
```javascript
import { LinearGradient } from 'expo-linear-gradient';

<LinearGradient
  colors={theme.gradients.primary.colors}
  start={theme.gradients.primary.start}
  end={theme.gradients.primary.end}
  style={styles.button}
>
  {/* Button content */}
</LinearGradient>
```

### Spacing Scale (8px Grid)

| Web CSS | RN Theme | Value (px) | Value (rem) |
|---------|----------|------------|-------------|
| `--space-xs` | `theme.spacing.xs` | 4 | 0.25rem |
| `--space-sm` | `theme.spacing.sm` | 8 | 0.5rem |
| `--space-md` | `theme.spacing.md` | 16 | 1rem |
| `--space-lg` | `theme.spacing.lg` | 24 | 1.5rem |
| `--space-xl` | `theme.spacing.xl` | 32 | 2rem |
| `--space-2xl` | `theme.spacing.xxl` | 48 | 3rem |
| `--space-3xl` | `theme.spacing.xxxl` | 64 | 4rem |

### Typography

**Web:** Uses `clamp()` for fluid responsive typography
**RN:** Fixed pixel values chosen from mobile range of clamp

| Web CSS Variable | RN Theme Token | Mobile Value | Notes |
|-----------------|----------------|--------------|-------|
| `--font-size-xs` | `theme.fontSize.xs` | 12px | clamp(0.75rem → 0.875rem) |
| `--font-size-sm` | `theme.fontSize.sm` | 14px | clamp(0.875rem → 1rem) |
| `--font-size-base` | `theme.fontSize.base` | 16px | clamp(0.9375rem → 1.125rem) |
| `--font-size-lg` | `theme.fontSize.lg` | 18px | clamp(1.125rem → 1.25rem) |
| `--font-size-xl` | `theme.fontSize.xl` | 20px | clamp(1.25rem → 1.5rem) |
| `--font-size-2xl` | `theme.fontSize.xxl` | 24px | clamp(1.5rem → 2rem) |
| `--font-size-3xl` | `theme.fontSize.xxxl` | 30px | clamp(1.875rem → 2.5rem) |

**Font Weights:**
```javascript
theme.fontWeight.normal   // 400
theme.fontWeight.medium   // 500
theme.fontWeight.semibold // 600
theme.fontWeight.bold     // 700
```

**Line Heights:**
```javascript
theme.lineHeight.tight   // 1.25
theme.lineHeight.normal  // 1.5
theme.lineHeight.relaxed // 1.75
```

### Border Radius

| Web CSS | RN Theme | Value (px) |
|---------|----------|------------|
| `--radius-sm` | `theme.borderRadius.sm` | 6 |
| `--radius-md` | `theme.borderRadius.md` | 12 |
| `--radius-lg` | `theme.borderRadius.lg` | 16 |
| `--radius-xl` | `theme.borderRadius.xl` | 20 |
| `--radius-full` | `theme.borderRadius.full` | 9999 |

### Shadows

**Web:** CSS box-shadow
**RN:** Shadow properties (shadowColor, shadowOffset, shadowOpacity, shadowRadius, elevation)

| Web CSS | RN Theme | Usage |
|---------|----------|-------|
| `--shadow-sm` | `theme.shadows.sm` | Subtle elevation |
| `--shadow-base` | `theme.shadows.base` | Cards, buttons |
| `--shadow-md` | `theme.shadows.md` | Elevated cards |
| `--shadow-lg` | `theme.shadows.lg` | Modals, dropdowns |
| `--shadow-xl` | `theme.shadows.xl` | Maximum elevation |

**RN Usage:**
```javascript
const cardStyle = {
  ...theme.shadows.base,
  // Spreads: shadowColor, shadowOffset, shadowOpacity, shadowRadius, elevation
};
```

### Transitions/Timing

**Web:** CSS transition durations
**RN:** Animation durations in milliseconds for Animated API

| Web CSS | RN Theme | Value (ms) | Usage |
|---------|----------|------------|-------|
| `--transition-fast` | `theme.timing.fast` | 150 | Quick interactions |
| `--transition-base` | `theme.timing.base` | 250 | Standard animations |
| `--transition-slow` | `theme.timing.slow` | 350 | Complex transitions |

**RN Usage:**
```javascript
import { Animated } from 'react-native';

Animated.timing(fadeAnim, {
  toValue: 1,
  duration: theme.timing.base,
  useNativeDriver: true,
}).start();
```

### Z-index Scale

**Web:** CSS z-index
**RN:** zIndex style property

| Web CSS | RN Theme | Value | Usage |
|---------|----------|-------|-------|
| `--z-base` | `theme.zIndex.base` | 1 | Base content |
| `--z-dropdown` | `theme.zIndex.dropdown` | 100 | Dropdowns |
| `--z-sticky` | `theme.zIndex.sticky` | 200 | Sticky headers |
| `--z-fixed` | `theme.zIndex.fixed` | 300 | Fixed elements |
| `--z-overlay` | `theme.zIndex.overlay` | 900 | Overlays |
| `--z-modal` | `theme.zIndex.modal` | 1000 | Modals |
| `--z-toast` | `theme.zIndex.toast` | 1100 | Toasts/snackbars |

### Touch Targets

| Web CSS | RN Theme | Value | Purpose |
|---------|----------|-------|---------|
| `--touch-target-min` | `theme.touchTarget.min` | 44px | WCAG AAA minimum |

---

## Common Styles (Component Patterns)

All component styles from the web app have been implemented in `commonStyles`:

### Buttons

```javascript
// Primary button
<TouchableOpacity style={commonStyles.button}>
  <Text style={commonStyles.buttonText}>Click Me</Text>
</TouchableOpacity>

// Secondary button
<TouchableOpacity style={commonStyles.buttonSecondary}>
  <Text style={commonStyles.buttonSecondaryText}>Cancel</Text>
</TouchableOpacity>
```

### Inputs

```javascript
<View style={commonStyles.formGroup}>
  <Text style={commonStyles.inputLabel}>Email</Text>
  <TextInput
    style={commonStyles.input}
    placeholder="Enter email"
  />
</View>
```

### Cards

```javascript
<View style={commonStyles.card}>
  <Text style={commonStyles.heading3}>Card Title</Text>
  <Text style={commonStyles.bodyText}>Card content...</Text>
</View>
```

### Alerts

```javascript
// Success alert
<View style={[commonStyles.alert, commonStyles.alertSuccess]}>
  <Text style={[commonStyles.alertText, commonStyles.alertTextSuccess]}>
    Success message
  </Text>
</View>

// Error alert
<View style={[commonStyles.alert, commonStyles.alertError]}>
  <Text style={[commonStyles.alertText, commonStyles.alertTextError]}>
    Error message
  </Text>
</View>
```

### Badges

```javascript
<View style={[commonStyles.badge, commonStyles.badgePrimary]}>
  <Text style={commonStyles.badgeText}>New</Text>
</View>
```

### Loading States

```javascript
<View style={commonStyles.loadingContainer}>
  <ActivityIndicator size="large" color={theme.colors.primary} />
  <Text style={commonStyles.loadingText}>Loading...</Text>
</View>
```

### Empty States

```javascript
<View style={commonStyles.emptyContainer}>
  <Text style={commonStyles.emptyText}>No items found</Text>
</View>
```

### Error States

```javascript
<View style={commonStyles.errorContainer}>
  <Text style={commonStyles.errorText}>An error occurred</Text>
  <TouchableOpacity style={commonStyles.errorRetryButton}>
    <Text style={commonStyles.buttonText}>Retry</Text>
  </TouchableOpacity>
</View>
```

### Modals

```javascript
<Modal visible={isVisible} transparent>
  <View style={commonStyles.modalOverlay}>
    <View style={commonStyles.modalContainer}>
      <View style={commonStyles.modalHeader}>
        <Text style={commonStyles.modalTitle}>Modal Title</Text>
      </View>
      <View style={commonStyles.modalBody}>
        {/* Modal content */}
      </View>
      <View style={commonStyles.modalFooter}>
        <TouchableOpacity style={commonStyles.buttonSecondary}>
          <Text style={commonStyles.buttonSecondaryText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={commonStyles.button}>
          <Text style={commonStyles.buttonText}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>
```

---

## Implementation Rules for Future Screens

When creating new screens or components in the mobile app:

### 1. Always Use Theme Tokens

❌ **Don't:**
```javascript
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f3f7f4', // Hardcoded color
    padding: 16,                // Magic number
  },
});
```

✅ **Do:**
```javascript
import theme from '../theme';

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
});
```

### 2. Use Common Styles

❌ **Don't recreate component styles:**
```javascript
const button = {
  backgroundColor: '#0f7a5a',
  borderRadius: 12,
  padding: 16,
  minHeight: 44,
};
```

✅ **Extend common styles:**
```javascript
import { commonStyles } from '../theme';

const button = {
  ...commonStyles.button,
  // Custom overrides only if needed
};
```

### 3. Match Web Component Patterns

When porting a web component to RN:

1. Identify the web component's CSS classes
2. Find the equivalent `commonStyles` pattern
3. Apply the common style and add component-specific overrides
4. Ensure touch targets are ≥ 44px

**Example:** Porting a web card

**Web:**
```css
.card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  box-shadow: var(--shadow-base);
}
```

**RN:**
```javascript
const styles = StyleSheet.create({
  card: {
    ...commonStyles.card, // Already includes all the above
  },
});
```

### 4. Typography Hierarchy

Use semantic heading styles:

```javascript
<Text style={commonStyles.heading1}>Page Title</Text>
<Text style={commonStyles.heading2}>Section Title</Text>
<Text style={commonStyles.heading3}>Subsection</Text>
<Text style={commonStyles.bodyText}>Body content</Text>
<Text style={commonStyles.caption}>Small text / captions</Text>
```

### 5. Spacing Consistency

Always use spacing scale:

```javascript
// Margins and padding
marginBottom: theme.spacing.md,
paddingHorizontal: theme.spacing.lg,

// Gaps in flex/grid layouts
gap: theme.spacing.sm,
```

---

## Platform-Specific Considerations

### Gradients

Web uses CSS `linear-gradient()`, but RN requires a component:

```bash
npm install expo-linear-gradient
```

```javascript
import { LinearGradient } from 'expo-linear-gradient';

<LinearGradient {...theme.gradients.primary} style={styles.button}>
  <Text>Button</Text>
</LinearGradient>
```

### Shadows

Web uses `box-shadow`, RN uses separate shadow properties:

- iOS: Uses `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`
- Android: Uses `elevation`

The theme includes both, so just spread the shadow object:

```javascript
const cardStyle = {
  ...theme.shadows.base, // Works on both platforms
};
```

### Transitions

Web uses CSS `transition`, RN uses `Animated` API:

```javascript
import { Animated } from 'react-native';

const fadeAnim = new Animated.Value(0);

Animated.timing(fadeAnim, {
  toValue: 1,
  duration: theme.timing.base, // Use theme timing
  useNativeDriver: true,
}).start();
```

---

## Testing Theme Parity

When adding a new screen, verify:

- [ ] All colors use `theme.colors.*`
- [ ] All spacing uses `theme.spacing.*`
- [ ] All typography uses `commonStyles.heading*` or `commonStyles.bodyText`
- [ ] Buttons use `commonStyles.button` or variants
- [ ] Cards use `commonStyles.card`
- [ ] Touch targets are ≥ 44px (`theme.touchTarget.min`)
- [ ] Visual appearance matches web app
- [ ] Loading/error/empty states use common styles

---

## Maintenance

**When updating web CSS:**

1. Update `/css/styles.css`
2. Mirror changes to `/mobile/src/theme/index.js`
3. Update this documentation
4. Update affected `commonStyles` patterns

**When adding new design tokens:**

1. Add to web CSS with proper naming
2. Add equivalent to RN theme
3. Document in this file
4. Create commonStyles pattern if reusable

---

## Complete Theme API Reference

```javascript
import theme, { commonStyles } from '../theme';

// Colors
theme.colors.primary
theme.colors.secondary
theme.colors.success
theme.colors.error
theme.colors.warning
theme.colors.info
theme.colors.text
theme.colors.textMuted
theme.colors.background
theme.colors.surface
theme.colors.border

// Gradients (for LinearGradient component)
theme.gradients.primary
theme.gradients.surface
theme.gradients.background

// Spacing
theme.spacing.xs (4px)
theme.spacing.sm (8px)
theme.spacing.md (16px)
theme.spacing.lg (24px)
theme.spacing.xl (32px)
theme.spacing.xxl (48px)
theme.spacing.xxxl (64px)

// Typography
theme.fontSize.xs - xxxl
theme.fontWeight.normal - bold
theme.lineHeight.tight - relaxed

// Border Radius
theme.borderRadius.sm - full

// Shadows
theme.shadows.sm - xl

// Timing (for animations)
theme.timing.fast (150ms)
theme.timing.base (250ms)
theme.timing.slow (350ms)

// Z-index
theme.zIndex.base - toast

// Touch Targets
theme.touchTarget.min (44px)

// Common Styles
commonStyles.container
commonStyles.card
commonStyles.button / buttonSecondary
commonStyles.buttonText / buttonSecondaryText
commonStyles.input / inputLabel
commonStyles.heading1 - heading3
commonStyles.bodyText / caption
commonStyles.alert / alertSuccess / alertError / alertWarning / alertInfo
commonStyles.badge / badgePrimary / badgeSecondary / badgeSuccess / badgeError / badgeWarning
commonStyles.modal* (overlay, container, header, title, body, footer)
commonStyles.table* (header, row, cell)
commonStyles.loading* / error* / empty* containers
// ... and many more
```

---

## Questions or Issues?

For questions about theme parity or design tokens:

1. Refer to this document
2. Check `/css/styles.css` for web definitions
3. Check `/mobile/src/theme/index.js` for RN implementation
4. Consult `/mobile/docs/WEB_TO_RN_MAPPING.md` for utility mappings

---

**Last Updated:** 2025-12-26
**Maintainers:** Development Team
**Status:** ✅ Complete Parity Achieved
