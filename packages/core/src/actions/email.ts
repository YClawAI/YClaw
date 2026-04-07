import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('email-executor');

// ─── Email Action Executor (AWS SES, fetch-based) ───────────────────────────
//
// Actions:
//   email:send - Send an email via AWS SES
//
// Required env vars:
//   AWS_ACCESS_KEY_ID     - AWS IAM access key
//   AWS_SECRET_ACCESS_KEY - AWS IAM secret key
//   AWS_REGION            - AWS region (defaults to us-east-1)
//   SES_FROM_ADDRESS      - Default sender email address
//

// Allowed recipient domains (comma-separated in env). Empty = no restriction.
const ALLOWED_DOMAINS = (process.env.EMAIL_ALLOWED_DOMAINS || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

// Basic HTML tag allowlist for sanitization
const SAFE_TAGS = new Set(['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'div', 'table', 'tr', 'td', 'th', 'thead', 'tbody']);
const SAFE_ATTRS = new Set(['href', 'target', 'style']);

/** Strip HTML tags not in the safe set, remove event handlers. */
function sanitizeHtml(html: string): string {
  // Remove script/style tags and their contents
  let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove event handler attributes (onclick, onerror, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s+on\w+\s*=\s*\S+/gi, '');
  // Remove tags not in safe set
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    if (SAFE_TAGS.has(tag.toLowerCase())) {
      // Keep the tag but strip unsafe attributes
      return match.replace(/\s+([a-zA-Z-]+)\s*=\s*["'][^"']*["']/g, (attrMatch, attrName) => {
        return SAFE_ATTRS.has(attrName.toLowerCase()) ? attrMatch : '';
      });
    }
    return ''; // Remove unsafe tags entirely
  });
  return clean;
}

/** Check if an email address is in the allowed domains list. */
function isAllowedRecipient(email: string): boolean {
  if (ALLOWED_DOMAINS.length === 0) return true; // No restriction configured
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

export class EmailExecutor implements ActionExecutor {
  readonly name = 'email';
  private accessKeyId: string | null = null;
  private secretAccessKey: string | null = null;
  private region: string;
  private fromAddress: string | null = null;

  constructor() {
    this.accessKeyId = process.env.AWS_ACCESS_KEY_ID || null;
    this.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || null;
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.fromAddress = process.env.SES_FROM_ADDRESS || null;

    if (!this.accessKeyId || !this.secretAccessKey) {
      logger.warn(
        'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.',
      );
    }

    if (!this.fromAddress) {
      logger.warn('SES_FROM_ADDRESS not configured. You will need to provide "from" in every send call.');
    }
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'email:send',
        description: 'Send an email via AWS SES',
        parameters: {
          to: { type: 'string', description: 'Recipient email address (or array of addresses)', required: true },
          subject: { type: 'string', description: 'Email subject line', required: true },
          body: { type: 'string', description: 'Plain text email body (provide this or htmlBody)' },
          htmlBody: { type: 'string', description: 'HTML email body (provide this or body). Unsafe tags are sanitized.' },
          cc: { type: 'string', description: 'CC recipient email address (or array of addresses)' },
          bcc: { type: 'string', description: 'BCC recipient email address (or array of addresses)' },
          replyTo: { type: 'string', description: 'Reply-to email address (or array of addresses)' },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      return { success: false, error: 'Email not initialized: missing AWS credentials' };
    }

    switch (action) {
      case 'send':
        return this.send(params);
      default:
        return { success: false, error: `Unknown email action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.accessKeyId || !this.secretAccessKey) return false;

    try {
      // Verify SES identity by calling GetSendQuota
      const response = await this.sesRequest('GetSendQuota', {});
      return response.ok;
    } catch (err) {
      logger.error('Email health check failed', { error: (err as Error).message });
      return false;
    }
  }

  // ─── Send an email ────────────────────────────────────────────────────────

  private async send(params: Record<string, unknown>): Promise<ActionResult> {
    const to = params.to as string | string[] | undefined;
    const subject = params.subject as string | undefined;
    const body = params.body as string | undefined;
    const rawHtmlBody = params.htmlBody as string | undefined;
    const from = this.fromAddress; // Always use configured sender — ignore params.from
    const cc = params.cc as string | string[] | undefined;
    const bcc = params.bcc as string | string[] | undefined;
    const replyTo = params.replyTo as string | string[] | undefined;

    if (!to || !subject || (!body && !rawHtmlBody)) {
      return { success: false, error: 'Missing required parameters: to, subject, and body or htmlBody' };
    }

    if (!from) {
      return { success: false, error: 'Missing sender address: set SES_FROM_ADDRESS environment variable' };
    }

    const toAddresses = Array.isArray(to) ? to : [to];

    // Validate all recipients against allowed domains
    const allRecipients = [
      ...toAddresses,
      ...(cc ? (Array.isArray(cc) ? cc : [cc]) : []),
      ...(bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : []),
    ];
    const blockedRecipients = allRecipients.filter(addr => !isAllowedRecipient(addr));
    if (blockedRecipients.length > 0) {
      return { success: false, error: `Recipient domain not allowed: ${blockedRecipients.join(', ')}` };
    }

    // Sanitize HTML body if present
    const htmlBody = rawHtmlBody ? sanitizeHtml(rawHtmlBody) : undefined;

    logger.info('Sending email via SES', {
      from,
      to: toAddresses,
      subject,
      hasHtml: !!htmlBody,
    });

    try {
      // Build SES SendEmail parameters
      const sesParams: Record<string, string> = {
        'Action': 'SendEmail',
        'Source': from,
        'Message.Subject.Data': subject,
        'Message.Subject.Charset': 'UTF-8',
      };

      // To addresses
      toAddresses.forEach((addr, i) => {
        sesParams[`Destination.ToAddresses.member.${i + 1}`] = addr;
      });

      // CC addresses
      if (cc) {
        const ccAddresses = Array.isArray(cc) ? cc : [cc];
        ccAddresses.forEach((addr, i) => {
          sesParams[`Destination.CcAddresses.member.${i + 1}`] = addr;
        });
      }

      // BCC addresses
      if (bcc) {
        const bccAddresses = Array.isArray(bcc) ? bcc : [bcc];
        bccAddresses.forEach((addr, i) => {
          sesParams[`Destination.BccAddresses.member.${i + 1}`] = addr;
        });
      }

      // Reply-to addresses
      if (replyTo) {
        const replyToAddresses = Array.isArray(replyTo) ? replyTo : [replyTo];
        replyToAddresses.forEach((addr, i) => {
          sesParams[`ReplyToAddresses.member.${i + 1}`] = addr;
        });
      }

      // Body - text and/or HTML
      if (body) {
        sesParams['Message.Body.Text.Data'] = body;
        sesParams['Message.Body.Text.Charset'] = 'UTF-8';
      }
      if (htmlBody) {
        sesParams['Message.Body.Html.Data'] = htmlBody;
        sesParams['Message.Body.Html.Charset'] = 'UTF-8';
      }

      const response = await this.sesRequest('SendEmail', sesParams);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`SES API error (${response.status}): ${errorBody}`);
      }

      const responseText = await response.text();

      // Extract MessageId from XML response
      const messageIdMatch = responseText.match(/<MessageId>(.+?)<\/MessageId>/);
      const messageId = messageIdMatch ? messageIdMatch[1] : 'unknown';

      logger.info('Email sent successfully', { messageId, to: toAddresses });
      return {
        success: true,
        data: { messageId, to: toAddresses, subject },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send email', { error: errorMsg, to: toAddresses });
      return { success: false, error: `Failed to send email: ${errorMsg}` };
    }
  }

  // ─── AWS SES Request Helper ───────────────────────────────────────────────

  private async sesRequest(
    action: string,
    params: Record<string, string>,
  ): Promise<Response> {
    const endpoint = `https://email.${this.region}.amazonaws.com/`;
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

    // Build the request body
    const bodyParams = new URLSearchParams(params);
    if (!params.Action) {
      bodyParams.set('Action', action);
    }
    bodyParams.set('Version', '2010-12-01');
    const requestBody = bodyParams.toString();

    // AWS Signature V4 signing
    const method = 'POST';
    const service = 'ses';
    const canonicalUri = '/';
    const canonicalQuerystring = '';
    const contentType = 'application/x-www-form-urlencoded; charset=utf-8';

    const payloadHash = await this.sha256Hex(requestBody);

    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:email.${this.region}.amazonaws.com\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = 'content-type;host;x-amz-date';

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await this.sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await this.getSignatureKey(dateStamp, this.region, service);
    const signature = await this.hmacHex(signingKey, stringToSign);

    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(endpoint, {
      method,
      headers: {
        'Content-Type': contentType,
        'X-Amz-Date': amzDate,
        'Authorization': authorizationHeader,
      },
      body: requestBody,
    });
  }

  // ─── AWS Signature V4 Helpers ─────────────────────────────────────────────

  private async sha256Hex(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return this.bufferToHex(hashBuffer);
  }

  private async hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const encoder = new TextEncoder();
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  }

  private async hmacHex(key: ArrayBuffer | Uint8Array, message: string): Promise<string> {
    const result = await this.hmac(key, message);
    return this.bufferToHex(result);
  }

  private async getSignatureKey(
    dateStamp: string,
    region: string,
    service: string,
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const kDate = await this.hmac(encoder.encode(`AWS4${this.secretAccessKey}`), dateStamp);
    const kRegion = await this.hmac(kDate, region);
    const kService = await this.hmac(kRegion, service);
    const kSigning = await this.hmac(kService, 'aws4_request');
    return kSigning;
  }

  private bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
