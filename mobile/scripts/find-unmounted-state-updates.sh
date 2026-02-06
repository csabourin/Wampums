#!/bin/bash
# Find screens with potential setState on unmounted component issues
# Usage: ./mobile/scripts/find-unmounted-state-updates.sh

echo "=== Screens with async state updates without mount checks ==="
echo ""

# Find screens with useState and async functions but no useIsMounted
grep -l "useState" mobile/src/screens/*.js | while read file; do
  # Check if file has async operations
  if grep -q "async\|Promise\|await" "$file"; then
    # Check if it doesn't have useIsMounted
    if ! grep -q "useIsMounted\|isMounted" "$file"; then
      echo "⚠️  $file"
      echo "   - Has useState and async operations"
      echo "   - Missing useIsMounted hook"
      echo ""
    fi
  fi
done

echo ""
echo "=== Screens with useFocusEffect and async operations ==="
echo ""

grep -l "useFocusEffect" mobile/src/screens/*.js | while read file; do
  if grep -q "async\|await" "$file"; then
    if ! grep -q "useIsMounted\|isMounted" "$file"; then
      echo "🔴 $file"
      echo "   - Uses useFocusEffect with async operations"
      echo "   - CRITICAL: Likely causes crashes on navigation"
      echo ""
    fi
  fi
done

echo ""
echo "=== Components with Animated values without cleanup ==="
echo ""

grep -l "Animated\\.timing\|Animated\\.spring" mobile/src/components/*.js mobile/src/screens/*.js 2>/dev/null | while read file; do
  # Check if the useEffect doesn't stop animations in cleanup
  if grep -A 20 "Animated\\.timing\|Animated\\.spring" "$file" | grep -q "useEffect"; then
    if ! grep -A 30 "Animated\\.timing\|Animated\\.spring" "$file" | grep -q "\\.stop()"; then
      echo "⚠️  $file"
      echo "   - Has Animated values without .stop() in cleanup"
      echo ""
    fi
  fi
done

echo ""
echo "=== Summary ==="
echo "Apply the useIsMounted fix to all files listed above."
echo "See mobile/src/screens/CarpoolScreen.js for reference implementation."
