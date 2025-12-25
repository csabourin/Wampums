# Wampums React Native Mobile App

React Native mobile application for Wampums, running in parallel with the existing web frontend.

## 🏗️ Architecture

### Directory Structure

```
mobile/
├── src/
│   ├── api/              # API client and endpoint wrappers
│   │   ├── api-core.js   # Core HTTP client with auth
│   │   └── api-endpoints.js  # All API endpoint functions
│   ├── screens/          # Screen components
│   │   ├── LoginScreen.js
│   │   ├── DashboardScreen.js
│   │   └── index.js
│   ├── components/       # Reusable UI components
│   │   ├── Button.js
│   │   ├── Card.js
│   │   ├── LoadingSpinner.js
│   │   └── index.js
│   ├── utils/            # Utility functions
│   │   ├── StorageUtils.js    # Secure storage (JWT, data)
│   │   ├── SecurityUtils.js   # Input sanitization
│   │   ├── DateUtils.js       # Locale-aware date formatting
│   │   └── NumberUtils.js     # Locale-aware number formatting
│   ├── i18n/             # Internationalization
│   │   └── index.js      # Bilingual support (en/fr)
│   └── config/           # Configuration
│       └── index.js      # Environment-driven config
├── App.js                # Root component
├── package.json          # Dependencies
├── .env.example          # Environment template
└── WEB_TO_RN_MAPPING.md  # Web utility mapping guide
```

### Key Features

- ✅ **Same Backend APIs**: Uses identical `/api/v1` endpoints as web app
- ✅ **Bilingual Support**: English and French with one language per screen
- ✅ **Secure Authentication**: JWT tokens stored in device Keychain/Keystore
- ✅ **Locale-Aware Formatting**: Dates, numbers, and currency formatted per locale
- ✅ **Input Sanitization**: All user input sanitized before display or submission
- ✅ **Offline Support**: (Coming in Phase 2)
- ✅ **Push Notifications**: (Coming in Phase 2)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18 or higher
- **npm** or **yarn**
- **Expo CLI**: `npm install -g expo-cli`
- **Expo Go App**: Install on your phone (iOS/Android) for testing

For iOS development:
- **macOS** with **Xcode** installed
- **CocoaPods**: `sudo gem install cocoapods`

For Android development:
- **Android Studio** with Android SDK

### Installation

1. **Navigate to mobile directory**:
   ```bash
   cd mobile
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file** with your local API URL:
   ```env
   # For Android emulator:
   API_URL=http://10.0.2.2:3000/api

   # For iOS simulator:
   API_URL=http://localhost:3000/api

   # For physical device (replace with your computer's IP):
   API_URL=http://192.168.1.XXX:3000/api
   ```

5. **Start the backend server** (in root directory):
   ```bash
   npm start
   ```

6. **Start the mobile app** (in mobile directory):
   ```bash
   npm start
   ```

7. **Run on device/simulator**:
   - Scan QR code with **Expo Go** app (physical device)
   - Press `i` for **iOS simulator**
   - Press `a` for **Android emulator**

---

## 🔧 Development

### Running Web + Mobile in Parallel

The mobile app is designed to run alongside the web app, both connecting to the same backend:

#### Terminal 1: Backend Server
```bash
# In project root
npm start
```

#### Terminal 2: Web App (optional, for comparison)
```bash
# In project root
# Web app runs on port 3000 with backend
```

#### Terminal 3: Mobile App
```bash
# In mobile directory
cd mobile
npm start
```

Both apps use the same:
- ✅ API endpoints (`/api/v1/*`)
- ✅ Database
- ✅ Authentication system
- ✅ Translation keys
- ✅ Business logic

### Environment Configuration

#### Development (localhost)

**Android Emulator**:
```env
API_URL=http://10.0.2.2:3000/api
```

**iOS Simulator**:
```env
API_URL=http://localhost:3000/api
```

**Physical Device** (same WiFi network):
```env
API_URL=http://192.168.1.100:3000/api  # Your computer's IP
```

To find your computer's IP:
- **macOS/Linux**: `ifconfig | grep inet`
- **Windows**: `ipconfig`

#### Staging
```env
API_URL=https://staging.wampums.ca/api
```

#### Production
```env
API_URL=https://wampums.ca/api
```

### API Client Usage

All API endpoints are available as functions:

```javascript
import { getParticipants, createParticipant } from '../api/api-endpoints';

// Get all participants
const response = await getParticipants();
if (response.success) {
  const participants = response.data;
}

// Create participant
const newParticipant = await createParticipant({
  firstName: 'John',
  lastName: 'Doe',
  birthdate: '2010-05-15',
});
```

See `WEB_TO_RN_MAPPING.md` for complete API documentation.

### Translations

Add translations using the same keys as the web app:

```javascript
import { translate as t } from '../i18n';

// Use translation
<Text>{t('common.save')}</Text>
<Text>{t('auth.loginTitle')}</Text>
```

**Translation files** (to be added):
- `assets/lang/en.json` - English translations
- `assets/lang/fr.json` - French translations

Copy from main project's `lang/` directory.

### Storage

Use `StorageUtils` for all data persistence:

```javascript
import StorageUtils from '../utils/StorageUtils';

// Store data
await StorageUtils.setItem('lastViewedParticipant', participant.id);

// Retrieve data
const participantId = await StorageUtils.getItem('lastViewedParticipant');

// Store multiple
await StorageUtils.setStorageMultiple({
  userId: user.id,
  userName: user.name,
});

// Clear user data (preserves device token and language)
await StorageUtils.clearUserData();
```

**Secure Storage**: JWT tokens are automatically stored securely in device Keychain/Keystore.

### Date & Number Formatting

Use locale-aware utilities:

```javascript
import DateUtils from '../utils/DateUtils';
import NumberUtils from '../utils/NumberUtils';

// Format date
const formattedDate = DateUtils.formatDate(participant.birthdate);
// "2010-05-15"

// Format currency
const formattedFee = NumberUtils.formatCurrency(45.50);
// "$45.50" (en) or "45,50 $" (fr)

// Relative date
const relativeTime = DateUtils.formatRelativeDate(activity.date);
// "in 3 days"
```

### Input Sanitization

Always sanitize user input:

```javascript
import SecurityUtils from '../utils/SecurityUtils';

// Sanitize text input
const cleanName = SecurityUtils.sanitizeName(userInput);

// Sanitize email
const cleanEmail = SecurityUtils.sanitizeEmail(emailInput);

// Deep sanitize object
const cleanData = SecurityUtils.deepSanitize(formData);
```

---

## 📱 Building for Production

### iOS

1. **Configure app.json**:
   ```json
   {
     "expo": {
       "ios": {
         "bundleIdentifier": "ca.wampums.mobile"
       }
     }
   }
   ```

2. **Build**:
   ```bash
   expo build:ios
   ```

### Android

1. **Configure app.json**:
   ```json
   {
     "expo": {
       "android": {
         "package": "ca.wampums.mobile"
       }
     }
   }
   ```

2. **Build**:
   ```bash
   expo build:android
   ```

---

## 🧪 Testing

### Manual Testing Checklist

- [ ] Login with valid credentials
- [ ] 2FA verification flow
- [ ] Logout and session clearing
- [ ] Language switching (English ↔ French)
- [ ] Date formatting in both locales
- [ ] Currency formatting in both locales
- [ ] API error handling (401, 500, network errors)
- [ ] Offline behavior (graceful degradation)
- [ ] Touch targets (minimum 44px)

### Device Testing

Test on:
- [ ] iOS simulator (latest)
- [ ] Android emulator (latest)
- [ ] Physical iOS device
- [ ] Physical Android device
- [ ] Different screen sizes (phone, tablet)

---

## 🐛 Troubleshooting

### "Network request failed"

**Problem**: Mobile app can't reach backend.

**Solution**:
1. Check `.env` file has correct API_URL
2. For Android emulator, use `10.0.2.2` not `localhost`
3. For physical device, use computer's IP address on same WiFi
4. Ensure backend server is running
5. Check firewall settings

### "Session expired" on every request

**Problem**: JWT token not being sent or invalid.

**Solution**:
1. Check login flow stores token properly
2. Verify `StorageUtils.setJWT()` is being called
3. Check API client adds Authorization header
4. Clear app data and login again

### Translations not loading

**Problem**: Translation keys showing instead of text.

**Solution**:
1. Ensure `initI18n()` is called before app renders
2. Check translation JSON files exist in `assets/lang/`
3. Verify translation keys match web app keys
4. Check API endpoint `/api/translations` is accessible

### API returns 401 Unauthorized

**Problem**: Backend rejects requests.

**Solution**:
1. Ensure JWT token is valid and not expired
2. Check `x-organization-id` header is being sent
3. Verify backend authentication middleware
4. Test same endpoint with Postman/curl

---

## 📚 Resources

- **Web to RN Mapping**: See `WEB_TO_RN_MAPPING.md`
- **Frontend Audit**: See `/docs/rn-frontend-audit.md`
- **Expo Documentation**: https://docs.expo.dev/
- **React Native Documentation**: https://reactnative.dev/
- **i18n-js Documentation**: https://github.com/fnando/i18n-js

---

## 🗺️ Roadmap

### Phase 1: Foundation (Current)
- [x] Project setup and structure
- [x] API client and endpoints
- [x] Authentication (login, 2FA, logout)
- [x] Secure storage
- [x] Internationalization (en/fr)
- [x] Utility modules (date, number, security)
- [x] Basic screens (login, dashboard)
- [x] Shared components

### Phase 2: Core Features
- [ ] Navigation system (React Navigation)
- [ ] Parent dashboard
- [ ] Participants management
- [ ] Activities and carpools
- [ ] Finance and payments
- [ ] Offline support
- [ ] Push notifications
- [ ] Form builder integration

### Phase 3: Advanced Features
- [ ] Medication management
- [ ] Permission slips
- [ ] Reports and analytics
- [ ] Badge system
- [ ] Resources and equipment
- [ ] Calendar integration
- [ ] Biometric authentication

### Phase 4: Polish
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Error tracking (Sentry)
- [ ] Analytics
- [ ] App store submission

---

## 🤝 Contributing

1. Follow existing code structure and patterns
2. Use same API endpoints as web app
3. Maintain bilingual support
4. Sanitize all user input
5. Use locale-aware formatting
6. Test on both iOS and Android
7. Keep touch targets ≥ 44px

---

## 📄 License

Same as main Wampums project.

---

**Questions?** Refer to `WEB_TO_RN_MAPPING.md` for detailed utility mappings or check `/docs/rn-frontend-audit.md` for API endpoints.
