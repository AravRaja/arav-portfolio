import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { projects } from "../data/portfolio";
import "./Portfolio.css";

function ExpressionDemo() {
  const [emotion, setEmotion] = useState("happiness");
  const [intensity, setIntensity] = useState(4);
  return (
    <section
      className="emotion-demo"
      aria-label="Explore facial-expression intensity"
    >
      <img
        src={`/projects/emotions/${emotion}/${intensity}.webp`}
        alt={`Synthetic face: ${emotion}, intensity ${intensity} of 8`}
      />
      <div className="emotion-controls">
        <label htmlFor="emotion">CHOOSE AN EMOTION</label>
        <select
          id="emotion"
          value={emotion}
          onChange={(e) => setEmotion(e.target.value)}
        >
          {["anger", "sadness", "happiness", "disgust", "fear", "surprise"].map(
            (value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ),
          )}
        </select>
        <label htmlFor="intensity">INTENSITY — {intensity} / 8</label>
        <input
          id="intensity"
          type="range"
          min="1"
          max="8"
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
        <small>
          Explore saved outputs from the original research project. These are
          synthetic faces, not participant photographs.
        </small>
      </div>
    </section>
  );
}

function ProjectDialog({ project, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const oldOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = oldOverflow;
    };
  }, []);
  return (
    <dialog
      className="case-dialog"
      ref={ref}
      aria-labelledby="case-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        className="case-close"
        aria-label="Close project"
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <figure className="case-hero">
        <img src={project.image} alt={project.imageAlt} />
        {project.caption && <figcaption>{project.caption}</figcaption>}
      </figure>
      <div className="case-body">
        <div className="portfolio-kicker">
          {project.category} / {project.period}
        </div>
        <h2 id="case-title">{project.title}</h2>
        <p>{project.subtitle}</p>
        <div className="case-tags">
          {project.technologies.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <p>{project.description}</p>
        <h3>The work</h3>
        <p>{project.detail}</p>
        <h3>Highlights</h3>
        <ul>
          {project.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        {project.interactive && <ExpressionDemo />}
        {project.gallery?.map((g) => (
          <figure className="case-gallery" key={g.image}>
            <img loading="lazy" src={g.image} alt={g.caption} />
            <figcaption>{g.caption}</figcaption>
          </figure>
        ))}
        {project.links.length > 0 && (
          <div className="case-links">
            {project.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}

export default function Projects() {
  const [params, setParams] = useSearchParams();
  const project = projects.find((p) => p.id === params.get("id"));
  const close = () => setParams({}, { replace: true });
  return (
    <main className="portfolio-page">
      <div className="portfolio-inner">
        <p className="portfolio-kicker">Arav Raja / Selected work</p>
        <h1 className="portfolio-heading">Things I’ve built.</h1>
        <p className="portfolio-intro">
          Robots, research and music software. A collection of projects that
          started with an idea I wanted to make real.
        </p>
        <div className="portfolio-rule">
          <span>THE COLLECTION / 6 PROJECTS</span>
          <span>SELECT A SLEEVE TO EXPLORE ↗</span>
        </div>
        <div className="project-shelf">
          {projects.map((p, i) => (
            <button
              className="project-record"
              key={p.id}
              onClick={() => setParams({ id: p.id })}
              aria-label={`Explore ${p.title}`}
            >
              <div className="record-sleeve">
                <span className="record-number">
                  AR / {String(i + 1).padStart(2, "0")}
                </span>
                <img
                  src={p.image}
                  alt={p.imageAlt}
                  loading={i < 3 ? "eager" : "lazy"}
                />
                <span className="record-open" aria-hidden="true">
                  ↗
                </span>
              </div>
              <div className="record-meta">
                <span>{p.category}</span>
                <span>{p.period}</span>
              </div>
              <h2>{p.title}</h2>
              <p>{p.summary}</p>
            </button>
          ))}
        </div>
        <footer className="portfolio-footer">
          <span>Built with curiosity. And a lot of iteration.</span>
          <div>
            <Link to="/experience">Experience ↗</Link>
            <Link to="/contact">Get in touch ↗</Link>
          </div>
        </footer>
      </div>
      {project && (
        <ProjectDialog key={project.id} project={project} onClose={close} />
      )}
    </main>
  );
}
