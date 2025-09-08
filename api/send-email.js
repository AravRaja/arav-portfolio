/* eslint-env node */
import { Resend } from 'resend';

// Initialize Resend with the API key from your environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req, res) => {
  // Vercel runs this function for any request to /api/send-email
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, subject, message } = req.body;

  if (!email || !subject || !message) {
    return res.status(400).json({ error: 'Email, subject, and message are required' });
  }

  try {
    // Send the email using Resend
    const { error } = await resend.emails.send({
      from: 'Contact Form <noreply@emails.arav.info>',
      to: ['aravraja8@gmail.com'], // This is your email address
      subject: `New message from ${email}: ${subject}`,
      reply_to: email, // Set the sender's email as the reply-to address
      html: `<p>You have a new message from your portfolio contact form:</p>
             <p><strong>From:</strong> ${email}</p>
             <p><strong>Message:</strong></p>
             <p>${message.replace(/\n/g, '<br>')}</p>`,
    });

    if (error) {
      console.error({ error });
      return res.status(400).json({ error: 'Failed to send email.' });
    }

    res.status(200).json({ message: 'Email sent successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};
