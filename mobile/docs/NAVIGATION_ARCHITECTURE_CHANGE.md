# Navigation Architecture Change - Web Parity

## Problem
The mobile app had a bottom tab navigator (`MainTabNavigator`) showing 5 tabs:
- Dashboard (Tableau de Bord)
- Participants
- Activities (Activités) 
- Finance (Finances)
- Settings (Paramètres)

This **does not match the web version**, which uses a pure dashboard approach where all navigation happens through dashboard links.

## Solution
Removed the bottom tab navigator and converted to a **pure stack navigation** structure that mirrors the web SPA architecture.

## Changes Made

### 1. Removed Tab Navigation
**Before:**
```javascript
// AppNavigator.js
<Stack.Screen name="MainTabs">
  {() => <MainTabNavigator userPermissions={userPermissions} />}
</Stack.Screen>
```

**After:**
```javascript
// AppNavigator.js - Pure stack navigation
<Stack.Navigator initialRouteName="Dashboard">
  <Stack.Screen name="Dashboard" component={DashboardScreen} />
  <Stack.Screen name="Participants" component={ParticipantsScreen} />
  <Stack.Screen name="Activities" component={ActivitiesScreen} />
  <Stack.Screen name="Settings" component={SettingsScreen} />
  {/* ... all other screens */}
</Stack.Navigator>
```

### 2. Added Settings Button to Dashboard Header
Both `LeaderDashboardScreen` and `ParentDashboardScreen` now show a settings gear icon (⚙️) in the top-right header.

```javascript
useEffect(() => {
  navigation.setOptions({
    headerShown: true,
    title: t('dashboard_title'),
    headerRight: () => (
      <TouchableOpacity
        onPress={() => navigation.navigate('Settings')}
        style={{ paddingRight: 16 }}
        accessibilityLabel={t('settings')}
      >
        <Text style={{ fontSize: 24 }}>⚙️</Text>
      </TouchableOpacity>
    ),
  });
}, [navigation]);
```

### 3. Navigation Flow Now Matches Web

**Web Version:**
```
Dashboard (home) 
  → Click "Participants" card → Participants page
  → Click "Activities" card → Activities page
  → Click "Settings" link → Settings page
```

**Mobile Version (New):**
```
Dashboard (home screen)
  → Tap "Participants" card → Participants screen
  → Tap "Activities" card → Activities screen
  → Tap ⚙️ icon → Settings screen
```

## File Changes

### Modified Files
1. **`mobile/src/navigation/AppNavigator.js`**
   - Removed `MainTabNavigator` import and usage
   - Added `DashboardScreen` as `initialRouteName`
   - Added direct stack screens for `Participants`, `Activities`, `Settings`
   - All screens now accessible via stack navigation (no tabs)

2. **`mobile/src/screens/LeaderDashboardScreen.js`**
   - Added `useEffect` to configure navigation header with settings button
   - Settings icon (⚙️) displayed in top-right corner

3. **`mobile/src/screens/ParentDashboardScreen.js`**
   - Added `useNavigation` hook import
   - Added `useEffect` to configure navigation header with settings button
   - Fixed props destructuring (removed `{ navigation }`, use hook instead)

### Deprecated Files (Can Be Removed)
- **`mobile/src/navigation/MainTabNavigator.js`** - No longer used

## User Experience Changes

### Before (Tab Navigator)
- ❌ 5 tabs always visible at bottom
- ❌ Didn't match web design
- ❌ Wasted screen space
- ❌ Participants/Activities/Finance accessible from tabs (not dashboard)

### After (Pure Stack Navigation)
- ✅ Full-screen dashboard (more space for content)
- ✅ Matches web SPA structure exactly
- ✅ Settings accessible via header icon (always available)
- ✅ All navigation happens through dashboard cards
- ✅ More mobile-native feel (iOS/Android standard pattern)

## Navigation Patterns

### From Dashboard
All navigation starts from dashboard cards:
```javascript
// LeaderDashboardScreen.js
const handleActionPress = (action) => {
  if (action.screen) {
    navigation.navigate(action.screen); // e.g., 'Participants', 'Activities'
  }
};
```

### To Settings
Settings accessible from header on any screen that shows it:
```javascript
navigation.navigate('Settings')
```

### Back Navigation
Standard React Navigation back button (< ) in header automatically works for all screens.

## Benefits

1. **Web Parity**: Mobile app now mirrors web architecture
2. **Consistent UX**: Users familiar with web will recognize mobile structure
3. **More Screen Space**: No permanent tab bar taking up space
4. **Permission-Based**: Dashboard filters what users can access (not hardcoded tabs)
5. **Scalability**: Easy to add new screens without cluttering tabs
6. **Standard Mobile Pattern**: Most apps use this navigation structure

## Testing Checklist

- [x] Dashboard loads as initial screen
- [x] Settings icon visible in dashboard header
- [x] Tapping settings icon navigates to Settings screen
- [x] All dashboard cards navigate to correct screens
- [x] Back navigation works from all screens
- [x] No tab bar visible at bottom
- [x] Both LeaderDashboard and ParentDashboard have settings icon
- [x] Permission-based filtering still works

## Future Enhancements

### Optional: Settings Gear Icon Upgrade
Currently using emoji (⚙️). Could upgrade to vector icon:

```bash
npm install react-native-vector-icons
```

```javascript
import Icon from 'react-native-vector-icons/Ionicons';

headerRight: () => (
  <Icon 
    name="settings-outline" 
    size={24} 
    color={theme.colors.text}
    onPress={() => navigation.navigate('Settings')}
    style={{ paddingRight: 16 }}
  />
)
```

### Optional: Logout Button
Could add logout to header or keep in Settings screen (currently in Settings).

## Conclusion

The mobile app now uses **pure stack navigation** that exactly mirrors the web SPA structure. No more tab navigation - all navigation flows through the dashboard, with Settings accessible via a header button.

This provides better web parity, more screen space, and a cleaner mobile experience focused on functionality over chrome.
