import React, { useState, useEffect } from 'react';
import './Contact.css';
import GithubIcon from '../components/GithubIcon';
import LinkedinIcon from '../components/LinkedinIcon';
import MailIcon from '../components/MailIcon';
import { Link } from 'react-router-dom';
import DrawingCanvas from '../components/DrawingCanvas';

export default function Contact() {
  const [formData, setFormData] = useState({
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: '', type: '' });
  const [isFlipped, setIsFlipped] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const showAlert = (message, type, link) => {
    setAlert({ show: true, message, type, link });
    setTimeout(() => {
      setAlert({ show: false, message: '', type: '', link: null });
    }, 5000); // Alerts hide after 5 seconds
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        showAlert('✓ Message sent successfully!', 'success');
        setFormData({ email: '', subject: '', message: '' });
      } else {
        showAlert('✗ Error sending message. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      showAlert('✗ Error sending message. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFlipped(true);
    }, 800);
    return () => clearTimeout(timer);
  }, []);


  return (
    <main className="contact-page">

      <div className="contact-container">
        <button
          className={`switch-side-button ${isFlipped ? 'on-back' : 'on-front'}`}
          onClick={() => setIsFlipped(!isFlipped)}
        >
          SWITCH SIDE
        </button>
        <div className={`album-flip-container ${isFlipped ? 'flipped' : ''}`}>
          {/* Album Front - Drawing Canvas & Link */}
          <div className="album-side album-front">
            <div className="canvas-area">
              <DrawingCanvas onAlert={showAlert} />
            </div>
            <div className="board-link-area">
              <Link to="/imageboard" className="view-board-button">View Community Board</Link>
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

              </form>
            </div>
            <div className="simplified-socials">
              <a href="https://github.com/aravraja" target="_blank" rel="noopener noreferrer" className="social-icon-link" aria-label="GitHub">
                <GithubIcon className="social-icon" />
              </a>
              <a href="https://linkedin.com/in/aravraja" target="_blank" rel="noopener noreferrer" className="social-icon-link" aria-label="LinkedIn">
                <LinkedinIcon className="social-icon" />
              </a>
              <a href="mailto:aravraja8@gmail.com" className="social-icon-link" aria-label="Email">
                <MailIcon className="social-icon" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Alert System */}
      {alert.show && (
        <div 
          className={`custom-alert ${alert.type === 'success' ? 'alert-success' : 'alert-error'}`}
          onClick={() => setAlert({ ...alert, show: false })}
        >
          <div className="alert-content">
            {alert.message}
            {alert.link && <Link to={alert.link.to} className="alert-link">{alert.link.text}</Link>}
          </div>
        </div>
      )}
    </main>
  );
}
