# Account Information Page - UI Design Documentation

## Page Layout

### Header
```
🏠 [Home Icon - links to dashboard]

Account Information
═══════════════════════════════════════════════════════════
```

### Section 1: Full Name
```
┌─────────────────────────────────────────────────────────┐
│ Full Name                                                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Full Name                                                │
│ ┌──────────────────────────────────────────────────┐   │
│ │ John Doe                                         │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──────────────────┐                                    │
│ │  Update Name     │                                    │
│ └──────────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Section 2: Email Address
```
┌─────────────────────────────────────────────────────────┐
│ Email Address                                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ ⚠️ Changing your email will log you out. You will  │ │
│ │    need to log in again with your new email.       │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ Email                                                    │
│ ┌──────────────────────────────────────────────────┐   │
│ │ john.doe@example.com                             │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──────────────────┐                                    │
│ │  Update Email    │                                    │
│ └──────────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Section 3: Change Password
```
┌─────────────────────────────────────────────────────────┐
│ Change Password                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Current Password                                         │
│ ┌──────────────────────────────────────────────────┐   │
│ │ ••••••••                                         │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ New Password                                             │
│ ┌──────────────────────────────────────────────────┐   │
│ │ ••••••••                                         │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ Confirm New Password                                     │
│ ┌──────────────────────────────────────────────────┐   │
│ │ ••••••••                                         │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──────────────────┐                                    │
│ │ Change Password  │                                    │
│ └──────────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Mobile View (320px - 767px)

### Characteristics
- Full width sections (no side margins beyond padding)
- Stacked layout (one column)
- Touch-friendly buttons (44px minimum height)
- Large, readable text (16px+ for inputs)
- Clear visual separation between sections

### Example Mobile Layout
```
┌───────────────────────────┐
│ 🏠                        │
│                           │
│ Account Information       │
│                           │
│ ┌───────────────────────┐ │
│ │ Full Name             │ │
│ │                       │ │
│ │ Full Name             │ │
│ │ [John Doe          ]  │ │
│ │                       │ │
│ │ [   Update Name   ]   │ │
│ └───────────────────────┘ │
│                           │
│ ┌───────────────────────┐ │
│ │ Email Address         │ │
│ │                       │ │
│ │ ⚠️ Warning text...     │ │
│ │                       │ │
│ │ Email                 │ │
│ │ [john@example.com ]   │ │
│ │                       │ │
│ │ [  Update Email   ]   │ │
│ └───────────────────────┘ │
│                           │
│ ┌───────────────────────┐ │
│ │ Change Password       │ │
│ │                       │ │
│ │ Current Password      │ │
│ │ [••••••••        ]    │ │
│ │                       │ │
│ │ New Password          │ │
│ │ [••••••••        ]    │ │
│ │                       │ │
│ │ Confirm Password      │ │
│ │ [••••••••        ]    │ │
│ │                       │ │
│ │ [ Change Password ]   │ │
│ └───────────────────────┘ │
└───────────────────────────┘
```

## Tablet/Desktop View (768px+)

### Characteristics
- Centered content with max-width of 800px
- More padding and spacing
- Buttons can be auto-width (not full width)
- Enhanced hover effects

### Example Desktop Layout
```
                 ┌─────────────────────────────────────┐
                 │ 🏠                                  │
                 │                                     │
                 │      Account Information            │
                 │                                     │
                 │  ┌───────────────────────────────┐ │
                 │  │ Full Name                     │ │
                 │  │                               │ │
                 │  │ Full Name                     │ │
                 │  │ [John Doe               ]     │ │
                 │  │                               │ │
                 │  │ [ Update Name ]               │ │
                 │  └───────────────────────────────┘ │
                 │                                     │
                 │  ┌───────────────────────────────┐ │
                 │  │ Email Address                 │ │
                 │  │                               │ │
                 │  │ ⚠️ Warning: Changing email...  │ │
                 │  │                               │ │
                 │  │ Email                         │ │
                 │  │ [john.doe@example.com    ]    │ │
                 │  │                               │ │
                 │  │ [ Update Email ]              │ │
                 │  └───────────────────────────────┘ │
                 │                                     │
                 └─────────────────────────────────────┘
```

## Color Scheme

### Background Colors
- Page background: Light gray (#f5f5f5)
- Section background: White (#fff)
- Warning box: Light yellow (#fff3cd)

### Text Colors
- Primary text: Dark gray (#333)
- Labels: Medium gray (#555)
- Warning text: Dark orange (#856404)

### Button Colors
- Primary button background: Blue (#4c65ae)
- Primary button hover: Darker blue (#3d5290)
- Disabled button: Gray (#ccc)

### Border Colors
- Input borders: Light gray (#ddd)
- Input focus: Blue (#4c65ae)
- Warning box border: Yellow (#ffc107)

## Interaction States

### Input Fields
- **Default**: Light gray border, white background
- **Focus**: Blue border with subtle shadow
- **Invalid**: Red border
- **Disabled**: Gray background, cursor not-allowed

### Buttons
- **Default**: Blue background, white text
- **Hover**: Darker blue, slight scale effect
- **Active**: Even darker, scale down slightly
- **Disabled**: Gray background, reduced opacity
- **Loading**: Disabled with "Loading..." text

### Toast Notifications
Success toast (appears at top of screen):
```
┌─────────────────────────────────────┐
│ ✓ Name updated successfully         │
└─────────────────────────────────────┘
```

Error toast:
```
┌─────────────────────────────────────┐
│ ⚠ Failed to update name             │
└─────────────────────────────────────┘
```

## User Flows

### Flow 1: Update Full Name
1. User sees current name pre-filled
2. User edits name in text field
3. User clicks "Update Name" button
4. Button shows "Loading..." (disabled)
5. Success toast appears: "✓ Name updated successfully"
6. Button returns to normal state
7. Field shows updated name

### Flow 2: Update Email
1. User sees current email pre-filled
2. User sees warning box above form
3. User edits email in field
4. User clicks "Update Email" button
5. Confirmation dialog appears: "⚠️ Changing your email will log you out..."
6. User clicks OK or Cancel
7. If OK:
   - Button shows "Loading..." (disabled)
   - Success toast: "✓ Email updated successfully. Please log in again."
   - 2 second delay
   - Automatic logout and redirect to login page

### Flow 3: Change Password
1. User enters current password
2. User enters new password (8+ chars)
3. User confirms new password
4. Client validates:
   - Passwords match
   - New password is 8+ characters
5. User clicks "Change Password"
6. Button shows "Loading..." (disabled)
7. API verifies current password
8. If correct:
   - Success toast: "✓ Password changed successfully"
   - Form clears all fields
9. If incorrect:
   - Error toast: "⚠ Current password is incorrect"
   - Form remains populated

## Accessibility Features

### Keyboard Navigation
- Tab through all form fields in logical order
- Enter key submits focused form
- Escape key closes dialogs
- Focus visible with blue outline

### Screen Reader Support
- Proper ARIA labels on all inputs
- ARIA live regions for toast messages
- Semantic HTML (nav, main, section, form)
- Form validation errors announced

### Visual Accessibility
- High contrast mode support
- Focus indicators (3px blue outline)
- Minimum 44px touch targets
- Clear visual hierarchy
- Sufficient color contrast (WCAG AA)

## Responsive Breakpoints

### Mobile (320px - 767px)
- Full-width sections
- Full-width buttons
- 20px padding
- 1.25rem section titles

### Tablet/Desktop (768px - 1023px)
- Max-width 500px forms
- Auto-width buttons (min 200px)
- 32px padding
- 1.5rem section titles

### Large Desktop (1024px+)
- Max-width 800px sections
- Centered layout
- 40px bottom margins
- Enhanced spacing

## Example Success Scenarios

### Scenario 1: First-time user updates their name
```
Initial state:
Name field: "User"

After update:
Name field: "John Smith"
Toast: ✓ Name updated successfully
```

### Scenario 2: User changes email
```
Initial state:
Email: "old@example.com"

After update:
Toast: ✓ Email updated successfully. Please log in again.
[2 second pause]
Redirects to: /login
```

### Scenario 3: User changes password
```
Form state:
Current: ••••••••
New: ••••••••••
Confirm: ••••••••••

After submit:
Form cleared
Toast: ✓ Password changed successfully
```

## Error Scenarios

### Error 1: Name too short
```
User enters: "A"
Client validation: Red border on input
Error message not submitted (HTML5 validation)
```

### Error 2: Email already exists
```
User enters: "existing@example.com"
Clicks submit
API response: 400 Bad Request
Toast: ⚠ Email address already in use
```

### Error 3: Password mismatch
```
New password: "newpass123"
Confirm: "newpass124"
Client validation before submit
Toast: ⚠ Passwords do not match
```

### Error 4: Wrong current password
```
User enters wrong current password
Clicks submit
API validates and rejects
Toast: ⚠ Current password is incorrect
Form remains populated (except passwords cleared)
```

## Loading States

### Button Loading State
```
Normal:     [ Update Name ]
Loading:    [ Loading...  ] (grayed out, cursor wait)
```

### Page Loading
```
On initial load:
Shows loading indicator
Fetches user data from API
Renders form with data
```

## Technical Implementation Notes

### CSS Classes Used
- `.account-section` - Main section container
- `.account-form` - Form wrapper
- `.form-group` - Input group (label + input)
- `.btn` - Button base class
- `.btn-primary` - Primary action button
- `.warning-box` - Yellow warning container
- `.home-icon` - Home button at top

### Key Features
- CSS Grid/Flexbox for layout
- CSS transitions for hover effects
- Media queries for responsive design
- CSS variables for colors (could be added)
- BEM naming convention for classes

## Testing UI Elements

### Visual Regression Testing Points
1. Home icon placement and size
2. Section spacing and alignment
3. Form input styling and focus states
4. Button states (normal, hover, disabled)
5. Warning box appearance
6. Toast notification positioning
7. Mobile vs desktop layout differences
8. Touch target sizes on mobile

### Cross-browser Testing
- Chrome (latest)
- Firefox (latest)
- Safari (latest, iOS)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## French Language Example

All text translates to French seamlessly:
```
Informations du compte
══════════════════════════════════

Nom complet
┌────────────────────────────┐
│ Jean Dupont                │
└────────────────────────────┘

[ Mettre à jour le nom ]
```

The UI layout remains identical in both languages.
