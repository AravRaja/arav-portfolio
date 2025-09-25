import React, { useState } from 'react';
import './Projects.css';



const projects = [
  {
    id: "music-recs",
    title: "Music Recommendations",
    subtitle: "Neural Networks",
    genre: "AI/ML",
    year: "2024",
    startDate: "2024-01-15",
    endDate: "ongoing",
    color: "#/",
    accentColor: "#FF8E8E",
    albumTitle: "Neural",
    technologies: ["Python", "TensorFlow", "Pandas", "Spotify API"],
    description: "An intelligent music recommendation system using neural networks to analyze user listening patterns and suggest personalized playlists.",
    challenges: "Handling sparse user data and cold start problems while maintaining recommendation diversity and accuracy.",
    github: "https://github.com/aravraja/music-recommendations",
    demo: "#",
    image: "/music-suggestion.png"
  },
  {
    id: "portfolio",
    title: "Interactive Portfolio",
    subtitle: "3D Experience",
    genre: "Web Dev",
    year: "2024",
    startDate: "2024-08-01",
    endDate: "2024-12-15",
    color: "#4ECDC4",
    accentColor: "#6ED5CD",
    albumTitle: "Interactive",
    technologies: ["React", "Three.js", "Vite", "CSS3"],
    description: "A retro-futuristic portfolio featuring 3D animations, interactive DJ model, and immersive user experience with neon aesthetics.",
    challenges: "Optimizing 3D performance across devices while maintaining smooth animations and responsive design.",
    github: "https://github.com/aravraja/portfolio",
    demo: "#",
    image: "/music-suggestion.png"
  },
  {
    id: "blockchain-voting",
    title: "Blockchain Voting",
    subtitle: "Decentralized Democracy",
    genre: "Blockchain",
    year: "2023",
    startDate: "2023-09-10",
    endDate: "2024-01-20",
    color: "#45B7D1",
    accentColor: "#67C3D6",
    albumTitle: "Blockchain",
    technologies: ["Solidity", "Web3.js", "React", "Ethereum"],
    description: "Secure, transparent voting system built on Ethereum blockchain with smart contracts ensuring immutable vote records.",
    challenges: "Gas optimization and ensuring voter privacy while maintaining transparency and auditability.",
    github: "https://github.com/aravraja/blockchain-voting",
    demo: "#",
    image: "/music-suggestion.png"
  },
  {
    id: "ai-chatbot",
    title: "AI Customer Support",
    subtitle: "Intelligent Assistant",
    genre: "AI/NLP",
    year: "2023",
    startDate: "2023-03-12",
    endDate: "2023-07-28",
    color: "#96CEB4",
    accentColor: "#A8D4C0",
    albumTitle: "AI",
    technologies: ["Python", "OpenAI API", "FastAPI", "PostgreSQL"],
    description: "Intelligent chatbot with natural language processing for customer support, featuring context awareness and learning capabilities.",
    challenges: "Maintaining conversation context and handling edge cases while ensuring response accuracy and speed.",
    github: "https://github.com/aravraja/ai-chatbot",
    demo: "#",
    image: "/music-suggestion.png"
  },
  {
    id: "data-viz",
    title: "Data Visualization",
    subtitle: "Interactive Dashboards",
    genre: "Data Science",
    year: "2023",
    startDate: "2023-05-20",
    endDate: "2023-11-15",
    color: "#FFEAA7",
    accentColor: "#FDCB6E",
    albumTitle: "Data",
    technologies: ["D3.js", "Python", "Pandas", "Flask"],
    description: "Interactive data visualization platform for exploring complex datasets with real-time filtering and dynamic chart generation.",
    challenges: "Handling large datasets efficiently while maintaining smooth interactions and responsive visualizations.",
    github: "https://github.com/aravraja/data-viz",
    demo: "#",
    image: "/music-suggestion.png"
  },
  {
    id: "mobile-game",
    title: "Mobile Puzzle Game",
    subtitle: "Retro Arcade",
    genre: "Game Dev",
    year: "2022",
    startDate: "2022-06-01",
    endDate: "2022-12-10",
    color: "#DDA0DD",
    accentColor: "#E6B3E6",
    albumTitle: "Mobile",
    technologies: ["Unity", "C#", "Mobile SDK", "Firebase"],
    description: "Retro-style puzzle game with progressive difficulty, leaderboards, and social features for mobile platforms.",
    challenges: "Optimizing performance for various mobile devices while implementing engaging gameplay mechanics.",
    github: "https://github.com/aravraja/mobile-game",
    demo: "#",
    image: "/music-suggestion.png"
  }
];

export default function Projects() {
  const [selectedProject, setSelectedProject] = useState(null);

  const closeModal = () => setSelectedProject(null);

  const handleLinkClick = (url) => {
    if (url && url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="projects-page">
      <div className="projects-container slide-up-animation"> {/* Added animation class */}

        {/* Added Header */}
        <div className="projects-header">
          <h1 className="projects-title">[PROJECT SHOWCASE]</h1>
          <p className="projects-subtitle">A COLLECTION OF MY WORK</p>
        </div>


        <div className="vinyl-collection">
          {projects.slice(0,6).map((project, index) => (
            <div 
              key={project.id}
              className="vinyl-cover"
              style={{
                '--project-color': project.color,
                '--project-accent': project.accentColor,
                '--project-image': `url(${project.image})`,
                animationDelay: `${index * 0.2}s`
              }}
              onClick={() => setSelectedProject(project)}
            >
              <div className="album-cover">
                <div className="cover-art">
                  <div className="vinyl-disc">
                    <img className="center-label" src={project.image} alt={project.title}></img>
                    <div className="vinyl-grooves"></div>
                    <svg viewBox="0 0 100 100" width="100%" height="100%" style={{position: 'absolute', top: 0, left: 0, zIndex: 5}}>                
                      <defs>
                        {/* Top semicircle arc centered at 50,50 with 35 unit radius (70% of 50) */}
                        <path id="topArc" d="M 15,55 A 30,30 0 0,1 85,55" />
                        {/* Bottom semicircle arc centered at 50,50 with 35 unit radius */}
                        <path id="bottomArc" d="M 85,50 A 35,35 0 0,1 15,50" />
                      </defs>

                      <text fontSize="6" fill="white" fontFamily="IBM Plex Mono, monospace" fontWeight="500">
                        <textPath href="#topArc" startOffset="50%" textAnchor="middle">
                          {project.title.toUpperCase()}
                        </textPath>
                      </text>

                      <text fontSize="5" fill="white" fontFamily="IBM Plex Mono, monospace" fontWeight="400" style={{ transform: 'rotate(-180deg)', transformOrigin: '50px 85px' }} >
                        <textPath href="#bottomArc" startOffset="50%" textAnchor="middle">
                          {project.year}
                        </textPath>
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {selectedProject && (
          <div className="project-modal-overlay" onClick={closeModal}>
            <div className="project-modal-content" onClick={e => e.stopPropagation()}>
              <button 
                className="modal-close-button"
                onClick={closeModal}
                aria-label="Close modal"
              >
                ×
              </button>
              
              <div className="modal-header">
                <div className="modal-image-container">
                  <img 
                    src={selectedProject.image} 
                    alt={selectedProject.title}
                    className="modal-image"
                  />
                </div>
                <div className="modal-title-section">
                  <h2 className="modal-title">{selectedProject.title}</h2>
                  <h3 className="modal-company">{selectedProject.subtitle}</h3>
                  <span className="modal-period">{selectedProject.year}</span>
                </div>
              </div>

              <div className="modal-body">
                <div className="modal-section">
                  <h4 className="modal-section-title">[OVERVIEW]</h4>
                  <p className="modal-description">{selectedProject.description}</p>
                </div>

                <div className="modal-section">
                  <h4 className="modal-section-title">[CHALLENGES]</h4>
                  <p className="modal-description">{selectedProject.challenges}</p>
                </div>

                <div className="modal-section">
                  <h4 className="modal-section-title">[TECHNOLOGIES]</h4>
                  <div className="modal-technologies">
                    {selectedProject.technologies.map((tech, i) => (
                      <span key={i} className="modal-tech-tag">{tech}</span>
                    ))}
                  </div>
                </div>

                <div className="modal-section">
                  <h4 className="modal-section-title">[LINKS]</h4>
                  <div className="modal-actions">
                    {selectedProject.github && (
                      <button 
                        className="action-button github-button"
                        onClick={() => handleLinkClick(selectedProject.github)}
                        aria-label={`View ${selectedProject.title} on GitHub`}
                      >
                        <span className="button-icon">📁</span>
                        GitHub
                      </button>
                    )}
                    {selectedProject.demo && (
                      <button 
                        className="action-button demo-button"
                        onClick={() => handleLinkClick(selectedProject.demo)}
                        aria-label={`View ${selectedProject.title} demo`}
                      >
                        <span className="button-icon">🚀</span>
                        Demo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
