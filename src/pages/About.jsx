import { Link } from "react-router-dom";
import "./Portfolio.css";
export default function About() {
  return (
    <main className="portfolio-page">
      <div className="portfolio-inner">
        <p className="portfolio-kicker">Arav Raja / London, UK</p>
        <h1 className="portfolio-heading">I build things.</h1>
        <p className="bio-lead">
          I’m a technical founder working across robotics, machine learning and
          music. Right now, I’m building{" "}
          <a href="https://bzzd.tech" target="_blank" rel="noreferrer">
            bzzd
          </a>
          : autonomous barber stations for short haircuts.
        </p>
        <div className="bio-columns">
          <section>
            <h2>From dissertation to company</h2>
            <p>
              The robot I wanted to build began as a mechanical and electrical
              engineering problem. I shaped my Computer Science dissertation
              around its software, and the university provided lab space,
              equipment and engineering support for the first prototype.
            </p>
            <p>
              That project became bzzd. I graduated from Bristol in 2026 and now
              work on it full-time as co-founder and CEO.
            </p>
          </section>
          <section>
            <h2>The other side of the record</h2>
            <p>
              I’ve built robots since school, including competition robots that
              took me to VEX Worlds. I also build music software: VocaLoop turns
              your voice into instrument parts, while LofAI generates a
              continuous stream of lo-fi hip-hop.
            </p>
            <p>
              At Bristol, I developed facial-expression LoRAs for psychology
              research. I like projects where code reaches beyond the screen:
              into movement, sound or the way people see things.
            </p>
          </section>
        </div>
        <div className="bio-facts">
          <div>
            <strong>85%</strong>
            <span>Computer Science dissertation</span>
          </div>
          <div>
            <strong>Brishack</strong>
            <span>2025 winner / plant-growing robot</span>
          </div>
          <div>
            <strong>VEX Worlds</strong>
            <span>Highest programming score</span>
          </div>
        </div>
        <div className="bio-columns">
          <section>
            <h2>Education</h2>
            <div className="education-entry">
              <h3>University of Bristol</h3>
              <p>BA, Computer Science</p>
              <small>Jun 2023 — Jun 2026</small>
            </div>
            <div className="education-entry">
              <h3>Highgate School</h3>
              <p>
                A levels: Maths, Further Maths, Design & Technology, Physics
              </p>
              <small>Apr 2021 — Apr 2023</small>
            </div>
            <h2 style={{ marginTop: 30 }}>Selected marks</h2>
            <ul className="award-list">
              <li>
                <strong>85% — Dissertation</strong>
              </li>
              <li>
                <strong>87% — Maths in Computer Science</strong>
              </li>
              <li>
                <strong>88% — Computer Systems A/B</strong>
                <span>Concurrency</span>
              </li>
            </ul>
          </section>
          <section>
            <h2>Awards & recognition</h2>
            <ul className="award-list">
              <li>
                <strong>Best AI/ML Dissertation</strong>
                <span>University of Bristol</span>
              </li>
              <li>
                <strong>Best Software Engineering Project</strong>
                <span>University of Bristol</span>
              </li>
              <li>
                <strong>Arkwright Engineering Scholar</strong>
              </li>
              <li>
                <strong>Brishack 2025 winner</strong>
                <span>EcoBot / smart modular farming</span>
              </li>
              <li>
                <strong>Highest programming score at VEX Worlds</strong>
                <span>Alongside regional and national robotics awards</span>
              </li>
              <li>
                <strong>Consistent UKMT Gold awards</strong>
              </li>
              <li>
                <strong>Top percentile — British Informatics Olympiad</strong>
              </li>
            </ul>
          </section>
        </div>
        <h2 className="bio-section-title">Tools I work with</h2>
        <p className="skills-line">
          Python · ROS 2 · Computer vision · SDXL / LoRA · React · Tone.js ·
          Django · Praat · Librosa · CAD · Motion control
        </p>
        <Link className="bio-contact" to="/contact">
          Let’s talk ↗
        </Link>
        <footer className="portfolio-footer" style={{ marginTop: 45 }}>
          <span>Arav Raja / London</span>
          <div>
            <a
              href="https://github.com/AravRaja"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
            <a
              href="https://www.linkedin.com/in/arav-raja-73833a355/"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn ↗
            </a>
            <a href="mailto:aravraja8@gmail.com">Email ↗</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
