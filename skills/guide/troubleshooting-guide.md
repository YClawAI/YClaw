# Troubleshooting Guide

Common issues and diagnostic steps for escalated YCLAW support cases.

## Installation & Setup Issues

### Framework Won't Start
1. Verify Node.js version meets requirements (check README)
2. Check all required environment variables are set
3. Verify LLM provider API key is valid and has credits
4. Check MongoDB connection string is correct
5. Check Redis connection is available
6. Review startup logs for specific error messages
7. If persistent → collect: OS, Node version, error logs → escalate to Architect

### Agent Not Loading
1. Verify YAML config is valid (no syntax errors)
2. Check agent YAML is in the correct department directory
3. Verify all referenced system prompts exist in `prompts/`
4. Check all referenced skills exist in `skills/<agent>/`
5. Verify model provider and model name are correct
6. If persistent → collect: agent name, YAML config, error → escalate

## Configuration Issues

### YAML Parsing Errors
Common causes:
- Incorrect indentation (YAML requires consistent spaces, no tabs)
- Missing quotes around strings with special characters
- Invalid cron expressions in triggers
- Referencing non-existent prompt or skill files

### API Key Problems
1. Verify key is set in environment variables or secrets manager
2. Check key has not expired or been revoked
3. Verify the key has correct permissions/scopes
4. Test key directly with the provider's API to isolate YCLAW vs provider issues
5. Check for rate limiting (provider dashboard)

## Event & Trigger Issues

### Cron Not Firing
1. Verify cron schedule syntax is correct (use crontab.guru to validate)
2. Check if the cron is commented out in the YAML
3. Verify the agent is loaded and running
4. Check system timezone vs expected UTC schedule
5. Review logs for cron scheduling errors

### Events Not Dispatching
1. Verify publisher has `event:publish` in its actions
2. Verify subscriber has the event in `event_subscriptions`
3. Check Redis connection (event bus uses Redis)
4. Verify event name matches exactly (case-sensitive)
5. Check for typos in event names between publisher and subscriber

### Approval Gates Blocking
1. Check if the action requires approval in the review configuration
2. Verify the approval channel is configured and accessible
3. Check if there's an approval timeout configured
4. Look for stuck approvals in the approval queue

## Agent Behavior Issues

### Agent Producing Wrong Responses
1. Review system prompts for outdated or incorrect information
2. Check if contaminated skills are loaded (wrong product info)
3. Verify the correct model and temperature are configured
4. Check if the context window is being exceeded (maxTokens)
5. Review skill files for conflicting instructions

### Agent Not Responding to Events
1. Verify event trigger is defined in the agent's YAML
2. Check event_subscriptions matches the trigger events
3. Verify the publishing agent is actually publishing the event
4. Check Redis event bus health
5. Review agent logs for event receipt

## Integration Issues

### Discord Integration
1. Verify Discord bot token is set and valid
2. Check bot has required permissions in the Discord server
3. Verify channel IDs in configuration match actual channels
4. Check if the bot is in the correct server/guild
5. Review Discord rate limit warnings in logs

### Telegram Integration
1. Verify Telegram bot token is set
2. Check bot is added to the correct group/channel
3. Verify bot has admin permissions if moderation is needed
4. Check webhook URL is accessible (if using webhooks)

## When to Escalate to Architect
- Reproducible bugs with clear steps
- Error messages from core framework code (not config issues)
- Issues affecting multiple users simultaneously
- Event bus failures or Redis connection problems
- Performance degradation under normal load

**Always include when escalating:**
- YCLAW version / commit hash
- OS and Node.js version
- Relevant config snippets (redact API keys)
- Steps to reproduce
- Error messages (exact text or logs)
