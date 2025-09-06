import React, { useState, useEffect } from 'react';
import './Contact.css';

export default function Contact() {
  const [formData, setFormData] = useState({
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [copiedItem, setCopiedItem] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSubmitStatus('success');
        setFormData({ email: '', subject: '', message: '' });
      } else {
        setSubmitStatus('error');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = async (text, itemName) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemName);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedItem(itemName);
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

  // Auto-flip animation on page load
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFlipped(true);
    }, 1200); // Faster initial flip
    return () => clearTimeout(timer);
  }, []);


  return (
    <main className="contact-page">
      <div className="contact-container">
        <button className="switch-side-button" onClick={() => setIsFlipped(!isFlipped)}>
          SWITCH SIDE
        </button>
        <div className={`album-flip-container ${isFlipped ? 'flipped' : ''}`}>
          {/* Album Front */}
          <div className="album-side album-front">
            <div className="album-title">ARAV RAJA</div>
            <div className="album-artist">DEV/MAKER</div>
            <div className="album-info">
              [ML & AUDIO TECH]<br />
              [UNIVERSITY OF BRISTOL CS]<br />
              [BASED IN LONDON]<br />
              [AGE 20]
            </div>
          </div>

          {/* Album Back (Contact Form) */}
          <div className="album-side album-back" onClick={(e) => e.stopPropagation()}>
            <div className="contact-header">
              <span className="contact-title">CONTACT</span>
            </div>
            <div className="contact-content">
              <form className="contact-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email" className="form-label">[YOUR EMAIL]</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="form-input"
                required
                placeholder="your.email@example.com"
              />
            </div>

            <div className="form-group">
              <label htmlFor="subject" className="form-label">[SUBJECT]</label>
              <input
                type="text"
                id="subject"
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                className="form-input"
                required
                placeholder="Project collaboration, job opportunity, etc."
              />
            </div>

            <div className="form-group">
              <label htmlFor="message" className="form-label">[MESSAGE]</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                className="form-textarea"
                required
                rows="6"
                placeholder="Tell me about your project, idea, or opportunity..."
              />
            </div>

            <button 
              type="submit" 
              className="submit-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'SENDING...' : 'SEND MESSAGE'}
            </button>

            {submitStatus === 'success' && (
              <div className="status-message success">
                Message sent successfully!
              </div>
            )}

            {submitStatus === 'error' && (
              <div className="status-message error">
                Error sending message. Please try again.
              </div>
            )}
          </form>

          <div className="contact-sidebar">
            <div className="social-links">
              <div className="social-item">
                <span className="social-label">[EMAIL]</span>
                <div className="social-content">
                  <a href="mailto:aravraja8@gmail.com" className="social-link">
                    aravraja8@gmail.com
                  </a>
                  <button 
                    className="copy-button"
                    onClick={() => copyToClipboard('aravraja8@gmail.com', 'email')}
                    title="Copy email to clipboard"
                  >
                    {copiedItem === 'email' ? '✓' : '📋'}
                  </button>
                </div>
              </div>

              <div className="social-item">
                <span className="social-label">[LINKEDIN]</span>
                <div className="social-content">
                  <a 
                    href="https://linkedin.com/in/aravraja" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="social-link"
                  >
                    linkedin.com/in/aravraja
                  </a>
                  <button 
                    className="copy-button"
                    onClick={() => copyToClipboard('https://linkedin.com/in/aravraja', 'linkedin')}
                    title="Copy LinkedIn URL to clipboard"
                  >
                    {copiedItem === 'linkedin' ? '✓' : '📋'}
                  </button>
                </div>
              </div>

              <div className="social-item">
                <span className="social-label">[GITHUB]</span>
                <div className="social-content">
                  <a 
                    href="https://github.com/aravraja" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="social-link"
                  >
                    github.com/aravraja
                  </a>
                  <button 
                    className="copy-button"
                    onClick={() => copyToClipboard('https://github.com/aravraja', 'github')}
                    title="Copy GitHub URL to clipboard"
                  >
                    {copiedItem === 'github' ? '✓' : '📋'}
                  </button>
                </div>
              </div>
            </div>

            <div className="contact-info">
              <div className="info-block">
                <span className="info-label">[LOCATION]</span>
                <span className="info-value">LONDON, UK</span>
              </div>
              <div className="info-block">
                <span className="info-label">[RESPONSE TIME]</span>
                <span className="info-value">USUALLY WITHIN 24H</span>
              </div>
            </div>
          </div>
        </div>
        </div>
        </div>
      </div>
    </main>
  );
}
