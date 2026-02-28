# Wampums Scout Management Application

**Version:** 3.1.0  
**Last Updated:** February 2026

## Overview
Wampums is a comprehensive, bilingual (English/French) scout management system designed for scouting groups. It provides a centralized platform for managing scout activities, tracking progress, and facilitating communication between scout leaders, parents, and scouts.

**Tech Stack:**
- **Backend:** Node.js + Express, PostgreSQL
- **Frontend:** Vite, Vanilla JavaScript (ES6 modules), Progressive Web App
- **Mobile:** Expo / React Native
- **Architecture:** Multi-tenant SaaS, RESTful API with JWT authentication

## Features and Advantages

### From the Organization's Perspective:

1. **Centralized Management**
   - Manage all scout-related activities from a single platform
   - Maintain a database of all scouts, leaders, and parents

2. **Group Management**
   - Create and manage scout groups (dens)
   - Assign scouts to specific groups
   - Designate group leaders and second leaders

3. **Activity Planning**
   - Plan and schedule scout meetings and activities
   - Create detailed activity logs with responsibilities and materials needed

4. **Progress Tracking**
   - Monitor individual and group progress
   - Track badge achievements and honors

5. **Attendance Management**
   - Record and track attendance for all activities
   - Generate attendance reports

6. **Point System**
   - Implement a customizable point system for achievements and participation
   - Track individual and group points

7. **Document Management**
   - Store and manage important documents like health forms and risk acceptance forms
   - Ensure all required paperwork is up-to-date

8. **Communication Tools**
   - Send notifications to parents and scouts
   - Share news and updates through the platform

9. **Reporting**
   - Generate various reports including attendance, progress, and participation
   - Export data for further analysis

10. **Multi-language Support**
    - Support for both English and French interfaces

11. **User Management**
    - Manage different user roles (admin, animation team, parents)
    - Control access to sensitive information

12. **Calendar Management**
    - Manage scout calendar sales
    - Track calendar distribution and payments

### Advantages for the Animation Team:

1. **Streamlined Planning**
   - Easy-to-use interface for planning meetings and activities
   - Templates for common activities

2. **Real-time Updates**
   - Access up-to-date information on scouts' progress and attendance
   - Immediate visibility of any changes or updates made by parents

3. **Efficient Communication**
   - Quickly send messages or alerts to all parents or specific groups
   - Maintain a log of all communications

4. **Progress Monitoring**
   - Track each scout's progress towards badges and achievements
   - Identify areas where scouts may need additional support

5. **Resource Management**
   - Keep track of required materials for activities
   - Assign responsibilities to team members

6. **Attendance Tracking**
   - Easily mark attendance for each meeting or event
   - View attendance trends and patterns

7. **Point Management**
   - Award points for participation and achievements
   - View leaderboards and group standings

8. **Document Access**
   - Quick access to important documents like health forms
   - Ensure all necessary paperwork is completed and up-to-date

9. **Reporting Tools**
   - Generate reports on various aspects of the scout program
   - Use data to inform decision-making and program improvements

10. **Mobile Access**
    - Access the system on-the-go via mobile devices
    - Update information in real-time during scout activities

### From the Parents' Perspective:

1. **Easy Registration**
   - Register children for scout activities online
   - Update personal information as needed

2. **Activity Tracking**
   - View upcoming activities and events
   - Access details about each activity (time, location, required materials)

3. **Progress Monitoring**
   - Track child's progress in the scout program
   - View badges earned and points accumulated

4. **Communication**
   - Receive important notifications and updates
   - Easy communication with scout leaders

5. **Document Submission**
   - Submit required documents electronically (health forms, permission slips)
   - Receive reminders for document updates

6. **Attendance Visibility**
   - View child's attendance record
   - Notify leaders of planned absences

7. **Calendar Management**
   - Purchase and manage scout calendars
   - Track calendar sales progress

8. **Multi-child Management**
   - Manage multiple children in the scout program from a single account

9. **Badge Progress Requests**
   - Submit requests for badge progress on behalf of their child

10. **Health and Safety**
    - Update health information as needed
    - Complete risk acceptance forms electronically

11. **Offline Access**
    - Access key information even without an internet connection

12. **Language Preference**
    - Choose between English and French interfaces

13. **Emergency Contact Management**
    - Update emergency contact information easily
    - Designate primary and secondary contacts

14. **Secure Access**
    - Secure login to protect personal and child's information
    - Control over personal data sharing

## Getting Started

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/csabourin/Wampums.git
cd Wampums

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials and JWT secret

# Run database migrations
npm run migrate:up

# Start the development server
npm run dev:all  # Starts both API (port 3000) and Vite dev server (port 5173)
```

### Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET_KEY` - Secret for JWT token signing

Optional:
- `PORT` - API server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `SENDGRID_API_KEY` - Email service
- `STRIPE_SECRET_KEY` - Payment processing
- `VAPID_PUBLIC` / `VAPID_PRIVATE` - Push notifications

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Development guidelines and coding standards
- **[AGENTS.md](./AGENTS.md)** - Quick reference for AI development agents
- **[devdocs/](./devdocs/)** - Technical documentation and architecture
- **[attached_assets/](./attached_assets/)** - Additional documentation and schemas

## Contributing

Please follow the guidelines in [CLAUDE.md](./CLAUDE.md) for:
- Code quality standards
- API design patterns
- Security best practices
- Testing requirements

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact the development team.

---

This comprehensive system provides a robust platform for managing all aspects of a scout program, enhancing communication, streamlining processes, and improving the overall experience for scouts, parents, and leaders alike.