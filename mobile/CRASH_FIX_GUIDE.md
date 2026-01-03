# Mobile App Silent Crash Fix Guide

## Problem Overview

Random app crashes during navigation are caused by **setState calls on unmounted components**. When you navigate away from a screen, async operations continue and try to update state on components that no longer exist, causing silent crashes.

## Root Causes Identified

### 1. **setState on Unmounted Components** (Most Common)
- **56 screens** have this issue
- Async operations (API calls, timers) continue after component unmounts
- useFocusEffect hooks without cleanup
- Promise.all() calls that don't check mount status

### 2. **Animation Cleanup Issues**
- Animated.timing() continues after unmount
- setState in animation callbacks on unmounted components

### 3. **Missing Error Boundaries**
- Only root App.js has error boundary
- Sub-navigators and screens crash without recovery

## Solutions Implemented

### ✅ Fix #1: useIsMounted Hook

**Created:** `/home/user/Wampums/mobile/src/hooks/useIsMounted.js`

This hook tracks whether a component is currently mounted and should be used in ALL async operations.

**Usage Pattern:**

```javascript
import { useIsMounted } from '../hooks/useIsMounted';

const MyScreen = () => {
  const isMounted = useIsMounted();
  const [data, setData] = useState(null);

  const loadData = async () => {
    try {
      if (!isMounted()) return; // Check before setState
      setLoading(true);

      const response = await fetchData();

      if (!isMounted()) return; // Check after async operation
      setData(response.data);
    } catch (error) {
      if (!isMounted()) return; // Check in catch block
      setError(error.message);
    } finally {
      if (isMounted()) { // Check in finally block
        setLoading(false);
      }
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
      // No cleanup needed - isMounted() handles it
    }, [])
  );
};
```

### ✅ Fix #2: Animation Cleanup (Toast.js)

**Fixed:** `/home/user/Wampums/mobile/src/components/Toast.js`

Animations now properly stop when component unmounts:

```javascript
useEffect(() => {
  let isCancelled = false;
  let animationRef = null;

  if (visible) {
    animationRef = Animated.parallel([...]);
    animationRef.start();

    const timer = setTimeout(() => {
      if (!isCancelled) {
        handleDismiss();
      }
    }, duration);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (animationRef) {
        animationRef.stop(); // Stop animation on cleanup
      }
    };
  }
}, [visible, duration]);
```

### ✅ Fix #3: Reference Implementation (CarpoolScreen.js)

**Fixed:** `/home/user/Wampums/mobile/src/screens/CarpoolScreen.js`

This screen now demonstrates proper patterns:
- useIsMounted checks before all setState calls
- Checks after every async operation
- Checks in try/catch/finally blocks
- Safe Promise.all() handling

## Files That Need Fixing

### 🔴 CRITICAL (useFocusEffect + async) - Fix These First:
1. `mobile/src/screens/ActivitiesScreen.js`
2. `mobile/src/screens/LeaderDashboardScreen.js`
3. `mobile/src/screens/ManagePointsScreen.js`
4. `mobile/src/screens/ParticipantsScreen.js`

### ⚠️ HIGH PRIORITY (async operations):
All screens listed below need the useIsMounted fix.

#### Screens with async state updates without mount checks
1. `mobile/src/screens/AccountInfoScreen.js`
2. `mobile/src/screens/ActivitiesScreen.js`
3. `mobile/src/screens/ActivityDetailScreen.js`
4. `mobile/src/screens/AdminScreen.js`
5. `mobile/src/screens/ApproveBadgesScreen.js`
6. `mobile/src/screens/AttendanceScreen.js`
7. `mobile/src/screens/BadgeDashboardScreen.js`
8. `mobile/src/screens/BadgeFormScreen.js`
9. `mobile/src/screens/BudgetsScreen.js`
10. `mobile/src/screens/CalendarScreen.js`
11. `mobile/src/screens/CreateOrganizationScreen.js`
12. `mobile/src/screens/DashboardScreen.js`
13. `mobile/src/screens/ExpensesScreen.js`
14. `mobile/src/screens/ExternalRevenueScreen.js`
15. `mobile/src/screens/FinanceScreen.js`
16. `mobile/src/screens/FormPermissionsScreen.js`
17. `mobile/src/screens/FundraisersScreen.js`
18. `mobile/src/screens/GroupParticipantReportScreen.js`
19. `mobile/src/screens/GroupsScreen.js`
20. `mobile/src/screens/HealthFormScreen.js`
21. `mobile/src/screens/HonorsScreen.js`
22. `mobile/src/screens/InventoryScreen.js`
23. `mobile/src/screens/LeaderDashboardScreen.js`
24. `mobile/src/screens/LoginScreen.js`
25. `mobile/src/screens/MailingListScreen.js`
26. `mobile/src/screens/ManagePointsScreen.js`
27. `mobile/src/screens/MaterialManagementScreen.js`
28. `mobile/src/screens/MedicationDistributionScreen.js`
29. `mobile/src/screens/MedicationPlanningScreen.js`
30. `mobile/src/screens/MedicationScreen.js`
31. `mobile/src/screens/MeetingPreparationScreen.js`
32. `mobile/src/screens/NextMeetingScreen.js`
33. `mobile/src/screens/OrganizationSelectScreen.js`
34. `mobile/src/screens/ParentContactListScreen.js`
35. `mobile/src/screens/ParentDashboardScreen.js`
36. `mobile/src/screens/ParentFinanceScreen.js`
37. `mobile/src/screens/ParticipantDetailScreen.js`
38. `mobile/src/screens/ParticipantDocumentsScreen.js`
39. `mobile/src/screens/ParticipantsScreen.js`
40. `mobile/src/screens/PermissionSlipSignScreen.js`
41. `mobile/src/screens/PermissionSlipsScreen.js`
42. `mobile/src/screens/RegisterOrganizationScreen.js`
43. `mobile/src/screens/RegisterScreen.js`
44. `mobile/src/screens/RegistrationFormScreen.js`
45. `mobile/src/screens/ReportsScreen.js`
46. `mobile/src/screens/ReportViewerScreen.js`
47. `mobile/src/screens/ResetPasswordScreen.js`
48. `mobile/src/screens/ResourceDashboardScreen.js`
49. `mobile/src/screens/RevenueDashboardScreen.js`
50. `mobile/src/screens/RiskAcceptanceScreen.js`
51. `mobile/src/screens/RoleManagementScreen.js`
52. `mobile/src/screens/SettingsScreen.js`
53. `mobile/src/screens/TimeSinceRegistrationScreen.js`
54. `mobile/src/screens/UserParticipantLinkScreen.js`

#### Screens with useFocusEffect and async operations
1. `mobile/src/screens/ActivitiesScreen.js`
2. `mobile/src/screens/LeaderDashboardScreen.js`
3. `mobile/src/screens/ManagePointsScreen.js`
4. `mobile/src/screens/ParticipantsScreen.js`

Run this command to see the full list:
```bash
./mobile/scripts/find-unmounted-state-updates.sh
```

## Step-by-Step Fix Process

### For Each Screen:

1. **Add import:**
   ```javascript
   import { useIsMounted } from '../hooks/useIsMounted';
   ```

2. **Add hook in component:**
   ```javascript
   const MyScreen = () => {
     const isMounted = useIsMounted();
     // ... rest of component
   ```

3. **Add checks to async functions:**
   ```javascript
   const loadData = async () => {
     try {
       if (!isMounted()) return;
       setLoading(true);

       const data = await fetchData();
       if (!isMounted()) return;
       setData(data);
     } catch (err) {
       if (!isMounted()) return;
       setError(err);
     } finally {
       if (isMounted()) {
         setLoading(false);
       }
     }
   };
   ```

4. **Check after EVERY await:**
   - After API calls
   - After Promise.all()
   - After StorageUtils calls
   - After any async operation

5. **Check in callbacks:**
   - setTimeout/setInterval callbacks
   - Animation callbacks
   - Event handler callbacks with async operations

## Testing

### Before Fix:
- Navigate rapidly between screens
- App crashes silently
- No error messages
- Happens most on screens with data loading

### After Fix:
- Navigate rapidly between screens
- No crashes
- Data loads when screen is mounted
- Operations cancel cleanly when unmounting

## Verification Checklist

For each fixed screen, verify:
- [ ] Imports useIsMounted hook
- [ ] Calls isMounted() before every setState
- [ ] Checks after every async operation (await)
- [ ] Checks in try/catch/finally blocks
- [ ] useFocusEffect doesn't cause crashes
- [ ] Navigating away doesn't crash
- [ ] Rapid navigation works smoothly

## Additional Recommendations

### 1. Add Error Boundaries to Navigators

Add ErrorBoundary wrappers to:
- `mobile/src/navigation/AppNavigator.js`
- `mobile/src/navigation/AuthNavigator.js`

### 2. Global Error Handler

Add to `mobile/App.js`:
```javascript
import { LogBox } from 'react-native';

// Ignore specific warnings
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
]);

// Global error handler
ErrorUtils.setGlobalHandler((error, isFatal) => {
  console.error('Global error:', error, isFatal);
  // Could report to Sentry here
});
```

### 3. Unhandled Promise Rejection Handler

Add to `mobile/App.js`:
```javascript
const unhandledRejectionHandler = (event) => {
  console.error('Unhandled promise rejection:', event);
};

if (global.HermesInternal) {
  global.HermesInternal.setUnhandledRejectionHandler(unhandledRejectionHandler);
}
```

## Automated Fix Script

To help apply fixes faster, you can use this pattern:

```bash
# Find all screens that need fixing
./mobile/scripts/find-unmounted-state-updates.sh

# For each screen, apply the pattern shown in CarpoolScreen.js
```

## Success Metrics

After applying fixes to all screens:
- ✅ No more silent crashes during navigation
- ✅ Can navigate rapidly without issues
- ✅ Loading states work correctly
- ✅ Error messages appear when API calls fail
- ✅ App feels more stable and responsive

## Reference Files

- **Hook Implementation:** `mobile/src/hooks/useIsMounted.js`
- **Screen Example:** `mobile/src/screens/CarpoolScreen.js`
- **Component Example:** `mobile/src/components/Toast.js`
- **Detection Script:** `mobile/scripts/find-unmounted-state-updates.sh`

## Need Help?

If you encounter edge cases or complex scenarios, refer to the React Navigation documentation on cleanup and the React Hooks documentation on useEffect cleanup functions.
