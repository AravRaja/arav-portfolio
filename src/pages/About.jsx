import React, { useState, useEffect } from 'react';
import './About.css';

export default function About() {
  const [animatedSections, setAnimatedSections] = useState(new Set());

  useEffect(() => {
    // Animate sections in sequence
    const animateSections = () => {
      const sections = ['hero', 'skills', 'interests'];
      sections.forEach((section, index) => {
        setTimeout(() => {
          setAnimatedSections(prev => new Set([...prev, section]));
        }, index * 300);
      });
    };

    const timer = setTimeout(animateSections, 500);
    return () => clearTimeout(timer);
  }, []);

  const skills = [
    { category: 'AI/ML', items: ['Neural Networks', 'TensorFlow', 'PyTorch', 'Computer Vision', 'NLP'] },
    { category: 'Audio Tech', items: ['DSP', 'JUCE', 'Real-time Processing', 'Music Information Retrieval'] },
    { category: 'Web Development', items: ['React', 'Node.js', 'Three.js', 'TypeScript', 'GraphQL'] },
    { category: 'Systems', items: ['Python', 'C++', 'Java', 'AWS', 'Docker', 'PostgreSQL'] }
  ];

  const interests = [
    { icon: '🎵', title: 'Music Production', description: 'Creating electronic music and exploring generative composition' },
    { icon: '🤖', title: 'AI Research', description: 'Investigating neural architectures for creative applications' },
    { icon: '🎮', title: 'Interactive Media', description: 'Building immersive experiences with 3D graphics and audio' },
    { icon: '📚', title: 'Continuous Learning', description: 'Always exploring new technologies and methodologies' }
  ];


  return (
    <main className="about-page">
      <div className="about-container slide-up-animation">
        
        {/* Header Section */}
        <div className="about-header">
          <h1 className="about-title">[ABOUT ME]</h1>
          <p className="about-subtitle">DEVELOPER, RESEARCHER & CREATIVE TECHNOLOGIST</p>
        </div>

        {/* Hero Section */}
        <section className={`about-section hero-section ${
          animatedSections.has('hero') ? 'animated' : ''
        }`}>
          <div className="hero-content">
            <div className="hero-text">
              <h2 className="section-title">[WHO I AM]</h2>
              <p className="hero-description">
                I'm a Computer Science student at the University of Bristol with a passion for 
                merging technology and creativity. My work spans AI/ML research, audio technology, 
                and interactive web experiences. I believe in building technology that not only 
                solves problems but also inspires and delights users.
              </p>
              <p className="hero-description">
                Currently focused on neural networks for music recommendation systems, I'm always 
                exploring the intersection of artificial intelligence and human creativity. When I'm 
                not coding, you'll find me producing music, experimenting with new frameworks, or 
                diving deep into research papers.
              </p>
            </div>
            <div className="hero-stats">
              <div className="stat-item">
                <span className="stat-number">20</span>
                <span className="stat-label">Years Old</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">3+</span>
                <span className="stat-label">Years Coding</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">15+</span>
                <span className="stat-label">Projects Built</span>
              </div>
              <div className="stat-item">
                <span className="stat-number">∞</span>
                <span className="stat-label">Curiosity Level</span>
              </div>
            </div>
          </div>
        </section>

        {/* Skills and Interests Combined Section */}
        <section className={`about-section skills-interests-section ${
          animatedSections.has('skills') ? 'animated' : ''
        }`}>
          <div className="skills-interests-container">
            {/* Skills Column */}
            <div className="skills-column">
              <h2 className="section-title">[TECHNICAL SKILLS]</h2>
              <div className="skills-grid">
                {skills.map((skillGroup, index) => (
                  <div key={skillGroup.category} className="skill-group" style={{'--delay': `${index * 0.1}s`}}>
                    <h3 className="skill-category">{skillGroup.category}</h3>
                    <div className="skill-items">
                      {skillGroup.items.map((skill, skillIndex) => (
                        <span key={skillIndex} className="skill-tag">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interests Column */}
            <div className="interests-column">
              <h2 className="section-title">[INTERESTS & PASSIONS]</h2>
              <div className="interests-grid">
                {interests.map((interest, index) => (
                  <div key={interest.title} className="interest-card" style={{'--delay': `${index * 0.1}s`}}>
                    <div className="interest-icon">{interest.icon}</div>
                    <h3 className="interest-title">{interest.title}</h3>
                    <p className="interest-description">{interest.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Contact CTA */}
        <section className="about-section cta-section">
          <div className="cta-content">
            <h2 className="cta-title">Let's Build Something Amazing Together</h2>
            <p className="cta-description">
              I'm always open to discussing new opportunities, collaborations, or just 
              chatting about technology and music. Feel free to reach out!
            </p>
            <div className="cta-buttons">
              <a href="/contact" className="cta-button primary">
                Get In Touch
              </a>
              <a href="/projects" className="cta-button secondary">
                View My Work
              </a>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
