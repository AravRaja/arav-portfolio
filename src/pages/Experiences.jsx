import React, { useState, useEffect, useMemo } from 'react';
import './Experiences.css';

export default function Experiences() {
  const [animatedCards, setAnimatedCards] = useState(new Set());
  const [selectedExperience, setSelectedExperience] = useState(null);

  // Placeholder experience data with detailed information
  const experiences = useMemo(() => [
    {
      id: 1,
      title: "ML Research Assistant",
      company: "University of Bristol",
      period: "2023 - Present",
      description: "Developing neural networks for music recommendation systems with interaction-aware algorithms.",
      image: "/music-suggestion.png",
      technologies: ["Python", "TensorFlow", "PyTorch", "Neural Networks"],
      detailedDescription: "Leading research on next-generation music recommendation systems that adapt to user interactions in real-time. Developed novel neural architectures combining collaborative filtering with deep learning to improve recommendation accuracy by 35%. Published findings in top-tier conferences and collaborated with industry partners.",
      achievements: [
        "Improved recommendation accuracy by 35% over baseline models",
        "Published 2 papers in ACM conferences",
        "Collaborated with Spotify on real-world dataset validation",
        "Mentored 3 undergraduate research students"
      ],
      responsibilities: [
        "Design and implement neural network architectures",
        "Conduct literature reviews and experimental analysis",
        "Present findings at academic conferences",
        "Collaborate with industry partners on real-world applications"
      ]
    },
    {
      id: 2,
      title: "Audio Tech Intern",
      company: "SoundWave Labs",
      period: "Summer 2023",
      description: "Built real-time audio processing pipelines and implemented DSP algorithms for music production tools.",
      image: "/music-suggestion.png",
      technologies: ["C++", "JUCE", "DSP", "Audio Processing"],
      detailedDescription: "Developed high-performance audio processing plugins used by professional music producers. Implemented real-time DSP algorithms for noise reduction, dynamic range compression, and spatial audio effects. Optimized code for low-latency performance in professional audio workstations.",
      achievements: [
        "Reduced audio latency by 40% through optimization",
        "Developed 3 commercial audio plugins",
        "Implemented real-time noise reduction algorithm",
        "Contributed to open-source JUCE framework"
      ],
      responsibilities: [
        "Design and implement DSP algorithms",
        "Optimize code for real-time audio processing",
        "Develop user interfaces for audio plugins",
        "Test and validate audio quality metrics"
      ]
    },
    {
      id: 3,
      title: "Full Stack Developer",
      company: "TechStart Solutions",
      period: "2022 - 2023",
      description: "Developed web applications with modern frameworks and integrated machine learning models.",
      image: "/music-suggestion.png",
      technologies: ["React", "Node.js", "MongoDB", "AWS"],
      detailedDescription: "Built scalable web applications serving 10,000+ users with integrated ML capabilities. Designed and implemented RESTful APIs, managed cloud infrastructure, and developed responsive user interfaces. Led a team of 4 developers on multiple client projects.",
      achievements: [
        "Deployed applications serving 10,000+ active users",
        "Reduced server costs by 30% through optimization",
        "Led development team of 4 engineers",
        "Delivered 8 client projects on time and under budget"
      ],
      responsibilities: [
        "Develop full-stack web applications",
        "Design and implement RESTful APIs",
        "Manage AWS cloud infrastructure",
        "Lead development team and mentor junior developers"
      ]
    },
    {
      id: 4,
      title: "Research Intern",
      company: "AI Music Lab",
      period: "Summer 2022",
      description: "Researched generative models for music composition and implemented LSTM-based melody generators.",
      image: "/music-suggestion.png",
      technologies: ["Python", "Keras", "Music21", "MIDI Processing"],
      detailedDescription: "Explored cutting-edge AI techniques for automated music composition. Implemented and trained LSTM networks on large MIDI datasets to generate coherent melodies and harmonies. Developed evaluation metrics for assessing musical quality and creativity in generated compositions.",
      achievements: [
        "Trained models on 50,000+ MIDI compositions",
        "Developed novel evaluation metrics for AI-generated music",
        "Created interactive web demo with 1,000+ users",
        "Presented research at university symposium"
      ],
      responsibilities: [
        "Research state-of-the-art generative models",
        "Implement and train neural networks for music generation",
        "Develop evaluation frameworks for generated music",
        "Create interactive demonstrations and visualizations"
      ]
    },
    {
      id: 5,
      title: "Teaching Assistant",
      company: "University of Bristol",
      period: "2022 - Present",
      description: "Assisted in computer science courses, focusing on algorithms, data structures, and machine learning.",
      image: "/music-suggestion.png",
      technologies: ["Java", "Python", "Algorithms", "Data Structures"],
      detailedDescription: "Supporting undergraduate education in core computer science subjects. Conducted lab sessions, graded assignments, and provided one-on-one tutoring to struggling students. Developed supplementary course materials and automated grading systems to improve learning outcomes.",
      achievements: [
        "Improved student pass rates by 25% in assisted courses",
        "Developed automated grading system used by 5 courses",
        "Mentored 50+ students in programming fundamentals",
        "Created interactive coding tutorials with 95% satisfaction rate"
      ],
      responsibilities: [
        "Conduct weekly lab sessions and tutorials",
        "Grade assignments and provide detailed feedback",
        "Develop course materials and coding exercises",
        "Provide academic support and mentoring to students"
      ]
    }
  ], []);

  useEffect(() => {
    // Animate cards in sequence
    const animateCards = () => {
      experiences.forEach((_, index) => {
        setTimeout(() => {
          setAnimatedCards(prev => new Set([...prev, index]));
        }, index * 200);
      });
    };

    const timer = setTimeout(animateCards, 500);
    return () => clearTimeout(timer);
  }, [experiences]);

  return (
    <main className="experiences-page">
      <div className="experiences-container">
        <div className="experiences-header">
          <h1 className="experiences-title">[EXPERIENCE TIMELINE]</h1>
          <p className="experiences-subtitle">MY JOURNEY IN TECH & RESEARCH</p>
        </div>

        <div className="timeline-container">
          <div className="timeline-line"></div>
          <div className="timeline-content">
            {experiences.map((experience, index) => (
              <div
                key={experience.id}
                className={`experience-card ${animatedCards.has(index) ? 'animated' : ''} ${
                  index % 2 === 0 ? 'card-top' : 'card-bottom'
                }`}
                style={{ '--delay': `${index * 0.2}s` }}
                onClick={() => setSelectedExperience(experience)}
              >
                <div className="card-content">
                  <div className="card-image-container">
                    <img 
                      src={experience.image} 
                      alt={experience.title}
                      className="card-image"
                    />
                  </div>
                  <div className="card-info">
                    <div className="card-header">
                      <h3 className="card-title">{experience.title}</h3>
                      <span className="card-company">{experience.company}</span>
                      <span className="card-period">{experience.period}</span>
                    </div>
                    <p className="card-description">{experience.description}</p>
                    <div className="card-technologies">
                      {experience.technologies.map((tech, techIndex) => (
                        <span key={techIndex} className="tech-tag">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Experience Detail Modal */}
      {selectedExperience && (
        <div className="experience-modal-overlay" onClick={() => setSelectedExperience(null)}>
          <div className="experience-modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close-button"
              onClick={() => setSelectedExperience(null)}
            >
              ×
            </button>
            
            <div className="modal-header">
              <div className="modal-image-container">
                <img 
                  src={selectedExperience.image} 
                  alt={selectedExperience.title}
                  className="modal-image"
                />
              </div>
              <div className="modal-title-section">
                <h2 className="modal-title">{selectedExperience.title}</h2>
                <h3 className="modal-company">{selectedExperience.company}</h3>
                <span className="modal-period">{selectedExperience.period}</span>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-section">
                <h4 className="modal-section-title">[OVERVIEW]</h4>
                <p className="modal-description">{selectedExperience.detailedDescription}</p>
              </div>

              <div className="modal-section">
                <h4 className="modal-section-title">[KEY ACHIEVEMENTS]</h4>
                <ul className="modal-list">
                  {selectedExperience.achievements.map((achievement, index) => (
                    <li key={index} className="modal-list-item">
                      {achievement}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="modal-section">
                <h4 className="modal-section-title">[RESPONSIBILITIES]</h4>
                <ul className="modal-list">
                  {selectedExperience.responsibilities.map((responsibility, index) => (
                    <li key={index} className="modal-list-item">
                      {responsibility}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="modal-section">
                <h4 className="modal-section-title">[TECHNOLOGIES]</h4>
                <div className="modal-technologies">
                  {selectedExperience.technologies.map((tech, index) => (
                    <span key={index} className="modal-tech-tag">
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
