import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';

// Unisender Go over HTTPS: some hosts cannot reach its SMTP relays
export class UnisenderGoProvider implements EmailInterface {
  name = 'unisender-go';
  validateEnvKeys = ['UNISENDER_GO_API_KEY'];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    // Each account lives on one cluster (go1, go2...), keys only work there
    const host = process.env.UNISENDER_GO_HOST || 'go1.unisender.ru';
    const response = await fetch(
      `https://${host}/ru/transactional/api/v1/email/send.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': process.env.UNISENDER_GO_API_KEY!,
        },
        body: JSON.stringify({
          message: {
            recipients: [{ email: to }],
            subject,
            from_email: emailFromAddress,
            from_name: emailFromName,
            body: { html },
            ...(replyTo && { reply_to: replyTo }),
          },
        }),
      }
    );

    const sends = await response.json().catch(() => ({}));

    // API errors come back as a non-2xx status with a JSON body,
    // throw so sendEmailSync retries the send
    if (!response.ok || sends.status !== 'success') {
      throw new Error(
        `Unisender Go ${response.status}: ${sends.message || 'unknown error'}`
      );
    }

    return sends;
  }
}
