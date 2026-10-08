# Unit email sender

A unit can change how the email it sends looks to families: the sender name,
the From address and the Reply-To address. It sets them in **Unit settings →
General → Email sender** (`org.edit`), or through
`GET`/`PATCH /api/v1/organizations/settings/email-sender`. The values are
stored in `organization_settings.email_sender`.

| Field | What it changes | Restriction |
|---|---|---|
| `from_name` | Display name: `"Meute 6A" <…>` | One line, 100 characters at most. Defaults to the unit's name. |
| `from_email` | The From address | Must be on a domain that is **authenticated with the email provider** and **registered to this unit**. Blank means the platform address (`EMAIL_FROM`). |
| `reply_to` | Where replies go | Any valid address, including Gmail. |

A Gmail address cannot be the From address, and the API refuses it. It can be
the Reply-To, which is where a unit's Gmail address belongs.

## Which emails use it

These emails go out under the unit's identity: announcements, permission slips
and their reminders, parent invitations, family-link requests, alumni
invitations, reactivation confirmations, incident report notices, and carpool
update and cancellation notices.

These emails keep the platform identity: two-factor codes, password resets,
notices to administrators (new leader to approve, reactivation request), and
the public contact form. Security messages should come from one address that
people can recognise, and replies to them are not meant for the unit.

## Why a Gmail address can't be the From address

Receiving servers check the From domain with **DMARC**. A message passes only
if it is signed with DKIM by the From domain (or passes SPF for it), and the
sender controls those records for that domain. Wampums sends through Brevo.
Brevo can sign for `wampums.app` or `meute6a.app` because their DNS publishes
Brevo's DKIM keys. Nobody but Google can publish keys for `gmail.com`. So a
message sent From `meute6a@gmail.com` through Brevo always fails DMARC
alignment and is, technically, spoofed:

- `gmail.com` publishes `p=none` today, so most such messages are delivered.
  Gmail still shows a warning, or "via brevo…", next to the sender. That policy
  is Google's to change, and its subdomain policy is already `quarantine`.
- The Gmail and Yahoo bulk-sender rules require DMARC alignment from bulk
  senders. A unit's announcement to every family counts as bulk mail.
- Spam filters count the failure against the message even when DMARC lets it
  through.

The only way to send with a real `@gmail.com` From address is to send through
Google's own servers, logged in to that Google account. Wampums does not do
this. It would mean storing a Google credential for each unit, and Gmail caps
an account at about 500 messages a day.

`sendEmail` enforces this again at send time. A From address outside the
authenticated domains is replaced with `EMAIL_FROM`, and a warning is logged.

## Setup for a unit with its own domain (Meute 6A)

The goal: families see **Meute 6A <meute6a@meute6a.app>**, the message passes
DMARC on `meute6a.app`, and replies arrive in `meute6a@gmail.com`.

DNS as of 2026-10-08: `meute6a.app` already has the `brevo-code` TXT record and
the `brevo1._domainkey` and `brevo2._domainkey` CNAMEs. It receives mail
through Cloudflare Email Routing, and its DMARC record is `p=none`.

1. **Confirm the domain in Brevo.** Under *Senders, Domains & Dedicated IPs →
   Domains*, `meute6a.app` must show as authenticated, with DKIM and DMARC
   green. If it does not, publish the records Brevo lists for it in Cloudflare
   DNS, with the proxy off for the CNAMEs.
2. **Declare it to Wampums.** On the Railway service, set
   `EMAIL_AUTHENTICATED_DOMAINS=meute6a.app`. Separate several domains with
   commas. Only the platform operator can make this claim, because only the
   operator controls the Brevo account.
3. **Keep the platform sender on the platform domain.** `EMAIL_FROM` should be
   `info@wampums.app`. If it is `info@meute6a.app`, every unit's email appears
   to come from Meute 6A. And because the platform's own domain can never be
   claimed by a unit, Meute 6A would then not be offered its domain.
4. **Register the domain to the unit.** `organization_domains` must hold
   `meute6a.app` (or `www.meute6a.app`) for that unit. A unit is offered only
   its own domains, so it cannot send as another unit.
5. **Fill in the unit settings.** Sender name `Meute 6A`, sender address
   `meute6a@meute6a.app`, reply-to address `meute6a@gmail.com`.
6. **Route the From address to Gmail.** In Cloudflare, under *Email → Email
   Routing*, add a rule `meute6a@meute6a.app → meute6a@gmail.com` and verify
   the destination. Some mail clients ignore Reply-To, and automatic replies
   go to the From address; this rule makes sure they still reach the leaders.
7. **Optional: answer as the unit from Gmail.** In Gmail, under *Settings →
   Accounts → Send mail as*, add `meute6a@meute6a.app` using the Brevo SMTP
   relay (`smtp-relay.brevo.com`, port 587, the Brevo SMTP login and key).
   Replies written in Gmail then also go out signed for `meute6a.app`, instead
   of revealing the Gmail address.

A unit without a domain of its own skips steps 1, 2, 4, 6 and 7. It sets only
a sender name and a Gmail reply-to. Its email comes from
`Meute X <info@wampums.app>`, which passes DMARC on `wampums.app`.

## Check that it works

Send an announcement to yourself. In Gmail, open *⋮ → Show original*. The
summary must show:

- `DKIM: 'PASS' with domain meute6a.app` (or `wampums.app` for the platform
  sender)
- `DMARC: 'PASS'`
- `SPF` may pass for Brevo's bounce domain rather than for `meute6a.app`. This
  is normal. DKIM alignment alone satisfies DMARC.

The `Reply-To:` header must read `meute6a@gmail.com`.

## Tighten DMARC later

`meute6a.app` and `wampums.app` publish `p=none`, which only reports. After a
few weeks of clean reports, every legitimate source passing, move to
`p=quarantine`, then `p=reject`. Cloudflare's DMARC Management already receives
those reports through the `rua` address. A stricter policy is what makes
*others'* forgeries of the domain fail. It is not needed for the setup above to
pass.
