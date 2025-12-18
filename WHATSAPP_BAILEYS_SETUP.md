# WhatsApp Baileys Integration - Setup Guide

This document provides a comprehensive guide for the WhatsApp Baileys integration, which allows Scout Leaders to connect their personal WhatsApp accounts via QR code scanning to send announcements and notifications.

## ⚠️ IMPORTANT: Safety & Compliance

This integration uses **@whiskeysockets/baileys**, an unofficial WhatsApp Web API. To avoid getting banned:

### Critical Safety Rules

1. **No Mass Broadcasts**: Add random delays (2-5 seconds) between messages
2. **Contact Lists Only**: Only send to people who have saved the Scout Leader's number
3. **Warm Up New Numbers**: Use new SIM cards manually for a few days before automation
4. **Rate Limits**: Maximum ~1000 messages per day per number
5. **Never Skip Delays**: The built-in random delay (2-5 seconds) is mandatory

### Legal Considerations

- This is an **unofficial API** and violates WhatsApp's Terms of Service
- Use at your own risk
- Recommended for small organizations only
- Consider official WhatsApp Business API for larger deployments

## 📋 Prerequisites

- Node.js 14+ installed
- PostgreSQL database access
- Active internet connection
- Scout Leader's personal phone with WhatsApp installed

## 🚀 Installation & Setup

### 1. Database Migration

Run the migration to create the WhatsApp connections table:

```bash
# Using psql directly
psql $DATABASE_URL -f migrations/add_whatsapp_baileys_integration.sql

# OR using npm migration script
npm run migrate:up
```

This creates the `whatsapp_baileys_connections` table to store connection status and session data.

### 2. Environment Variables

No additional environment variables are required! The integration works alongside the existing Twilio WhatsApp setup as a fallback.

**Optional**: Set `CORS_ORIGIN` if you need to restrict Socket.io connections:

```bash
CORS_ORIGIN=https://yourdomain.com
```

### 3. Start the Server

The integration is automatically initialized when the server starts:

```bash
npm start
```

You should see:
```
Server running on 0.0.0.0:5000
Socket.io enabled for real-time WhatsApp QR codes
WhatsApp connections restored
```

## 📱 User Flow: How Scout Leaders Connect WhatsApp

### Step 1: Navigate to Account Settings

Scout Leaders (with `admin` or `animation` role) should:

1. Log into Wampums
2. Navigate to **Account Settings** (usually at `/account-info`)
3. Scroll down to the **WhatsApp Connection (Baileys)** section

### Step 2: Initiate Connection

1. Click the **"Connect WhatsApp"** button
2. A QR code will appear within a few seconds
3. The QR code is delivered in real-time via Socket.io (no page refresh needed!)

### Step 3: Scan QR Code with WhatsApp

On their phone:

1. Open **WhatsApp**
2. Go to **Settings** → **Linked Devices**
3. Tap **"Link a Device"**
4. Scan the QR code displayed on screen

### Step 4: Connection Confirmed

- The page automatically updates when connection is successful
- The connected phone number is displayed
- Status badge changes from "Disconnected" to "Connected"

### Step 5: Send Test Message (Optional)

Scout Leaders can verify the connection by:

1. Entering a phone number in E.164 format (e.g., `+15551234567`)
2. Typing a test message
3. Clicking **"Send Test Message"**
4. Checking their phone to confirm the message was sent

## 🔧 Technical Architecture

### Components

1. **Backend Service**: `/services/whatsapp-baileys.js`
   - Manages WhatsApp connections using Baileys
   - Handles QR code generation
   - Stores session data in filesystem
   - Implements rate limiting (2-5 second delays)

2. **API Endpoints**: `/routes/whatsapp-baileys.js`
   - `POST /api/v1/whatsapp/baileys/connect` - Initiate connection (generates QR)
   - `POST /api/v1/whatsapp/baileys/disconnect` - Disconnect WhatsApp
   - `GET /api/v1/whatsapp/baileys/status` - Check connection status
   - `POST /api/v1/whatsapp/baileys/test` - Send test message

3. **Socket.io Integration**: Real-time QR code delivery
   - Authenticated via JWT token
   - Organization-scoped rooms (`org-{organizationId}`)
   - Events: `whatsapp-qr`, `whatsapp-connected`, `whatsapp-disconnected`

4. **Frontend Module**: `/spa/modules/whatsapp-connection.js`
   - Displays QR code in real-time
   - Shows connection status
   - Provides test message interface
   - Integrated into Account Settings page

5. **Database Schema**: `whatsapp_baileys_connections` table
   ```sql
   - organization_id (unique)
   - is_connected (boolean)
   - connected_phone_number (E.164 format)
   - session_data (encrypted, base64)
   - last_connected_at
   - last_disconnected_at
   ```

6. **Session Storage**: `/whatsapp-sessions/org-{organizationId}/`
   - Each organization has a dedicated folder
   - Stores Baileys authentication credentials
   - Automatically cleaned up on disconnect

### Message Flow

```
Announcement Created
    ↓
Check: Baileys Connected for Organization?
    ↓
YES: Send via Baileys (with 2-5s random delay)
    ↓
FAIL: Fallback to Twilio WhatsApp
    ↓
Log delivery status in announcement_logs
```

### Integration with Existing WhatsApp

The integration smartly chooses the best method:

1. **Baileys (preferred)**: If organization has connected WhatsApp via QR code
2. **Twilio (fallback)**: If Baileys unavailable or fails

Updated function signature in `utils/index.js`:
```javascript
sendWhatsApp(phoneNumber, message, organizationId, whatsappService)
```

## 🎯 Usage: Sending Announcements via WhatsApp

Once connected, announcements automatically use Baileys:

### Via Announcements Page

1. Navigate to **Announcements**
2. Create a new announcement
3. Select recipient roles (must include users with `whatsapp_phone_number` set)
4. Click **"Send Now"** or **"Schedule"**
5. WhatsApp messages sent automatically via Baileys (if connected)

### Programmatically

```javascript
const whatsappService = require('./services/whatsapp-baileys');
const service = new WhatsAppBaileysService(pool);

// Check if connected
const isConnected = await service.isConnected(organizationId);

// Send message
if (isConnected) {
  await service.sendMessage(
    organizationId,
    '+15551234567', // E.164 format
    'Hello from Wampums!'
  );
}
```

## 🔍 Monitoring & Troubleshooting

### Check Connection Status

**Via UI**: Navigate to Account Settings → WhatsApp Connection section

**Via API**:
```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:5000/api/v1/whatsapp/baileys/status
```

### Logs

WhatsApp service logs are written to:
- **Console**: Real-time server logs
- **File**: `whatsapp-baileys.log` (Winston logger)

Important log entries:
- QR code generation: `QR code generated for organization X`
- Connection success: `WhatsApp connected successfully for organization X`
- Message sent: `Message sent successfully to +XXX for org X`
- Errors: `Error sending WhatsApp message for org X`

### Common Issues

#### 1. QR Code Not Appearing

**Symptoms**: Button clicked but QR code doesn't show

**Solutions**:
- Check browser console for Socket.io connection errors
- Verify JWT token is valid
- Check server logs for QR generation errors
- Try refreshing the page and clicking again

#### 2. Connection Drops Frequently

**Symptoms**: Status shows "Connected" then "Disconnected" repeatedly

**Solutions**:
- Check internet connection stability
- Verify phone stays connected to internet
- WhatsApp may be limiting the connection - wait 24 hours before reconnecting
- Consider using a dedicated phone/SIM for this purpose

#### 3. Messages Not Sending

**Symptoms**: Announcements show as sent but not received

**Solutions**:
- Verify recipient has Scout Leader's number saved
- Check if number is blocked by WhatsApp
- Verify `whatsapp_phone_number` is set correctly in users table
- Check rate limiting - may need to wait between messages

#### 4. Database Connection Errors

**Symptoms**: "organization_id references organizations" error

**Solutions**:
- Ensure `organizations` table exists
- Verify foreign key constraints
- Check database permissions

### Reconnecting After Disconnect

If the connection is lost or intentionally disconnected:

1. Go to **Account Settings**
2. Click **"Connect WhatsApp"** again
3. Scan the new QR code
4. Previous session data is automatically cleaned up

### Restoring Connections After Server Restart

The service automatically restores active connections when the server starts:

```javascript
// In api.js
server.listen(PORT, HOST, async () => {
  await whatsappService.restoreConnections();
});
```

This checks the database for organizations with `is_connected = true` and attempts to restore their sessions from the filesystem.

## 🛡️ Security Considerations

### Authentication

- **Socket.io**: Authenticated via JWT token in handshake
- **API Endpoints**: Protected by existing JWT middleware
- **Role-Based**: Only `admin` and `animation` roles can connect/disconnect

### Session Data

- Stored in filesystem at `/whatsapp-sessions/org-{organizationId}/`
- Contains Baileys authentication credentials
- **Not encrypted in current implementation** (consider adding encryption for production)
- Automatically deleted on disconnect

### Rate Limiting

Built-in safety features:

1. **Random Delay**: 2-5 seconds between messages (see `sendMessage` in service)
2. **Database Logging**: All messages logged in `announcement_logs`
3. **Connection Limits**: One connection per organization

### Recommendations for Production

1. **Encrypt session data** before storing in database
2. **Add IP restrictions** for Socket.io connections
3. **Implement message quotas** per day/hour
4. **Monitor for suspicious activity** (high message volumes)
5. **Use HTTPS/WSS** for all connections
6. **Regular session rotation** (disconnect/reconnect weekly)

## 📊 Database Schema

### whatsapp_baileys_connections

```sql
CREATE TABLE whatsapp_baileys_connections (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  is_connected BOOLEAN DEFAULT FALSE,
  connected_phone_number VARCHAR(20), -- E.164 format
  session_data TEXT, -- Encrypted Baileys credentials
  last_connected_at TIMESTAMP,
  last_disconnected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Indexes

- `idx_whatsapp_baileys_org_id` on `organization_id`
- `idx_whatsapp_baileys_connected` on `organization_id, is_connected` (where `is_connected = true`)

## 🔄 Integration Points

### Modified Files

1. **api.js**
   - Added Socket.io server setup
   - Initialized WhatsApp Baileys service
   - Added Socket.io authentication middleware
   - Changed `app.listen` to `server.listen` for Socket.io support

2. **utils/index.js**
   - Updated `sendWhatsApp()` to accept `organizationId` and `whatsappService`
   - Added `sendWhatsAppViaTwilio()` as fallback method
   - Implements smart routing: Baileys → Twilio

3. **routes/announcements.js**
   - Updated to accept `whatsappService` parameter
   - Passes service to `dispatchAnnouncement()`
   - WhatsApp messages now use Baileys when available

4. **spa/modules/account-info.js**
   - Integrated WhatsApp connection module
   - Displays connection UI in account settings

### New Files

1. **services/whatsapp-baileys.js** - Core WhatsApp service
2. **routes/whatsapp-baileys.js** - API endpoints
3. **spa/modules/whatsapp-connection.js** - Frontend UI
4. **migrations/add_whatsapp_baileys_integration.sql** - Database schema

## 🎨 Frontend Customization

### Styling the WhatsApp Section

Add custom styles in your CSS:

```css
.whatsapp-connection-section {
  border: 2px solid #25D366; /* WhatsApp green */
  border-radius: 8px;
  padding: 20px;
  margin: 20px 0;
}

.status-badge.connected {
  background-color: #25D366;
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
}

.status-badge.disconnected {
  background-color: #dc3545;
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
}

#whatsapp-qr-code img {
  border: 4px solid #25D366;
  border-radius: 12px;
  padding: 10px;
  background: white;
}
```

### Translations

Add translations in your translation files:

```javascript
{
  "whatsapp_connection_title": "WhatsApp Connection",
  "whatsapp_connect_button": "Connect WhatsApp",
  "scan_qr_code": "Scan QR Code with WhatsApp",
  "whatsapp_connected_success": "WhatsApp connected successfully!",
  "whatsapp_disconnected_success": "WhatsApp disconnected successfully",
  // ... etc
}
```

## 🚦 Testing Checklist

### Pre-Deployment Testing

- [ ] Database migration runs successfully
- [ ] Server starts without errors
- [ ] Socket.io connects from frontend
- [ ] QR code appears when "Connect" clicked
- [ ] Scanning QR code updates status in real-time
- [ ] Test message sends successfully
- [ ] Disconnect button works
- [ ] Reconnection after disconnect works
- [ ] Server restart restores active connections
- [ ] Announcements use Baileys when connected
- [ ] Fallback to Twilio works when Baileys unavailable

### User Acceptance Testing

- [ ] Scout Leader can connect WhatsApp easily
- [ ] QR code instructions are clear
- [ ] Status updates are visible
- [ ] Test messages are received on phone
- [ ] Announcements arrive via WhatsApp
- [ ] Disconnection is clear and final
- [ ] No confusion between Twilio and Baileys methods

## 📞 Support & Maintenance

### Updating Baileys

Keep the library up to date for compatibility:

```bash
npm update @whiskeysockets/baileys
```

**Warning**: Major updates may break session compatibility. Test thoroughly!

### Monitoring Health

Create a monitoring endpoint (optional):

```javascript
router.get('/v1/whatsapp/baileys/health', async (req, res) => {
  const stats = {
    activeConnections: whatsappService.connections.size,
    organizations: []
  };

  for (const [orgId, conn] of whatsappService.connections) {
    stats.organizations.push({
      id: orgId,
      connected: conn.isConnected,
      phone: conn.sock?.user?.id
    });
  }

  res.json({ success: true, data: stats });
});
```

### Backup Considerations

**Session Data**:
- Located in `/whatsapp-sessions/`
- Should be backed up if you want to preserve connections across server migrations
- Can be excluded from backups if you're okay with rescanning QR codes

**Database**:
- `whatsapp_baileys_connections` table should be included in regular backups
- Contains connection status and metadata

## 🎯 Next Steps & Enhancements

### Potential Improvements

1. **Encrypt session data** using crypto before storing
2. **Multi-device support** - allow multiple phones per organization
3. **Message templates** - predefined WhatsApp message formats
4. **Analytics dashboard** - track delivery rates, failures
5. **Scheduled disconnections** - auto-disconnect after X hours of inactivity
6. **Webhook notifications** - notify admins when connection drops
7. **Message queuing** - queue messages during disconnection
8. **Media support** - send images, PDFs via WhatsApp

### Migration to Official API

For larger deployments, consider migrating to:

- **WhatsApp Business API** (official, paid)
- **Twilio WhatsApp Business** (already integrated as fallback)
- **360Dialog** or similar providers

This Baileys integration serves as a bridge for small organizations until they're ready for the official API.

## 📝 License & Disclaimer

This integration uses **@whiskeysockets/baileys**, an unofficial WhatsApp Web API client.

**Disclaimer**:
- Not endorsed by WhatsApp or Meta
- Use at your own risk
- May violate WhatsApp Terms of Service
- Accounts may be banned without warning
- No warranty or guarantee of functionality

**Recommended**: Use only for small-scale, internal communications with proper consent from recipients.

---

## 🙋 FAQ

### Q: Can I use this for marketing?
**A**: No. This violates WhatsApp's Terms of Service. Use the official WhatsApp Business API.

### Q: How many messages can I send per day?
**A**: Conservative limit is ~1000 messages per day with 2-5 second delays. Exceeding this may result in bans.

### Q: What happens if my phone loses internet?
**A**: The connection will drop and status will update to "Disconnected". Reconnect by scanning QR code again.

### Q: Can multiple organizations share one WhatsApp account?
**A**: No. Each organization needs its own WhatsApp account/phone number.

### Q: Is this secure?
**A**: Session data is stored locally. For production, add encryption. Always use HTTPS/WSS.

### Q: Does this work with WhatsApp Business app?
**A**: Yes! You can connect using WhatsApp or WhatsApp Business.

### Q: What if I want to disconnect temporarily?
**A**: Click "Disconnect" in Account Settings. You'll need to rescan QR code to reconnect.

---

**Need Help?** Check the logs in `whatsapp-baileys.log` or open an issue on GitHub.
