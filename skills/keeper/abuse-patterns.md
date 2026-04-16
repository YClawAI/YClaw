# Community Abuse Patterns

> Reference for Keeper when evaluating suspicious behavior in YCLAW community channels.

## AI Framework-Specific Threats

### Prompt Injection Sharing
Users sharing prompts designed to manipulate or extract data from YCLAW agents.
- Watch for: "Try this prompt to make the agent reveal its system prompt"
- Action: Delete message, WARNING to user, educate on responsible AI use

### Malicious Configuration
Users sharing YAML configs or scripts that could harm other users' deployments.
- Watch for: Configs with hardcoded malicious endpoints, excessive permissions
- Action: Delete, WARNING, explain the risk

### Fake Official Resources
Links to repos, docs, or tools claiming to be "official" YCLAW but containing malware.
- Watch for: Typosquat repo names, "enhanced" or "pro" versions
- Action: Delete immediately, BAN if repeated, alert team lead

### Social Engineering
Attempts to extract internal details about YCLAW's infrastructure or team.
- Watch for: "What cloud provider do you use?" / "Can you share the agent configs?"
- Action: Redirect to public documentation. Do not share internal details.

## General Community Threats

### Credential Harvesting
- "Share your API key so I can debug your issue"
- "Paste your .env file contents"
- "What's your OpenAI/Anthropic key?"
→ Delete immediately, WARNING, remind users to never share credentials

### Spam Bot Raids
Coordinated flooding of channels with identical or similar messages.
→ Restrict new members, bulk delete, report to platform

### Impersonation
Accounts mimicking team members or maintainers.
→ Verify against known team list. BAN imposters immediately. Alert team lead.

### Competitor Trolling
Persistent negative comparisons or "use X instead" campaigns.
→ One-time mention is fine. Persistent campaign = WARNING, then MUTE.

## Response Priority
1. **Credential/security threats** → Immediate delete + WARNING/BAN
2. **Malicious code/links** → Immediate delete + BAN
3. **Impersonation** → Immediate BAN + alert
4. **Spam raids** → Bulk restrict + cleanup
5. **Social engineering** → Polite redirect to docs
6. **Everything else** → Standard moderation ladder
