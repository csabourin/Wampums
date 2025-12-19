# Google Chat Integration Setup Guide

This guide explains how to integrate Google Chat with Wampums to broadcast announcements to your organization members (300+ users).

## 🎯 Why Google Chat for Large Organizations?

For organizations with 300+ members, Google Chat offers an efficient broadcast solution:

- **Single Message Broadcast**: Send 1 message that reaches all 300 members
- **No Rate Limits**: Unlike DMs (limited to ~60/minute), Space broadcasts have no practical limits
- **Google Group Integration**: Use existing Google Groups for automatic member synchronization
- **Professional**: Official Google Workspace integration

## 📋 Prerequisites

- Google Workspace account (or Google Cloud account)
- Admin access to your organization's Google Workspace
- Admin access to your Wampums organization

## 🚀 Setup Steps

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Create Project"
3. Name your project (e.g., "Wampums Bot")
4. Note the Project ID

### Step 2: Enable Google Chat API

1. In your Google Cloud Project, go to "APIs & Services" > "Library"
2. Search for "Google Chat API"
3. Click "Enable"

### Step 3: Create a Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Name it (e.g., "wampums-chat-bot")
4. Grant it the role "Service Account User"
5. Click "Done"

### Step 4: Create and Download Service Account Key

1. Click on the service account you just created
2. Go to the "Keys" tab
3. Click "Add Key" > "Create New Key"
4. Choose "JSON" format
5. Click "Create"
6. **Save this JSON file securely** - you'll need it for Step 7

### Step 5: Configure Google Chat Bot

1. In Google Cloud Console, go to "APIs & Services" > "Google Chat API"
2. Click "Configuration"
3. Enter:
   - **App name**: Wampums Announcements
   - **Avatar URL**: (optional) URL to your organization's logo
   - **Description**: Annonces pour votre organisation
4. Under "Functionality":
   - Check "Receive 1:1 messages" (optional)
   - Check "Join spaces and group conversations"
5. Under "Connection settings":
   - Select "Cloud Pub/Sub" or "HTTP endpoint" (Cloud Pub/Sub recommended for production)
   - For HTTP endpoint: Enter your Wampums server URL + `/api/google-chat/webhook`
6. Under "Visibility":
   - Select "Make this Chat app available to specific people and groups in [YOUR DOMAIN]"
7. Click "Save"

### Step 6: Create Google Chat Space (Recommended for 300+ Members)

#### Option A: Using Google Groups (Recommended)

1. In [Google Admin Console](https://admin.google.com), go to "Groups"
2. Create a new group (e.g., `tous-membres@votreorganisation.org`)
3. Add all 300 members to this group
4. In Google Chat, create a new Space:
   - Click "+" > "Create a space"
   - Name it "Annonces" (or your preferred name)
   - Add the Google Group as a member
5. Add your bot to the Space:
   - In the Space, click "Add people & apps"
   - Search for "Wampums Announcements"
   - Click "Add"
6. Copy the Space URL - you'll need the Space ID from it

#### Option B: Direct Member Addition (Not recommended for 300+ users)

1. Create a Space in Google Chat
2. Add your bot
3. Manually add members (tedious for 300+ users)

### Step 7: Configure Wampums

1. Log in to Wampums as an **admin**
2. Make a POST request to configure Google Chat:

```bash
curl -X POST https://your-wampums-server.com/api/google-chat/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "type": "service_account",
      "project_id": "your-project-id",
      "private_key_id": "...",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
      "client_email": "your-bot@your-project.iam.gserviceaccount.com",
      "client_id": "...",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": "..."
    }
  }'
```

Or use the Wampums UI (if available) to upload the JSON file.

### Step 8: Register the Broadcast Space

1. Get the Space ID from the Space URL:
   - Space URL format: `https://mail.google.com/chat/u/0/#chat/space/AAAA...`
   - Space ID is: `spaces/AAAA...`

2. Register the Space in Wampums:

```bash
curl -X POST https://your-wampums-server.com/api/google-chat/spaces \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "spaceId": "spaces/AAAAxxxxxxx",
    "spaceName": "Annonces",
    "isBroadcastSpace": true,
    "description": "Espace pour les annonces de l'organisation"
  }'
```

## 📤 Sending Announcements

### Via Wampums Announcements System

When you create an announcement in Wampums, it will automatically be sent to:
- Email
- Web Push Notifications
- WhatsApp (if configured)
- **Google Chat** (if configured)

### Via API (Direct Broadcast)

```bash
curl -X POST https://your-wampums-server.com/api/google-chat/broadcast \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Réunion importante",
    "message": "Bonjour à tous,\n\nNous vous rappelons la réunion de demain à 19h.\n\nÀ bientôt!"
  }'
```

### Via API (Specific Space)

```bash
curl -X POST https://your-wampums-server.com/api/google-chat/send-message \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "spaceId": "spaces/AAAAxxxxxxx",
    "subject": "Rappel",
    "message": "Message texte ici"
  }'
```

## 🔍 Verification

1. Check configuration status:

```bash
curl -X GET https://your-wampums-server.com/api/google-chat/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

2. List registered spaces:

```bash
curl -X GET https://your-wampums-server.com/api/google-chat/spaces \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

3. View message history:

```bash
curl -X GET https://your-wampums-server.com/api/google-chat/messages \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🔒 Security Notes

- Service account credentials are stored encrypted in the database
- Only organization admins can configure Google Chat
- Only organization admins can send broadcasts
- Message history is logged for audit purposes

## 📊 Rate Limits

- **Broadcast to Space**: No practical limit (1 API call reaches all members)
- **Direct Messages**: ~60 per minute (not recommended for 300+ users)
- **Message Size**: Maximum 4096 characters

## 🆘 Troubleshooting

### "No broadcast space configured"
- Ensure you've registered a space with `isBroadcastSpace: true`
- Check that the space is active

### "No active Google Chat configuration found"
- Verify credentials were uploaded correctly
- Check that the configuration is active in the database

### "Failed to send message"
- Verify the bot is added to the Space
- Check that the service account has the correct permissions
- Review logs in `logs/google-chat.log`

## 📚 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/google-chat/config` | Configure Google Chat credentials |
| GET | `/api/google-chat/config` | Get configuration status |
| POST | `/api/google-chat/spaces` | Register a Space |
| GET | `/api/google-chat/spaces` | List registered Spaces |
| POST | `/api/google-chat/send-message` | Send message to specific Space |
| POST | `/api/google-chat/broadcast` | Broadcast to default Space |
| GET | `/api/google-chat/messages` | View message history |

## 🎓 Best Practices

1. **Use Google Groups**: For 300+ members, create a Google Group and add it to the Space
2. **Single Broadcast Space**: Designate one Space as the broadcast space for consistency
3. **Test First**: Test with a small Space before broadcasting to all members
4. **Message Format**: Keep messages concise and clear
5. **Monitor Logs**: Check `logs/google-chat.log` for delivery confirmations

## 🔗 Additional Resources

- [Google Chat API Documentation](https://developers.google.com/chat)
- [Google Cloud Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Google Workspace Admin Help](https://support.google.com/a/answer/33329)
