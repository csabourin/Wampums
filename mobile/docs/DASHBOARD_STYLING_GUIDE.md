# Visual Styling Guide: Making Mobile Match Web

This guide documents the exact styling differences and how they were resolved.

## Color Scheme Comparison

### Quick Access Cards (Top 4 Buttons)

**Web CSS:**
```css
.dashboard-section .manage-items a {
  background-color: var(--color-primary); /* #0f7a5a - green */
  color: var(--color-surface); /* #ffffff - white text */
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  min-block-size: 96px;
  box-shadow: var(--shadow-sm);
}
```

**Mobile StyleSheet:**
```javascript
actionCardPrimary: {
  backgroundColor: theme.colors.primary, // #0f7a5a - green ✅
  borderWidth: 0,
}
actionLabelPrimary: {
  color: theme.colors.surface, // #ffffff - white text ✅
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.medium,
}
```

### Section Cards (All Other Buttons)

**Web CSS:**
```css
.dashboard-section .manage-items a {
  background-color: var(--color-surface); /* #ffffff - white */
  color: var(--color-text); /* #1d2f2a - dark text */
  border: 1px solid var(--color-border); /* #d3e3dc - light border */
}
```

**Mobile StyleSheet:**
```javascript
actionCardSecondary: {
  backgroundColor: theme.colors.surface, // #ffffff - white ✅
  borderWidth: 1,
  borderColor: theme.colors.border, // #d3e3dc ✅
}
actionLabelSecondary: {
  color: theme.colors.text, // #1d2f2a - dark text ✅
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.medium,
}
```

## Layout Comparison

### Web Structure
```html
<h1>Dashboard</h1>
<h2>6A St-Paul d'Aylmer</h2>

<!-- Quick Access - GREEN CARDS -->
<div class="dashboard-section">
  <div class="manage-items">
    <a href="/managePoints">🪙 Manage Points</a>
    <a href="/manageHonors">🎖️ Honor Wolves</a>
    <a href="/attendance">✅ Attendance</a>
    <a href="/upcoming-meeting">📅 Upcoming Meeting</a>
  </div>
</div>

<!-- Logo -->
<div class="logo-container">
  <img class="logo" src="logo.png">
</div>

<!-- Day-to-Day - WHITE CARDS -->
<section class="dashboard-section">
  <h3>Day-to-Day</h3>
  <div class="manage-items">
    <a href="/approve-badges">🏅 Approve Badges</a>
    <!-- more items... -->
  </div>
</section>

<!-- More sections... -->
```

### Mobile Structure
```jsx
<ScrollView>
  {/* Header */}
  <View style={styles.header}>
    <Text style={styles.title}>Dashboard</Text>
    <Text style={styles.organizationName}>6A St-Paul d'Aylmer</Text>
  </View>

  {/* Quick Access - GREEN CARDS */}
  <View style={styles.quickAccessSection}>
    {renderActionGrid(quickAccessItems, 'primary')}
  </View>

  {/* Logo */}
  <View style={styles.logoContainer}>
    <Image source={logoSource} style={styles.logo} />
  </View>

  {/* Day-to-Day - WHITE CARDS */}
  {visibleSections.map((section) => (
    <View key={section.key} style={styles.section}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {renderActionGrid(section.items, 'secondary')}
    </View>
  ))}
</ScrollView>
```

## Grid Layout Comparison

### Web (Responsive)
```css
.manage-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-md); /* 16px */
  padding: var(--space-md);
}
```

**Result on mobile web:** 2 columns at 320px+ width

### Mobile (Fixed 2-column)
```javascript
const gridColumns = 2;
const gridItemWidth = useMemo(() => {
  const availableWidth =
    windowWidth - gridHorizontalPadding * 2 - gridGap * (gridColumns - 1);
  return Math.max(0, availableWidth / gridColumns);
}, [windowWidth]);

// Applied to each card:
<TouchableOpacity
  style={[
    styles.actionCard,
    { width: gridItemWidth },
  ]}
>
```

**Result:** 2 columns that adapt to screen width

## Icon Differences

### Web: Font Awesome Icons
```html
<i class="fa-solid fa-coins"></i>        <!-- Detailed coin stack icon -->
<i class="fa-solid fa-award"></i>        <!-- Medal/ribbon icon -->
<i class="fa-solid fa-clipboard-check"></i> <!-- Clipboard with check -->
```

**Appearance:** Vector icons, scalable, detailed, can be styled with CSS

### Mobile: Unicode Emojis
```javascript
icon: '🪙'  // Coin emoji
icon: '🎖️'  // Military medal emoji
icon: '✅'  // Check mark in box
```

**Appearance:** Native emojis, render using system fonts, colorful, no dependencies

### Why Emojis?

1. **No Dependencies:** Font Awesome requires `react-native-vector-icons` package
2. **Universal Support:** Emojis work on all platforms (iOS, Android, web)
3. **Consistent Rendering:** System fonts handle emoji display
4. **Performance:** No font loading or caching needed
5. **Simplicity:** Easy to search, copy, and maintain

### Trade-offs

❌ **Cons:**
- Less professional appearance
- Limited customization (can't change color easily)
- Vary by platform (iOS vs Android emoji designs)
- Some emojis not available on older devices

✅ **Pros:**
- Zero dependencies
- Fast rendering
- Easy to understand and maintain
- Work offline immediately
- No licensing concerns

## Spacing Adjustments

### Original Mobile (Too Spacious)
```javascript
quickAccessSection: {
  marginBottom: theme.spacing.md, // 16px - TOO MUCH
},
section: {
  marginTop: theme.spacing.lg, // 24px - TOO MUCH
},
```

### Updated Mobile (Matches Web)
```javascript
quickAccessSection: {
  marginBottom: theme.spacing.sm,  // 8px ✅
  marginTop: theme.spacing.sm,     // 8px ✅
},
section: {
  marginTop: theme.spacing.md,     // 16px ✅
},
sectionTitle: {
  marginTop: theme.spacing.xs,     // 4px ✅
  marginBottom: theme.spacing.sm,  // 8px ✅
},
```

## Logo Styling

### Web CSS
```css
.logo-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo {
  min-block-size: 200px;
  aspect-ratio: 335 / 366; /* Specific to wolf pack logo */
  max-inline-size: 100%;
  block-size: auto;
  object-fit: contain;
}
```

### Mobile StyleSheet
```javascript
logoContainer: {
  alignItems: 'center',
  paddingHorizontal: theme.spacing.lg,
  paddingTop: theme.spacing.md,
  paddingBottom: theme.spacing.lg,
},
logo: {
  width: '80%',
  maxWidth: 335,
  aspectRatio: 335 / 366, // ✅ Same as web
  height: undefined,      // Let aspect ratio control height
},
```

## Card Dimensions

### Web
```css
min-block-size: 96px; /* Minimum height */
```

### Mobile
```javascript
minHeight: 96, // ✅ Exact match
```

## Touch States

### Web (Hover Effects)
```css
.manage-items a:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary);
}
```

### Mobile (Touch Feedback)
```jsx
<TouchableOpacity
  activeOpacity={0.85} // Slight transparency on press
  // No transform - mobile doesn't support hover
>
```

**Note:** Mobile uses opacity change for feedback, which is more appropriate for touch interfaces than transform animations.

## Final Checklist

✅ Quick Access cards are green with white text
✅ Section cards are white with dark text and light borders
✅ Logo is centered and properly sized
✅ 2-column grid layout
✅ Proper spacing matches web density
✅ All sections have correct titles
✅ Permission filtering works
✅ Translations load correctly
✅ Offline indicator displays when no network
✅ Pull-to-refresh works

## Testing Verification

To verify the mobile app matches the web version:

1. **Color Check:** Quick access should be green, sections should be white
2. **Logo Check:** Organization logo should be centered and clearly visible
3. **Spacing Check:** Sections should be compact but readable
4. **Translation Check:** Switch to French, verify "Loups d'honneurs" displays
5. **Navigation Check:** Tap any card, should navigate to correct screen
6. **Permission Check:** Items should appear/hide based on user role
7. **Offline Check:** Disconnect network, should show cached data with indicator

## Common Issues & Solutions

### Issue: All cards are green
**Solution:** Ensure `renderActionGrid(items, 'secondary')` is used for sections, not `'primary'`

### Issue: Icons too small
**Solution:** Verify `fontSize: theme.fontSize.xxl` (24px) is applied to icon text

### Issue: Cards too wide or overlapping
**Solution:** Check `gridItemWidth` calculation includes proper gap spacing

### Issue: Logo too small
**Solution:** Increase logo `width: '80%'` to `'90%'` or adjust `maxWidth`

### Issue: Text not translating
**Solution:** Ensure `translate()` or `t()` function wraps all user-facing strings

### Issue: Spacing too tight
**Solution:** Increase section `marginTop` and card `paddingVertical`

## References

- Web dashboard: `spa/dashboard.js`
- Web styles: `css/styles.css` (lines 1790-1900)
- Mobile dashboard: `mobile/src/screens/LeaderDashboardScreen.js`
- Mobile theme: `mobile/src/theme/index.js`
- Color tokens: Both files use identical hex values from design system
