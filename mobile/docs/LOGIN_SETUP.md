# Login Screen Setup & Testing Guide

**Date**: 2025-12-25
**Status**: ✅ Ready for Testing

---

## 🔧 What Was Fixed

### 1. **Field Mismatch** ✅
- **Issue**: LoginScreen used `username` but backend expects `email`
- **Fix**: Changed all references from `username` to `email`
- **Updated**:
  - LoginScreen component state
  - API endpoint functions (`login`, `verify2FA`)
  - Form input field (now uses `keyboardType="email-address"`)

### 2. **Response Format** ✅
- **Issue**: Backend returns snake_case (`user_id`, `user_role`) but app expected camelCase
- **Fix**: Added backward compatibility to handle both formats
- **Updated**: `storeSessionData` function now checks both naming conventions

### 3. **Navigation Issue** ✅
- **Issue**: LoginScreen tried to `navigation.replace('Dashboard')` but should trigger parent callback
- **Fix**: Now calls `onLogin()` callback to notify RootNavigator, which properly updates auth state
- **Updated**: Both `handleLogin` and `handle2FAVerification` functions

### 4. **Translation Files** ✅
- **Issue**: No translation files in mobile app
- **Fix**: Copied `en.json` and `fr.json` from main project to `mobile/assets/lang/`
- **Updated**: i18n module now loads translations using `require()`

### 5. **Environment Configuration** ✅
- **Issue**: No .env file for local development
- **Fix**: Created `.env` with proper Expo environment variable naming
- **Note**: Expo requires `EXPO_PUBLIC_` prefix for client-accessible variables

---

## 📋 Prerequisites

Before testing the login:

1. **Backend Server Running**
   ```bash
   # In project root
   cd /home/user/Wampums
   npm start
   ```
   - Backend should be accessible at `http://localhost:3000`
   - Verify by visiting: `http://localhost:3000/api/health` (if available)

2. **Database Setup**
   - PostgreSQL running
   - Database migrations applied
   - At least one test user account created

3. **Test User Account**
   - Email: (your test email)
   - Password: (your test password)
   - Organization ID: (your test org ID, default is usually `1`)

---

## 🚀 Running the Mobile App

### Step 1: Navigate to Mobile Directory
```bash
cd /home/user/Wampums/mobile
```

### Step 2: Install Dependencies (if not done)
```bash
npm install
```

### Step 3: Configure Environment

The `.env` file is already created with defaults for Android emulator:
```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api
```

**Platform-Specific Configuration:**

#### For Android Emulator (Default)
- Already configured! `10.0.2.2` is the special address for host machine
- No changes needed

#### For iOS Simulator
Edit `.env` and change:
```env
EXPO_PUBLIC_API_URL=http://localhost:3000/api
```

#### For Physical Device
1. Find your computer's IP address:
   - **macOS/Linux**: `ifconfig | grep inet`
   - **Windows**: `ipconfig`
2. Edit `.env`:
   ```env
   EXPO_PUBLIC_API_URL=http://192.168.1.XXX:3000/api
   ```
3. Ensure device and computer are on **same WiFi network**

### Step 4: Start the Mobile App
```bash
npm start
```

This will:
- Start the Expo development server
- Show a QR code in terminal
- Open a browser with Expo DevTools

### Step 5: Run on Device/Simulator

#### Option A: Android Emulator
1. Have Android Studio with emulator running
2. Press `a` in the terminal

#### Option B: iOS Simulator (macOS only)
1. Have Xcode installed
2. Press `i` in the terminal

#### Option C: Physical Device
1. Install **Expo Go** app from App Store / Play Store
2. Scan the QR code from terminal

---

## 🧪 Testing the Login Flow

### Test 1: Normal Login (No 2FA)

**If your account doesn't have 2FA enabled:**

1. **Open the app** - Should show LoginScreen
2. **Enter credentials:**
   - Email: `test@example.com`
   - Password: `your_password`
3. **Tap "Login"** button
4. **Expected:**
   - ✅ Loading spinner appears
   - ✅ Request sent to backend
   - ✅ JWT token stored in secure storage
   - ✅ User data stored (role, permissions, etc.)
   - ✅ Navigates to appropriate dashboard based on role:
     - **Parent** → ParentDashboardScreen
     - **Leader** → LeaderDashboardScreen
     - **Admin/District** → DistrictDashboardScreen

**Check Console Logs:**
```
[API] POST http://10.0.2.2:3000/api/v1/public/login
[Storage] Storing JWT token
[i18n] Loaded XXX static translations for fr
```

### Test 2: Login with 2FA

**If your account has 2FA enabled:**

1. **Enter credentials** and tap "Login"
2. **Expected:**
   - ✅ 2FA screen appears
   - ✅ Email sent with verification code (check email)
3. **Enter 6-digit code** from email
4. **(Optional)** Check "Trust this device"
5. **Tap "Verify"**
6. **Expected:**
   - ✅ Code verified
   - ✅ JWT token stored
   - ✅ Device token stored (if "trust" was checked)
   - ✅ Navigates to dashboard

### Test 3: Invalid Credentials

1. **Enter wrong email or password**
2. **Tap "Login"**
3. **Expected:**
   - ✅ Error message appears: "Invalid email or password"
   - ✅ Stays on login screen
   - ✅ No navigation occurs

### Test 4: Network Error

1. **Stop backend server**
2. **Try to login**
3. **Expected:**
   - ✅ Error message appears
   - ✅ Stays on login screen

### Test 5: Offline Mode

1. **Enable airplane mode** on device
2. **Try to login**
3. **Expected:**
   - ✅ Request queued (if using offline support)
   - OR
   - ✅ Error message: "Network error"

---

## 🔍 Debugging

### Common Issues

#### Issue: "Network request failed"

**Cause**: Mobile app can't reach backend server

**Solutions:**
1. Verify backend is running: `curl http://localhost:3000/api/health`
2. Check `.env` has correct API_URL for your platform
3. **Android Emulator**: Must use `10.0.2.2` not `localhost`
4. **Physical Device**: Use computer's IP, ensure same WiFi
5. Check firewall settings

**Test Connection:**
```bash
# From your computer
curl -X POST http://localhost:3000/api/v1/public/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

#### Issue: "Session expired" immediately

**Cause**: JWT token issue

**Solutions:**
1. Check backend JWT_SECRET_KEY is set
2. Verify token is being stored: Check AsyncStorage in React Native Debugger
3. Clear app data and try again

**Check Storage:**
```javascript
// In app, add temporary log in LoginScreen
console.log('Stored token:', await StorageUtils.getJWT());
```

#### Issue: Translations showing as keys (e.g., "auth.loginTitle")

**Cause**: Translations not loading

**Solutions:**
1. Verify translation files exist: `ls mobile/assets/lang/`
2. Check console for i18n errors
3. Verify App.js calls `initI18n()` before rendering

**Test Translations:**
```javascript
// Add to LoginScreen temporarily
console.log('Translation test:', t('auth.loginTitle'));
```

#### Issue: Wrong dashboard shown after login

**Cause**: User role not stored correctly

**Solutions:**
1. Check backend response includes `user_role`
2. Verify `storeSessionData` is storing role correctly
3. Check DashboardScreen reads role correctly

**Check Role:**
```javascript
// In DashboardScreen
const role = await StorageUtils.getItem('userRole');
console.log('User role:', role);
```

---

## 📊 Expected API Flow

### Login Request
```http
POST /api/v1/public/login
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "password123",
  "organizationId": "1"
}
```

### Success Response (No 2FA)
```json
{
  "success": true,
  "message": "login_successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_role": "leader",
  "user_roles": ["leader", "parent"],
  "user_permissions": ["view_participants", "edit_activities"],
  "user_full_name": "John Doe",
  "user_id": 123,
  "organization_id": 1
}
```

### Success Response (2FA Required)
```json
{
  "success": true,
  "requires_2fa": true,
  "message": "2fa_code_sent",
  "user_id": 123,
  "email": "test@example.com"
}
```

### 2FA Verification Request
```http
POST /api/v1/public/verify-2fa
Content-Type: application/json

{
  "email": "test@example.com",
  "code": "123456",
  "trustDevice": true
}
```

### 2FA Verification Response
```json
{
  "success": true,
  "message": "2fa_verified",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "device_token": "abc123...",
  "user_role": "leader",
  "user_roles": ["leader"],
  "user_permissions": ["view_participants"],
  "user_full_name": "John Doe",
  "user_id": 123,
  "organization_id": 1
}
```

---

## 📱 Testing Checklist

Before committing, verify:

- [ ] ✅ Login works with valid credentials
- [ ] ✅ Login fails with invalid credentials
- [ ] ✅ Error messages display correctly
- [ ] ✅ 2FA flow works (if enabled)
- [ ] ✅ JWT token stored securely
- [ ] ✅ User role stored correctly
- [ ] ✅ Navigates to correct dashboard
- [ ] ✅ Translations load (English & French)
- [ ] ✅ Works on Android emulator
- [ ] ✅ Works on iOS simulator (if available)
- [ ] ✅ Works on physical device (same WiFi)
- [ ] ✅ Loading states display
- [ ] ✅ Keyboard dismisses appropriately
- [ ] ✅ Touch targets ≥ 44px
- [ ] ✅ Console has no errors

---

## 🔐 Security Notes

### JWT Storage
- ✅ Tokens stored in **Expo SecureStore** (Keychain on iOS, Keystore on Android)
- ✅ Not accessible to other apps
- ✅ Encrypted at rest

### Password Handling
- ✅ Passwords never logged
- ✅ Sent over HTTPS only (production)
- ✅ `secureTextEntry` enabled on password field

### Organization ID
- ⚠️ Currently hardcoded in app (needs user selection in future)
- Future: Fetch based on hostname or user selection

---

## 🚀 Next Steps

After login works:

1. **Implement Logout**
   - Clear JWT from SecureStore
   - Clear user data
   - Navigate back to LoginScreen

2. **Add Organization Selection**
   - Allow users to select organization before login
   - Store organization preference

3. **Add "Remember Me" Feature**
   - Store email (not password!) for convenience
   - Auto-fill on next login

4. **Add Biometric Auth**
   - Face ID / Touch ID support
   - Quick re-authentication

5. **Add Password Reset Flow**
   - "Forgot Password" screen
   - Email-based reset

---

## 📚 Related Documentation

- **Main README**: `/mobile/docs/README.md`
- **Implementation Plan**: `/mobile/docs/IMPLEMENTATION_PLAN.md`
- **Phase 2 Progress**: `/mobile/docs/PHASE_2_PROGRESS_UPDATE.md`
- **Offline Support**: `/mobile/docs/OFFLINE_SUPPORT.md`
- **API Endpoints**: `/mobile/docs/WEB_TO_RN_MAPPING.md`

---

**Last Updated**: 2025-12-25
**Tested On**: Not yet tested (awaiting manual testing)
**Status**: ✅ Code Complete - Ready for Testing
