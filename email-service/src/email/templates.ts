/**
 * Minimal template engine — replaces {{key}} placeholders with values from
 * the templateData map.  In production you'd swap this for Handlebars/Mjml.
 */
export function renderTemplate(
  templateName: string,
  data: Record<string, string>
): { subject: string; html: string } {
  const templates: Record<string, { subject: string; html: string }> = {
    welcome: {
      subject: "Welcome to the platform, {{name}}!",
      html: `<h1>Hi {{name}},</h1><p>Welcome aboard! Your account is ready.</p>`,
    },
    "password-reset": {
      subject: "Reset your password",
      html: `<h1>Password Reset</h1><p>Click <a href="{{resetUrl}}">here</a> to reset your password. Valid for 1 hour.</p>`,
    },
    "order-confirmation": {
      subject: "Order #{{orderId}} confirmed",
      html: `<h1>Order Confirmed</h1><p>Your order #{{orderId}} has been placed. Total: {{total}}</p>`,
    },
  };

  const tpl = templates[templateName];
  if (!tpl) throw new Error(`Unknown template: ${templateName}`);

  const interpolate = (str: string): string =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);

  return {
    subject: interpolate(tpl.subject),
    html: interpolate(tpl.html),
  };
}
