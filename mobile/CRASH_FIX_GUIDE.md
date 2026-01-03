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
All 56 screens listed in the script output need the useIsMounted fix.

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
