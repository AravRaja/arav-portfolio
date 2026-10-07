import { Link } from "react-router-dom";
import { experiences } from "../data/portfolio";
import "./Portfolio.css";
export default function Experiences() {
  return (
    <main className="portfolio-page">
      <div className="portfolio-inner">
        <p className="portfolio-kicker">Arav Raja / Experience</p>
        <h1 className="portfolio-heading">Learning by building.</h1>
        <p className="portfolio-intro">
          Now building bzzd full-time. Previously software engineering at
          Softwire and machine learning research at the University of Bristol.
        </p>
        <div className="experience-list">
          {experiences.map((e) => (
            <article className="career-item" key={e.id}>
              <div className="career-period">{e.period}</div>
              <div className="career-body">
                <h2>{e.title}</h2>
                <div className="career-company">{e.company}</div>
                <p>{e.description}</p>
                {e.link && <Link to={e.link}>{e.linkLabel} ↗</Link>}
              </div>
            </article>
          ))}
        </div>
        <footer className="portfolio-footer">
          <span>Robotics / Machine learning / Software</span>
          <div>
            <Link to="/about">Education & awards ↗</Link>
            <Link to="/projects">View projects ↗</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
