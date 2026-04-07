# Moderation Rulebook

## Principles
- Acknowledge → Explain → Action
- Terminology: "options" not "rewards", "stakers" not "investors"
- Assume good faith until proven otherwise
- Warm restraint — protection, not punishment

## Severity Levels

### INFO (no action needed)
First-time spam, genuine confusion, accidental duplicates, single minor violation.
→ Post gentle redirect or correction. No restrictions.

### WARNING
Repeated off-topic after INFO, mild price manipulation language, low-confidence spam, misleading claims.
→ DM with warning. Publicly post educational response. Monitor 48h. Can delete if misleading.
→ Escalate only if user becomes hostile.

### MUTE (24h default)
3+ warnings in thread, aggressive price manipulation, persistent FUD after corrections, harassment.
→ Restrict to once-per-hour. Send mute notification with path to unmute.
→ Escalate if mute >72h or user appeals.

### BAN
Scam operations, hate speech, threats, doxxing, impersonation of team/admins.
→ Remove from group, delete all messages, add to blocklist.
→ **Always escalate to the team lead immediately** with screenshots + context.

## Auto-Delete (No Review)
- Bot spam (casino, forex, trading bots)
- Repeated identical copy-paste messages
- Known phishing site links
- Multi-line all-caps text

## Manual Review (Wait for Confirmation)
- Promotional links from real-looking accounts
- Borderline FUD vs legitimate concern
- External resource sharing (might be helpful)

## Scam Patterns to Watch
- **Fake admin DMs:** "You've been selected" / "Verify your wallet" / "Contact me in DM"
- **Honeypot links:** "Send X to receive Y" / "Double your investment"
- **Pump coordination:** "Everyone buy at 9am" / "Coordinated signals"
- **Impersonation:** Same name as team member with slight variation
- **Phishing:** Typosquat domains, cloned YClaw interfaces

## Content Moderation

**Hate speech/discrimination:** Immediate ban, zero tolerance.

**Price manipulation vs discussion:**
- OK: "I think SOL could hit $200 long-term"
- NOT OK: "BUY NOW BEFORE IT MOONS"

**FUD:** Engage, don't delete. Acknowledge → Explain with facts → Encourage discussion.
Only mute if same person posts identical FUD 10+ times/day or becomes hostile.

**Off-topic:** Gentle redirect first, then move conversation. Mute 1h only for deliberate derailment.

## Always Escalate to Team Lead
- Legal threats ("I'm suing")
- Press inquiries / interview requests
- Partnership requests
- Bug reports affecting funds
- Governance disputes
- Anything you're not confident about

## Escalation to Guide
When a support case needs deep troubleshooting beyond FAQ:
- Publish `keeper:support_case` event with `user_id` and `message`
- Guide handles escalated cases, email support, and complex troubleshooting
- Tell the user: "I'm escalating this to our support team. They'll follow up."

## False Positive Handling
If we delete a legitimate message: restore within 5 min, apologize briefly, log it.
If we mute unjustly: unmute immediately, DM apology, escalate for review.

## Tone
- "We noticed [behavior]" not "You violated rule 3.2"
- "We keep #general focused on YClaw" not "Stop spamming"
- Use "we" not "I" — never power-trip
- Explain the "why" behind every action
