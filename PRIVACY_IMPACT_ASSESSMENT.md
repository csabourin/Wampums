# Privacy Impact Assessment (PIA)
# Évaluation des facteurs relatifs à la vie privée (EFVP)

**Project/System**: Wampums Scout Management System
**Version**: 1.0
**Assessment Date**: December 12, 2025
**Next Review Date**: December 12, 2026
**Status**: ☐ Draft ☐ Under Review ☑ Approved

---

## Document Control

| Version | Date | Author | Reviewer | Changes |
|---------|------|--------|----------|---------|
| 1.0 | Dec 12, 2025 | [Name] | [Privacy Officer] | Initial assessment |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Description](#2-project-description)
3. [Personal Information Inventory](#3-personal-information-inventory)
4. [Data Flow Analysis](#4-data-flow-analysis)
5. [Privacy Risk Assessment](#5-privacy-risk-assessment)
6. [Compliance Analysis](#6-compliance-analysis)
7. [Risk Mitigation Measures](#7-risk-mitigation-measures)
8. [Residual Risk Assessment](#8-residual-risk-assessment)
9. [Recommendations](#9-recommendations)
10. [Approval and Sign-off](#10-approval-and-sign-off)

---

## 1. Executive Summary

### 1.1 Purpose of Assessment

This Privacy Impact Assessment (PIA) evaluates the privacy risks associated with the Wampums Scout Management System, which collects and processes personal information of minors (scouts) and their parents/guardians. This assessment is required under Quebec's Law 25 (Act to modernize legislative provisions respecting the protection of personal information) due to the sensitive nature of the data processed.

### 1.2 Scope

This PIA covers:
- Collection, use, and disclosure of personal information
- Processing of sensitive health information of minors
- Data storage and security measures
- Third-party data sharing
- Cross-border data transfers (if any)

### 1.3 Summary of Findings

| Risk Category | Initial Risk | After Mitigation | Status |
|---------------|--------------|------------------|--------|
| Unauthorized access to minor data | High | Low | ✅ Mitigated |
| Health data breach | High | Low | ✅ Mitigated |
| Inadequate consent | Medium | Low | ✅ Mitigated |
| Data retention beyond necessity | Medium | Low | ⚠️ In Progress |
| Third-party data exposure | Medium | Low | ✅ Mitigated |

### 1.4 Overall Risk Level

**RESIDUAL RISK: LOW**

The system implements appropriate technical and organizational measures to protect personal information. Recommended enhancements will further reduce risk.

---

## 2. Project Description

### 2.1 System Overview

**Name**: Wampums Scout Management System
**Type**: Progressive Web Application (PWA)
**Purpose**: Digital management platform for scout organizations to manage participant registration, health information, attendance, and communications.

### 2.2 Business Need

Scout organizations require a secure, centralized system to:
- Manage participant registrations and contact information
- Collect and store health information for safety during activities
- Track attendance and badge progress
- Facilitate communication between leaders and parents
- Manage parental consent for activities

### 2.3 Stakeholders

| Stakeholder | Role | Interest |
|-------------|------|----------|
| Scout Groups | Data Controller | Primary system users |
| Parents/Guardians | Data Subjects (Representatives) | Manage children's information |
| Minors (Scouts) | Data Subjects | Whose data is processed |
| Leaders/Animators | Data Users | Access participant information |
| System Administrator | Data Processor | System operation |
| Supabase/AWS | Sub-processor | Data hosting |
| Brevo | Sub-processor | Email delivery |

### 2.4 System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER DEVICES                               │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│   │   Parent    │   │   Leader    │   │   Admin     │           │
│   │   Browser   │   │   Browser   │   │   Browser   │           │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘           │
└──────────┼─────────────────┼─────────────────┼───────────────────┘
           │                 │                 │
           │            HTTPS/TLS              │
           │                 │                 │
┌──────────┼─────────────────┼─────────────────┼───────────────────┐
│          ▼                 ▼                 ▼                   │
│   ┌─────────────────────────────────────────────────────┐       │
│   │              APPLICATION SERVER                      │       │
│   │              (Node.js/Express)                       │       │
│   │   • JWT Authentication    • Role-based Access       │       │
│   │   • Input Validation      • Rate Limiting           │       │
│   │   • XSS Protection        • Security Headers        │       │
│   └──────────────────────────┬──────────────────────────┘       │
│                              │                                   │
│                          SSL/TLS                                 │
│                              │                                   │
│   ┌──────────────────────────┴──────────────────────────┐       │
│   │              SUPABASE (PostgreSQL)                   │       │
│   │              AWS CA-Central (Canada)                 │       │
│   │   • AES-256 Encryption at Rest                      │       │
│   │   • Automatic Backups                               │       │
│   │   • Multi-tenant Isolation                          │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
│                    CANADIAN JURISDICTION                         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ SMTP/TLS
                              ▼
                    ┌─────────────────┐
                    │     BREVO       │
                    │   (Email API)   │
                    │   EU Servers    │
                    └─────────────────┘
```

---

## 3. Personal Information Inventory

### 3.1 Categories of Data Subjects

| Category | Age Range | Vulnerable | Special Protections Required |
|----------|-----------|------------|------------------------------|
| Minor Participants | 7-17 years | Yes | Parental consent, enhanced safeguards |
| Adult Participants | 18+ years | No | Standard protections |
| Parents/Guardians | Adults | No | Standard protections |
| Leaders/Staff | Adults | No | Standard protections |

### 3.2 Personal Information Collected

#### 3.2.1 Basic Identification (All Users)

| Data Element | Required | Sensitivity | Retention |
|--------------|----------|-------------|-----------|
| Full name | Yes | Low | Active membership |
| Email address | Yes | Low | Active account |
| Password (hashed) | Yes | N/A (stored as hash) | Active account |

#### 3.2.2 Minor-Specific Data

| Data Element | Required | Sensitivity | Purpose | Retention |
|--------------|----------|-------------|---------|-----------|
| First name | Yes | Low | Identification | Active membership |
| Last name | Yes | Low | Identification | Active membership |
| Date of birth | Yes | Medium | Age verification, group placement | Active membership |
| Group membership | Yes | Low | Organization | Active membership |

#### 3.2.3 Health Information (Sensitive)

| Data Element | Required | Sensitivity | Purpose | Retention |
|--------------|----------|-------------|---------|-----------|
| Medical conditions | No | **HIGH** | Safety during activities | Annual renewal |
| Allergies | Yes | **HIGH** | Emergency response | Annual renewal |
| Medications | No | **HIGH** | Health management | Annual renewal |
| EpiPen requirement | Yes | **HIGH** | Emergency preparedness | Annual renewal |
| Physical limitations | No | **HIGH** | Activity adaptation | Annual renewal |
| Vaccination status | No | **HIGH** | Health records | Annual renewal |
| Swimming ability | Yes | Medium | Water safety | Annual renewal |
| Family doctor contact | No | Medium | Emergency contact | Annual renewal |

#### 3.2.4 Parent/Guardian Information

| Data Element | Required | Sensitivity | Purpose | Retention |
|--------------|----------|-------------|---------|-----------|
| Full name | Yes | Low | Identification | Active membership |
| Email | Yes | Low | Communication | Active account |
| Home phone | No | Medium | Contact | Active membership |
| Work phone | No | Medium | Emergency contact | Active membership |
| Mobile phone | Yes | Medium | Primary contact | Active membership |
| Relationship to child | Yes | Low | Verification | Active membership |
| Emergency contact status | Yes | Low | Emergency protocol | Active membership |

#### 3.2.5 Consent Records

| Data Element | Required | Sensitivity | Purpose | Retention |
|--------------|----------|-------------|---------|-----------|
| Permission slip signatures | Yes | Medium | Legal consent | Activity + 2 years |
| Risk acceptance | Yes | Medium | Liability | Scout year + 2 years |
| Media consent | No | Medium | Photo/video usage | Until revoked |
| Signature timestamps | Yes | Low | Audit trail | Same as parent record |
| IP address (signing) | Auto | Low | Verification | Same as parent record |

### 3.3 Special Categories of Personal Information

Under Quebec Law 25 and PIPEDA, the following are considered sensitive:

| Category | Collected | Justification |
|----------|-----------|---------------|
| Health information | ✅ Yes | Required for participant safety |
| Biometric data | ❌ No | Not collected |
| Genetic information | ❌ No | Not collected |
| Financial information | ⚠️ Limited | Fee tracking only (no payment card data) |
| Race/ethnicity | ❌ No | Not collected |
| Religious beliefs | ❌ No | Not collected |
| Political opinions | ❌ No | Not collected |
| Sexual orientation | ❌ No | Not collected |
| Criminal records | ❌ No | Not collected |

---

## 4. Data Flow Analysis

### 4.1 Data Collection Points

| Collection Point | Data Collected | Method | Consent Type |
|------------------|----------------|--------|--------------|
| User Registration | Email, name, password | Web form | Explicit (account creation) |
| Participant Registration | Name, DOB, group | Web form | Parental (implicit) |
| Health Form | Medical information | Web form | Explicit parental consent |
| Risk Acceptance | Acknowledgment, signature | Web form | Explicit parental consent |
| Permission Slip | Activity consent | Web form | Explicit parental consent |
| Attendance | Presence records | Leader input | Legitimate interest |
| Badge Progress | Achievement data | Leader/child input | Legitimate interest |

### 4.2 Data Processing Activities

| Activity | Purpose | Legal Basis | Data Minimization |
|----------|---------|-------------|-------------------|
| Registration management | Core service | Contract/Consent | ✅ Only necessary fields |
| Health record storage | Safety | Explicit consent | ✅ Safety-relevant only |
| Communication | Service delivery | Legitimate interest | ✅ Email only |
| Attendance tracking | Activity management | Legitimate interest | ✅ Date/status only |
| Badge management | Service delivery | Legitimate interest | ✅ Achievement data only |
| Permission management | Legal compliance | Consent | ✅ Minimal data |

### 4.3 Data Sharing and Disclosure

| Recipient | Data Shared | Purpose | Legal Basis | Safeguards |
|-----------|-------------|---------|-------------|------------|
| Group Leaders | Participant info, health data | Activity management | Legitimate interest | Role-based access |
| Group Admin | All organization data | Administration | Legitimate interest | Authentication |
| Supabase (AWS) | All data (encrypted) | Hosting | Contract | DPA, encryption |
| Brevo | Email addresses only | Communication | Contract | TLS, DPA |
| SISC (if applicable) | Registration data | Scout organization requirement | Legal obligation | Official channel |

### 4.4 Data Transfers

| Transfer | Destination | Mechanism | Adequacy |
|----------|-------------|-----------|----------|
| Database storage | Canada (AWS CA-Central) | Direct storage | ✅ Domestic |
| Email delivery | EU (Brevo servers) | API call | ✅ GDPR adequate |
| Backups | Canada (AWS) | Automatic | ✅ Domestic |

**Note**: No transfers to jurisdictions without adequate protection.

---

## 5. Privacy Risk Assessment

### 5.1 Risk Assessment Methodology

**Likelihood Scale:**
- 1 = Rare (< 1% chance annually)
- 2 = Unlikely (1-10% chance)
- 3 = Possible (10-50% chance)
- 4 = Likely (50-90% chance)
- 5 = Almost Certain (> 90% chance)

**Impact Scale:**
- 1 = Negligible (Minor inconvenience)
- 2 = Minor (Some distress, easily remedied)
- 3 = Moderate (Significant distress, reversible harm)
- 4 = Major (Serious harm, difficult to remedy)
- 5 = Severe (Irreversible harm, life-altering)

**Risk Score = Likelihood × Impact**

| Score | Risk Level | Action Required |
|-------|------------|-----------------|
| 1-4 | Low | Accept or monitor |
| 5-9 | Medium | Mitigation recommended |
| 10-15 | High | Mitigation required |
| 16-25 | Critical | Immediate action required |

### 5.2 Identified Privacy Risks

#### Risk 1: Unauthorized Access to Minor's Personal Data

| Attribute | Assessment |
|-----------|------------|
| **Description** | Unauthorized person gains access to a minor's personal information |
| **Threat Source** | External attacker, insider threat, compromised credentials |
| **Likelihood (Initial)** | 3 (Possible) |
| **Impact** | 4 (Major - minors are vulnerable) |
| **Initial Risk Score** | **12 (High)** |

**Existing Controls:**
- JWT authentication required
- Role-based access control
- Password hashing (bcrypt)
- Rate limiting on login (5 attempts/15 min)
- HTTPS encryption

**Additional Mitigations:**
- [Implemented] Organization-level data isolation
- [Recommended] Multi-factor authentication for admins
- [Recommended] Session timeout for inactivity

**Residual Risk Score:** **4 (Low)**

---

#### Risk 2: Health Data Breach

| Attribute | Assessment |
|-----------|------------|
| **Description** | Sensitive health information of minors is exposed |
| **Threat Source** | Database breach, application vulnerability, insider |
| **Likelihood (Initial)** | 2 (Unlikely) |
| **Impact** | 5 (Severe - health data of children) |
| **Initial Risk Score** | **10 (High)** |

**Existing Controls:**
- Database encryption at rest (AES-256)
- TLS encryption in transit
- SQL injection prevention (parameterized queries)
- XSS protection (DOMPurify)
- Access limited to authorized roles

**Additional Mitigations:**
- [Implemented] Data stored in Canada only
- [Recommended] Database Row Level Security (RLS)
- [Recommended] Health data access logging

**Residual Risk Score:** **4 (Low)**

---

#### Risk 3: Inadequate Parental Consent

| Attribute | Assessment |
|-----------|------------|
| **Description** | Processing minor's data without proper parental consent |
| **Threat Source** | Process failure, unclear consent, unverified parent |
| **Likelihood (Initial)** | 3 (Possible) |
| **Impact** | 3 (Moderate - regulatory and trust issues) |
| **Initial Risk Score** | **9 (Medium)** |

**Existing Controls:**
- All participant data entered by parent account
- Health forms require explicit submission
- Permission slips with consent checkbox
- Parent-child relationship linking

**Additional Mitigations:**
- [Implemented] Email verification for accounts
- [Recommended] Consent records with timestamps
- [Recommended] Consent renewal reminders

**Residual Risk Score:** **3 (Low)**

---

#### Risk 4: Excessive Data Retention

| Attribute | Assessment |
|-----------|------------|
| **Description** | Personal data retained longer than necessary |
| **Threat Source** | No automated deletion, unclear policy |
| **Likelihood (Initial)** | 4 (Likely) |
| **Impact** | 2 (Minor - increased breach exposure) |
| **Initial Risk Score** | **8 (Medium)** |

**Existing Controls:**
- Data deletion process documented
- Admin can remove participants from organization
- SISC requirements acknowledged

**Additional Mitigations:**
- [Recommended] Automated retention policy enforcement
- [Recommended] Annual data review process
- [Recommended] Inactive account cleanup

**Residual Risk Score:** **4 (Low)**

---

#### Risk 5: Third-Party Data Exposure

| Attribute | Assessment |
|-----------|------------|
| **Description** | Personal data exposed through third-party services |
| **Threat Source** | Supabase breach, Brevo breach, API misconfiguration |
| **Likelihood (Initial)** | 2 (Unlikely) |
| **Impact** | 4 (Major) |
| **Initial Risk Score** | **8 (Medium)** |

**Existing Controls:**
- Reputable service providers (AWS, Supabase, Brevo)
- TLS encryption for all API calls
- Minimal data shared (email only to Brevo)

**Additional Mitigations:**
- [Recommended] Execute formal DPAs with all processors
- [Recommended] Annual vendor security review
- [Implemented] Canadian data residency

**Residual Risk Score:** **3 (Low)**

---

#### Risk 6: Insufficient Breach Response

| Attribute | Assessment |
|-----------|------------|
| **Description** | Inadequate response to a data breach affecting minors |
| **Threat Source** | Process failure, no documented procedure |
| **Likelihood (Initial)** | 3 (Possible - if breach occurs) |
| **Impact** | 4 (Major - regulatory penalties, harm to minors) |
| **Initial Risk Score** | **12 (High)** |

**Existing Controls:**
- Basic error logging
- Contact email available

**Additional Mitigations:**
- [Required] Documented breach response procedure
- [Required] CAI notification template (72-hour requirement)
- [Required] Affected party notification template
- [Recommended] Breach response training

**Residual Risk Score:** **6 (Medium)** - *Requires action*

---

### 5.3 Risk Summary Matrix

| Risk | Initial Score | Residual Score | Status |
|------|---------------|----------------|--------|
| R1: Unauthorized access | 12 (High) | 4 (Low) | ✅ Acceptable |
| R2: Health data breach | 10 (High) | 4 (Low) | ✅ Acceptable |
| R3: Inadequate consent | 9 (Medium) | 3 (Low) | ✅ Acceptable |
| R4: Excessive retention | 8 (Medium) | 4 (Low) | ✅ Acceptable |
| R5: Third-party exposure | 8 (Medium) | 3 (Low) | ✅ Acceptable |
| R6: Breach response | 12 (High) | 6 (Medium) | ⚠️ Action needed |

---

## 6. Compliance Analysis

### 6.1 Quebec Law 25 Compliance

| Requirement | Status | Evidence/Gap |
|-------------|--------|--------------|
| Privacy Officer designation | ⚠️ Needed | Must designate and publish |
| Privacy policy | ✅ Compliant | politique-de-confidentialite.html |
| Consent for minors (under 14) | ✅ Compliant | Parental account management |
| Privacy Impact Assessment | ✅ This document | Current assessment |
| Data portability | ⚠️ Partial | CSV export exists, needs formalization |
| Right to deletion | ✅ Compliant | Documented process |
| Breach notification (72h) | ⚠️ Needed | Procedure required |
| Data residency | ✅ Compliant | AWS CA-Central |
| Transparency | ✅ Compliant | Privacy policy published |

### 6.2 PIPEDA Compliance

| Principle | Status | Evidence |
|-----------|--------|----------|
| Accountability | ⚠️ Partial | Privacy officer needed |
| Identifying Purposes | ✅ Compliant | Purposes stated in policy |
| Consent | ✅ Compliant | Parental consent implemented |
| Limiting Collection | ✅ Compliant | Data minimization practiced |
| Limiting Use/Disclosure | ✅ Compliant | No unauthorized sharing |
| Accuracy | ✅ Compliant | Users can update data |
| Safeguards | ✅ Compliant | Technical measures implemented |
| Openness | ✅ Compliant | Policy publicly available |
| Individual Access | ⚠️ Partial | Need formal request process |
| Challenging Compliance | ✅ Compliant | Contact provided |

### 6.3 PHIPA Considerations (Ontario)

| Best Practice | Status | Notes |
|---------------|--------|-------|
| Minimum necessary | ✅ Compliant | Safety-relevant health data only |
| Secure storage | ✅ Compliant | Encrypted database |
| Access controls | ✅ Compliant | Role-based access |
| Consent | ✅ Compliant | Explicit parental consent |
| Annual renewal | ⚠️ Recommended | Implement health form expiry |

---

## 7. Risk Mitigation Measures

### 7.1 Technical Measures (Implemented)

| Measure | Description | Effectiveness |
|---------|-------------|---------------|
| Encryption at rest | AES-256 via Supabase/AWS | High |
| Encryption in transit | TLS 1.2+ for all connections | High |
| Password hashing | bcrypt with salt | High |
| JWT authentication | Stateless, expiring tokens | High |
| Rate limiting | 5 login attempts/15 min | High |
| Input validation | express-validator | High |
| XSS prevention | DOMPurify sanitization | High |
| SQL injection prevention | Parameterized queries | High |
| Security headers | Helmet.js (CSP, HSTS) | Medium |
| Multi-tenant isolation | Organization ID filtering | High |

### 7.2 Organizational Measures (Implemented)

| Measure | Description | Effectiveness |
|---------|-------------|---------------|
| Role-based access | Admin/Animation/Parent roles | High |
| Privacy policy | Published, covers requirements | Medium |
| Terms of service | User acceptance required | Medium |
| Deletion process | Email-based request | Medium |
| Parental gatekeeping | Parents manage child accounts | High |

### 7.3 Recommended Additional Measures

| Measure | Priority | Effort | Risk Addressed |
|---------|----------|--------|----------------|
| Designate Privacy Officer | High | Low | Accountability |
| Document breach procedure | High | Medium | R6 |
| Implement audit logging | High | Medium | R1, R2 |
| Execute DPAs | High | Low | R5 |
| Database RLS policies | Medium | High | R1, R2 |
| MFA for admins | Medium | Medium | R1 |
| Automated retention | Medium | Medium | R4 |
| Annual consent renewal | Medium | Low | R3 |
| Health form expiry | Medium | Low | R3, R4 |

---

## 8. Residual Risk Assessment

### 8.1 Residual Risk Summary

After implementing existing controls and recommended mitigations:

| Category | Risk Level | Justification |
|----------|------------|---------------|
| Overall Privacy Risk | **LOW** | Strong technical controls, parental consent |
| Minor Data Protection | **LOW** | Parental gatekeeping, access controls |
| Health Data Protection | **LOW** | Encryption, limited access |
| Compliance Risk | **LOW-MEDIUM** | Minor gaps in documentation |
| Reputation Risk | **LOW** | Good privacy practices |

### 8.2 Risk Acceptance Statement

Based on this assessment, the residual privacy risks of the Wampums system are **ACCEPTABLE** provided that:

1. A Privacy Officer is designated within 30 days
2. A breach response procedure is documented within 30 days
3. Data Processing Agreements are executed with Supabase and Brevo within 60 days
4. Audit logging is enhanced within 90 days

---

## 9. Recommendations

### 9.1 Immediate Actions (0-30 days)

| # | Action | Owner | Due Date |
|---|--------|-------|----------|
| 1 | Designate Privacy Officer | Management | [Date] |
| 2 | Publish Privacy Officer contact | Admin | [Date] |
| 3 | Document breach response procedure | Privacy Officer | [Date] |
| 4 | Create CAI notification template | Privacy Officer | [Date] |

### 9.2 Short-term Actions (30-90 days)

| # | Action | Owner | Due Date |
|---|--------|-------|----------|
| 5 | Execute DPA with Supabase | Legal/Admin | [Date] |
| 6 | Execute DPA with Brevo | Legal/Admin | [Date] |
| 7 | Implement audit logging | Development | [Date] |
| 8 | Formalize data access request process | Privacy Officer | [Date] |
| 9 | Create data retention schedule | Privacy Officer | [Date] |

### 9.3 Medium-term Actions (90-180 days)

| # | Action | Owner | Due Date |
|---|--------|-------|----------|
| 10 | Implement database RLS | Development | [Date] |
| 11 | Add MFA option for admins | Development | [Date] |
| 12 | Implement health form annual expiry | Development | [Date] |
| 13 | Conduct staff privacy training | Privacy Officer | [Date] |
| 14 | Review and update privacy policy | Privacy Officer | [Date] |

### 9.4 Ongoing Actions

| Action | Frequency | Owner |
|--------|-----------|-------|
| Review this PIA | Annually | Privacy Officer |
| Security patching | Monthly | Development |
| Access review | Quarterly | Admin |
| Vendor security review | Annually | Privacy Officer |
| Privacy policy review | Annually | Privacy Officer |

---

## 10. Approval and Sign-off

### 10.1 Assessment Approval

By signing below, the undersigned confirm that:
- This PIA accurately describes the Wampums system's privacy practices
- The identified risks have been properly assessed
- The recommended mitigations are appropriate and will be implemented
- Residual risks are acceptable given the implemented and planned controls

### 10.2 Signatures

**Privacy Officer / Responsable de la protection des renseignements personnels:**

| Name | Title | Signature | Date |
|------|-------|-----------|------|
| _________________ | Privacy Officer | _________________ | ____/____/____ |

**System Owner:**

| Name | Title | Signature | Date |
|------|-------|-----------|------|
| _________________ | System Administrator | _________________ | ____/____/____ |

**Management Approval:**

| Name | Title | Signature | Date |
|------|-------|-----------|------|
| _________________ | [Title] | _________________ | ____/____/____ |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **CAI** | Commission d'accès à l'information du Québec |
| **DPA** | Data Processing Agreement |
| **Law 25** | Quebec's Act to modernize legislative provisions respecting the protection of personal information |
| **Minor** | Individual under 18 years of age |
| **PIA** | Privacy Impact Assessment |
| **PIPEDA** | Personal Information Protection and Electronic Documents Act |
| **PHIPA** | Personal Health Information Protection Act (Ontario) |
| **RLS** | Row Level Security (database feature) |

## Appendix B: Related Documents

| Document | Location |
|----------|----------|
| Privacy Policy | `/politique-de-confidentialite.html` |
| Terms of Service | `/termsofservice.html` |
| Data Deletion Instructions | `/deletion.html` |
| Security Improvements | `/SECURITY_IMPROVEMENTS.md` |
| Compliance Report | `/SECURITY_LEGAL_COMPLIANCE_REPORT.md` |

## Appendix C: Revision History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| Dec 12, 2025 | 1.0 | Initial PIA | [Name] |

---

**End of Document**
